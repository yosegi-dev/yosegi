import { z } from "zod";
import { ComposerError, OPERATION_CODES } from "./errors.ts";
import {
	cloneNode,
	cloneScreen,
	collectDescendantIds,
	collectNodeIds,
	eventDefinitionSchema,
	findLocation,
	findNode,
	type ScreenDefinition,
	type ScreenNode,
	screenNodeSchema,
} from "./screen-definition.ts";

// The Operation API provides diff-based updates through structured operations,
// rather than "replace the whole screen definition." This is what makes Undo/Redo,
// change history, diff views, partial updates by an agent, conflict detection, and
// per-operation review possible.

const targetSchema = z.object({
	parentNodeId: z.string().min(1),
	slot: z.string().min(1),
	// Insertion position. Defaults to the end if unspecified.
	// moveNode is applied in detach→insert order, so when moving something forward
	// within the same parent/slot, index is interpreted against the array *after* the
	// moved item has been removed (one less than the original index). Agents/clients
	// should be aware of this.
	index: z.number().int().nonnegative().optional(),
});
export type OperationTarget = z.infer<typeof targetSchema>;

// screen-definition.ts imports this schema back (a variant's operations are part
// of the Screen Definition), so the two modules form an import cycle. Every
// reference across the cycle sits behind z.lazy — on this side screenNodeSchema /
// eventDefinitionSchema, on that side screenOperationSchema — so neither module
// touches the other's bindings before both have finished evaluating, whichever
// one a consumer happens to import first.
export const screenOperationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("addNode"),
		target: targetSchema,
		node: z.lazy(() => screenNodeSchema),
	}),
	z.object({ type: z.literal("removeNode"), nodeId: z.string().min(1) }),
	z.object({
		type: z.literal("moveNode"),
		nodeId: z.string().min(1),
		target: targetSchema,
	}),
	z.object({
		type: z.literal("replaceNode"),
		nodeId: z.string().min(1),
		node: z.lazy(() => screenNodeSchema),
	}),
	z.object({
		type: z.literal("setProps"),
		nodeId: z.string().min(1),
		props: z.record(z.string(), z.unknown()),
		// Defaults to merge. Only replaces when explicitly set to false.
		merge: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("setBinding"),
		nodeId: z.string().min(1),
		bindings: z.record(z.string(), z.string()),
		merge: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("setEvent"),
		nodeId: z.string().min(1),
		events: z.record(
			z.string(),
			z.lazy(() => eventDefinitionSchema),
		),
		merge: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("duplicateNode"),
		nodeId: z.string().min(1),
		// Root node id after duplication. Unspecified falls back to a unique id based
		// on `${nodeId}-copy`.
		newId: z.string().min(1).optional(),
	}),
]);
export type ScreenOperation = z.infer<typeof screenOperationSchema>;

export function parseScreenOperation(input: unknown): ScreenOperation {
	return screenOperationSchema.parse(input);
}

export function parseScreenOperations(input: unknown): ScreenOperation[] {
	return z.array(screenOperationSchema).parse(input);
}

// Returns the first duplicate in an id list (null if there are none).
function firstDuplicate(ids: string[]): string | null {
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			return id;
		}
		seen.add(id);
	}
	return null;
}

// Generates a unique id that doesn't collide with the existing id set.
function uniqueId(base: string, existing: Set<string>): string {
	if (!existing.has(base)) {
		return base;
	}
	let counter = 2;
	while (existing.has(`${base}-${counter}`)) {
		counter += 1;
	}
	return `${base}-${counter}`;
}

// Returns a node with fresh ids assigned across it and its descendants (for duplicate).
function reidSubtree(
	node: ScreenNode,
	rootId: string,
	existing: Set<string>,
): ScreenNode {
	const clone = cloneNode(node);
	const assign = (target: ScreenNode, isRoot: boolean): void => {
		const base = isRoot ? rootId : `${target.id}-copy`;
		const nextId = uniqueId(base, existing);
		existing.add(nextId);
		target.id = nextId;
		for (const children of Object.values(target.slots)) {
			for (const child of children) {
				assign(child, false);
			}
		}
	};
	assign(clone, true);
	return clone;
}

