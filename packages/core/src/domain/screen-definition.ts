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
	// Number of structural copies emit expands this subtree into (a mock list's
	// rows). Unlike `each` — which stays a declaration and produces no JSX — repeat
	// is realized in the generated Story. The Screen JSON keeps the single node.
	// Only integer-ness lives in the schema; the allowed range is checked by the
	// validator so the error carries nodeId / path and a suggestion.
	repeat?: number;
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
		repeat: z.number().int().optional(),
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

// The leading identifier of an emittable binding expression
// ("customers.items" -> "customers"). null when the expression cannot be written
// into the Story at all. This is what gets matched against fixture names: a
// binding whose head resolves to a fixture references a value that really exists
// in the generated Story.
export function bindingRootIdentifier(expression: string): string | null {
	if (!isEmittableBindingExpression(expression)) {
		return null;
	}
	const separator = expression.indexOf(".");
	return separator === -1 ? expression : expression.slice(0, separator);
}

// A form that can be written as-is in an identifier position (a fixture's const
// name, a Story's export name, an import's local name). Shared with emit so the
// schema and the writer can't drift apart.
const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isJsIdentifier(name: string): boolean {
	return JS_IDENTIFIER_PATTERN.test(name);
}

// Identifiers the emitted Story itself always declares: `const meta` and the
// Meta / StoryObj type imports. A fixture name is emitted verbatim as
// `const <name>` and is referenced from binding expressions as written, so emit
// cannot alias it the way it suffixes a colliding component import — renaming the
// const would orphan every binding that points at it. With no escape hatch at emit
// time, the collision is rejected up front, here in the schema.
export const EMIT_RESERVED_IDENTIFIERS = ["meta", "Meta", "StoryObj"] as const;

const RESERVED_FIXTURE_NAMES: ReadonlySet<string> = new Set(
	EMIT_RESERVED_IDENTIFIERS,
);

// A fixture's value is emitted verbatim into the Story as source code, so only
// values with a JSON form are representable. `z.unknown()` would also admit
// `undefined`, `Date`, `Map`, functions — values JSON.stringify silently drops
// or mangles — so the schema spells the JSON grammar out recursively and
// rejects everything else up front.
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

// Fixtures are the screen's mock-data layer: each entry becomes a top-level
// `const <name> = <JSON value>;` in the generated Story, and bindings reference
// the names. Name legality is checked here rather than with a validation code:
// validation codes report registry-dependent problems, while a fixture name's
// legality is a structural property of the document itself — the same tier as
// screenIdSchema's file-name restriction — so it fails the same way
// (INVALID_REQUEST, before validation is ever reached).
export const fixturesSchema = z
	.record(z.string(), jsonValueSchema)
	.superRefine((fixtures, ctx) => {
		for (const name of Object.keys(fixtures)) {
			if (!isJsIdentifier(name)) {
				ctx.addIssue({
					code: "custom",
					path: [name],
					message: `Fixture name "${name}" is not a valid JavaScript identifier. Use letters, digits, "_" or "$", and do not start with a digit.`,
				});
				continue;
			}
			if (RESERVED_FIXTURE_NAMES.has(name)) {
				ctx.addIssue({
					code: "custom",
					path: [name],
					message: `Fixture name "${name}" collides with an identifier the generated Story declares (${EMIT_RESERVED_IDENTIFIERS.join(", ")}). Rename the fixture.`,
				});
			}
		}
	});

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
	// Mock data emitted into the Story as top-level consts, referenced by bindings.
	fixtures: fixturesSchema.optional(),
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
