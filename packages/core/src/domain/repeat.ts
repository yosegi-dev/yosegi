import type { ScreenNode } from "./screen-definition.ts";
import { walkNodes } from "./screen-definition.ts";

// `repeat` expansion: turns a node carrying `repeat: N` into N structural copies
// of its subtree. The Screen JSON keeps the single node — expansion happens after
// validation, on the way into emit, so the stored screen stays editable as one
// node and only the generated Story shows the list.

// 1 is a no-op and almost certainly a misunderstanding of the field, so the range
// starts at 2 rather than silently accepting it.
export const MIN_REPEAT_COUNT = 2;
// A mock list only needs enough rows to read as a list, and the Story's size
// grows linearly with N (multiplicatively when repeats nest). The cap keeps a
// mistyped count from inflating the generated file into something no reviewer —
// human or agent — can read.
export const MAX_REPEAT_COUNT = 20;

// Raised when an expanded id collides with another id in the screen. A dedicated
// class (rather than message parsing) lets the validator map the collision onto
// its own DUPLICATE_NODE_ID issue with the id attached.
export class RepeatIdCollisionError extends Error {
	readonly nodeId: string;

	constructor(nodeId: string) {
		super(
			`Node id "${nodeId}" appears more than once after "repeat" expansion.`,
		);
		this.name = "RepeatIdCollisionError";
		this.nodeId = nodeId;
	}
}

// The k-th copy of a subtree: every id gets a "-k" suffix (the same shape
// operation.ts's reidSubtree gives duplicates), so the ids stay readable and the
// mapping back to the original node stays visible. `repeat` is stripped from the
// copies — descendants were already expanded by the time this runs, so only the
// copy root can still carry one.
function suffixSubtree(node: ScreenNode, suffix: number): ScreenNode {
	const { repeat: _repeat, ...rest } = node;
	return {
		...rest,
		id: `${node.id}-${suffix}`,
		slots: Object.fromEntries(
			Object.entries(node.slots).map(([slotName, children]) => [
				slotName,
				children.map((child) => suffixSubtree(child, suffix)),
			]),
		),
	};
}

// Depth-first so a nested repeat expands first and the outer expansion then
// suffixes the already-expanded ids ("row-1-2" = second copy of the first inner
// copy) — the composition stays deterministic.
function expandNode(node: ScreenNode): ScreenNode {
	const expanded: ScreenNode = {
		...node,
		slots: Object.fromEntries(
			Object.entries(node.slots).map(([slotName, children]) => [
				slotName,
				children.flatMap((child) => {
					const childExpanded = expandNode(child);
					if (childExpanded.repeat === undefined) {
						return [childExpanded];
					}
					const count = childExpanded.repeat;
					// Callers are expected to run validateScreen beforehand; this fails
					// explicitly as a second safety net, matching emit's requireRenderable.
					if (
						!Number.isInteger(count) ||
						count < MIN_REPEAT_COUNT ||
						count > MAX_REPEAT_COUNT
					) {
						throw new Error(
							`Node "${childExpanded.id}" has repeat ${count}; expected an integer between ${MIN_REPEAT_COUNT} and ${MAX_REPEAT_COUNT}.`,
						);
					}
					return Array.from({ length: count }, (_, index) =>
						suffixSubtree(childExpanded, index + 1),
					);
				}),
			]),
		),
	};
	return expanded;
}

// Whether any node in the tree declares repeat. Lets callers skip the expansion
// walk (and the collision scan) on the common repeat-free screen.
export function hasRepeat(root: ScreenNode): boolean {
	return walkNodes(root).some((node) => node.repeat !== undefined);
}

// Expands every repeat in the tree and returns a new root; the input is not
// mutated. Throws RepeatIdCollisionError when an expanded id collides with any
// other id in the screen — an expanded tree with duplicate ids would break the
// same invariant DUPLICATE_NODE_ID protects.
export function expandRepeat(root: ScreenNode): ScreenNode {
	// The root has no parent slot to hold its copies, and a screen with N roots is
	// not a screen. The validator reports this as REPEAT_ON_ROOT before emit.
	if (root.repeat !== undefined) {
		throw new Error(
			`The root node "${root.id}" cannot carry "repeat" (a screen has a single root).`,
		);
	}
	const expanded = expandNode(root);
	const seen = new Set<string>();
	for (const node of walkNodes(expanded)) {
		if (seen.has(node.id)) {
			throw new RepeatIdCollisionError(node.id);
		}
		seen.add(node.id);
	}
	return expanded;
}