function insertIntoSlot(
	parent: ScreenNode,
	slot: string,
	node: ScreenNode,
	index: number | undefined,
): void {
	const children = parent.slots[slot] ?? [];
	const at = index ?? children.length;
	if (at < 0 || at > children.length) {
		throw new ComposerError(
			OPERATION_CODES.SLOT_INDEX_OUT_OF_RANGE,
			`Index ${at} is out of range for slot "${slot}" (length ${children.length}).`,
			parent.id,
		);
	}
	children.splice(at, 0, node);
	parent.slots[slot] = children;
}

function requireNode(root: ScreenNode, nodeId: string): ScreenNode {
	const node = findNode(root, nodeId);
	if (!node) {
		throw new ComposerError(
			OPERATION_CODES.NODE_NOT_FOUND,
			`Node "${nodeId}" was not found.`,
			nodeId,
		);
	}
	return node;
}

function requireParent(root: ScreenNode, parentNodeId: string): ScreenNode {
	const parent = findNode(root, parentNodeId);
	if (!parent) {
		throw new ComposerError(
			OPERATION_CODES.PARENT_NOT_FOUND,
			`Parent node "${parentNodeId}" was not found.`,
			parentNodeId,
		);
	}
	return parent;
}

function detachNode(root: ScreenNode, nodeId: string): ScreenNode {
	const location = findLocation(root, nodeId);
	if (!location) {
		throw new ComposerError(
			OPERATION_CODES.NODE_NOT_FOUND,
			`Node "${nodeId}" was not found or is the root.`,
			nodeId,
		);
	}
	const [removed] = location.parent.slots[location.slot].splice(
		location.index,
		1,
	);
	return removed;
}

// Applies a single Operation purely (no side effects). Does not touch revision (that's
// managed on the Service side). Doesn't mutate the input screen — returns a new
// ScreenDefinition instead.
export function applyOperation(
	screen: ScreenDefinition,
	operation: ScreenOperation,
): ScreenDefinition {
	const next = cloneScreen(screen);
	next.root = applyToClonedRoot(next.root, operation);
	return next;
}

