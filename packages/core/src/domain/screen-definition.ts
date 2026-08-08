import { z } from "zod";

// A Screen Definition is the intermediate representation of a screen assembled in
// the Composer. It's a declarative format independent of any specific framework,
// router, or state management library. It holds no concrete domain logic code — only
// intent (binding / event) declared declaratively.

export const SCHEMA_VERSION = "1.0" as const;

// Events are expressed declaratively as "preset action + arguments." They never hold
// arbitrary code.
export const eventDefinitionSchema = z.object({
	action: z.string().min(1),
	arguments: z.record(z.string(), z.unknown()).optional(),
});
export type EventDefinition = z.infer<typeof eventDefinitionSchema>;

// ScreenNode is a recursive structure, so the type is declared up front and the
// schema is resolved with z.lazy.
export type ScreenNode = {
	// A persistent Node ID, used to target a node in an Operation.
	id: string;
	// The id of the referenced Component Manifest.
	component: string;
	props: Record<string, unknown>;
	// Slot name -> array of child nodes.
	slots: Record<string, ScreenNode[]>;
	// Prop name -> data binding expression (kept as a string, made concrete at
	// implementation time).
	bindings?: Record<string, string>;
	// Event name -> declarative event definition.
	events?: Record<string, EventDefinition>;
	// Conditional-display expression (declaration only).
	when?: string;
	// Repeat-display expression (declaration only).
	each?: string;
};

export const screenNodeSchema: z.ZodType<ScreenNode> = z.lazy(() =>
	z.object({
		id: z.string().min(1),
		component: z.string().min(1),
		props: z.record(z.string(), z.unknown()),
		slots: z.record(z.string(), z.array(screenNodeSchema)),
		bindings: z.record(z.string(), z.string()).optional(),
		events: z.record(z.string(), eventDefinitionSchema).optional(),
		when: z.string().optional(),
		each: z.string().optional(),
	}),
);

// The shape of a binding expression that can be written directly as an expression in
// generated output (an identifier plus dot-separated member references). Allowing
// expressions that include calls, operators, or literals would mean a string from
// the Screen JSON turns directly into Story code. Since Yosegi's policy is to never
// write externally-supplied strings into a code position, this form — which by
// construction can't carry a side effect — is allowed as the sole exception.
const BINDING_PATH_PATTERN =
	/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

// Whether a binding expression can be written into a Story's expression position.
// emit (the writing side) and validator (the side that prompts for a value when it
// knows the expression can't be written) share this same check.
export function isEmittableBindingExpression(expression: string): boolean {
	return BINDING_PATH_PATTERN.test(expression);
}

export const screenStatusSchema = z.enum(["draft", "published"]);
export type ScreenStatus = z.infer<typeof screenStatusSchema>;

// A Screen id goes directly into the storage file name (`<dir>/<id>.json`). Allowing
// path separators or `..` would let you read/write files outside the storage
// location, so this is restricted to characters safe for a file name. Since the id
// also appears in URL paths, this range also happens to need no escaping there.
export const screenIdSchema = z
	.string()
	.min(1)
	.regex(
		/^[A-Za-z0-9_-]+$/,
		'Screen id may only contain letters, digits, "-" and "_" (it is used as a file name).',
	);

export const screenDefinitionSchema = z.object({
	schemaVersion: z.literal(SCHEMA_VERSION),
	id: screenIdSchema,
	name: z.string().min(1),
	status: screenStatusSchema.default("draft"),
	// The version of the Component Registry being referenced. Used for compatibility checks.
	componentRegistryVersion: z.string().min(1),
	// Revision for optimistic locking. Incremented by 1 on every update.
	revision: z.number().int().nonnegative(),
	root: screenNodeSchema,
});
export type ScreenDefinition = z.infer<typeof screenDefinitionSchema>;

export function parseScreenDefinition(input: unknown): ScreenDefinition {
	return screenDefinitionSchema.parse(input);
}

// ---- Tree traversal helpers (shared by Operation / Validator) ----

// Enumerates all nodes, including the root, in depth-first order.
export function walkNodes(root: ScreenNode): ScreenNode[] {
	const result: ScreenNode[] = [];
	const visit = (node: ScreenNode): void => {
		result.push(node);
		for (const children of Object.values(node.slots)) {
			for (const child of children) {
				visit(child);
			}
		}
	};
	visit(root);
	return result;
}

export function collectNodeIds(root: ScreenNode): string[] {
	return walkNodes(root).map((n) => n.id);
}

export function findNode(root: ScreenNode, nodeId: string): ScreenNode | null {
	return walkNodes(root).find((n) => n.id === nodeId) ?? null;
}

export type NodeLocation = {
	parent: ScreenNode;
	slot: string;
	index: number;
};

// Returns the parent, Slot, and index of the given node. The root has no parent, so
// this returns null for it.
export function findLocation(
	root: ScreenNode,
	nodeId: string,
): NodeLocation | null {
	for (const parent of walkNodes(root)) {
		for (const [slot, children] of Object.entries(parent.slots)) {
			const index = children.findIndex((c) => c.id === nodeId);
			if (index !== -1) {
				return { parent, slot, index };
			}
		}
	}
	return null;
}

// The set of ids of a node's descendants (including itself). Used for things like
// preventing cycles in moveNode.
export function collectDescendantIds(node: ScreenNode): Set<string> {
	return new Set(collectNodeIds(node));
}

// Deep clone used to avoid mutating the input.
export function cloneNode(node: ScreenNode): ScreenNode {
	return structuredClone(node);
}

export function cloneScreen(screen: ScreenDefinition): ScreenDefinition {
	return structuredClone(screen);
}