// The single-operation body, working on a root the caller already cloned. Split
// from applyOperation so callers that hold only a tree — emitting a screen
// variant, validating one — can apply operations without fabricating a
// ScreenDefinition around it. Returns the root, which replaceNode may swap out.
function applyToClonedRoot(
	root: ScreenNode,
	operation: ScreenOperation,
): ScreenNode {
	switch (operation.type) {
		case "addNode": {
			const parent = requireParent(root, operation.target.parentNodeId);
			const incoming = collectNodeIds(operation.node);
			// Also detect duplicates within the added subtree itself (not just
			// collisions against the root's existing id set).
			const internalDup = firstDuplicate(incoming);
			if (internalDup) {
				throw new ComposerError(
					OPERATION_CODES.DUPLICATE_NODE_ID,
					`Node id "${internalDup}" appears more than once within the added subtree.`,
					internalDup,
				);
			}
			const existing = new Set(collectNodeIds(root));
			for (const id of incoming) {
				if (existing.has(id)) {
					throw new ComposerError(
						OPERATION_CODES.DUPLICATE_NODE_ID,
						`Node id "${id}" already exists in the screen.`,
						id,
					);
				}
			}
			insertIntoSlot(
				parent,
				operation.target.slot,
				cloneNode(operation.node),
				operation.target.index,
			);
			return root;
		}
		case "removeNode": {
			if (operation.nodeId === root.id) {
				throw new ComposerError(
					OPERATION_CODES.CANNOT_REMOVE_ROOT,
					"The root node cannot be removed.",
					operation.nodeId,
				);
			}
			detachNode(root, operation.nodeId);
			return root;
		}
		case "moveNode": {
			if (operation.nodeId === root.id) {
				throw new ComposerError(
					OPERATION_CODES.CANNOT_REMOVE_ROOT,
					"The root node cannot be moved.",
					operation.nodeId,
				);
			}
			const moving = requireNode(root, operation.nodeId);
			// Can't move into itself or a descendant (prevents cycles).
			const descendants = collectDescendantIds(moving);
			if (descendants.has(operation.target.parentNodeId)) {
				throw new ComposerError(
					OPERATION_CODES.CANNOT_MOVE_INTO_DESCENDANT,
					`Cannot move node "${operation.nodeId}" into itself or its descendant.`,
					operation.nodeId,
				);
			}
			const parent = requireParent(root, operation.target.parentNodeId);
			const detached = detachNode(root, operation.nodeId);
			insertIntoSlot(
				parent,
				operation.target.slot,
				detached,
				operation.target.index,
			);
			return root;
		}
		case "replaceNode": {
			const location = findLocation(root, operation.nodeId);
			let nextRoot = root;
			if (!location) {
				// Replacing the root itself.
				if (operation.nodeId === root.id) {
					nextRoot = cloneNode(operation.node);
				} else {
					throw new ComposerError(
						OPERATION_CODES.NODE_NOT_FOUND,
						`Node "${operation.nodeId}" was not found.`,
						operation.nodeId,
					);
				}
			} else {
				location.parent.slots[location.slot][location.index] = cloneNode(
					operation.node,
				);
			}
			// Ensures id uniqueness across the whole tree after replacement (catches
			// injecting an id that exists elsewhere, or duplicates inside the
			// replacement node itself). Kept symmetric with addNode / duplicateNode.
			const dup = firstDuplicate(collectNodeIds(nextRoot));
			if (dup) {
				throw new ComposerError(
					OPERATION_CODES.DUPLICATE_NODE_ID,
					`Node id "${dup}" appears more than once after replacement.`,
					dup,
				);
			}
			return nextRoot;
		}
		case "setProps": {
			const node = requireNode(root, operation.nodeId);
			node.props =
				operation.merge === false
					? { ...operation.props }
					: { ...node.props, ...operation.props };
			return root;
		}
		case "setBinding": {
			const node = requireNode(root, operation.nodeId);
			node.bindings =
				operation.merge === false
					? { ...operation.bindings }
					: { ...(node.bindings ?? {}), ...operation.bindings };
			return root;
		}
		case "setEvent": {
			const node = requireNode(root, operation.nodeId);
			node.events =
				operation.merge === false
					? { ...operation.events }
					: { ...(node.events ?? {}), ...operation.events };
			return root;
		}
		case "duplicateNode": {
			const location = findLocation(root, operation.nodeId);
			if (!location) {
				throw new ComposerError(
					OPERATION_CODES.NODE_NOT_FOUND,
					`Node "${operation.nodeId}" was not found or is the root.`,
					operation.nodeId,
				);
			}
			const source = location.parent.slots[location.slot][location.index];
			const existing = new Set(collectNodeIds(root));
			const rootId = uniqueId(
				operation.newId ?? `${operation.nodeId}-copy`,
				existing,
			);
			const copy = reidSubtree(source, rootId, existing);
			insertIntoSlot(location.parent, location.slot, copy, location.index + 1);
			return root;
		}
		default: {
			// Unreachable due to discriminatedUnion, but made explicit as a contract.
			const exhaustive: never = operation;
			throw new ComposerError(
				OPERATION_CODES.UNKNOWN_OPERATION,
				`Unknown operation: ${JSON.stringify(exhaustive)}`,
			);
		}
	}
}

// Applies multiple Operations in sequence. If any fails, it throws and the caller
// (Service) discards the whole batch (no partial application).
export function applyOperations(
	screen: ScreenDefinition,
	operations: ScreenOperation[],
): ScreenDefinition {
	return operations.reduce(
		(current, operation) => applyOperation(current, operation),
		screen,
	);
}

// applyOperations for callers that hold only a tree. The screen-level variant
// stays the write path's entry point; this one exists for uses where a
// ScreenDefinition wrapper would be fabricated just to be unwrapped again —
// applying a variant's diff on the way into emit or validation. Same contract:
// the input is never mutated, and the first failing operation throws.
export function applyOperationsToRoot(
	root: ScreenNode,
	operations: ScreenOperation[],
): ScreenNode {
	return operations.reduce(
		(current, operation) => applyToClonedRoot(cloneNode(current), operation),
		root,
	);
}
