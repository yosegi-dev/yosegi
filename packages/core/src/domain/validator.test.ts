import { describe, expect, it } from "bun:test";
import { sampleRegistry, sampleScreen } from "../test-fixtures.ts";
import {
	type ComponentRegistry,
	parseComponentRegistry,
} from "./component-manifest.ts";
import { VALIDATION_CODES } from "./errors.ts";
import { applyOperation } from "./operation.ts";
import {
	parseScreenDefinition,
	type ScreenDefinition,
	type ScreenNode,
} from "./screen-definition.ts";
import { withSyntheticComponents } from "./synthetics.ts";
import { validateScreen } from "./validator.ts";

describe("validateScreen", () => {
	it("a valid screen is valid", () => {
		const result = validateScreen(sampleScreen(), sampleRegistry());
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("detects an unregistered component", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: { id: "node-x", component: "NotRegistered", props: {}, slots: {} },
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.COMPONENT_NOT_FOUND,
			),
		).toBe(true);
	});

	it("detects an unknown Prop", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: { unknownProp: "x" },
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.UNKNOWN_PROP),
		).toBe(true);
	});

	// So the next move can be decided from the error string alone, a misspelling gets
	// an existing id attached.
	it("returns a suggestion with an id close to a misspelled unregistered component", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: { id: "node-x", component: "TextFild", props: {}, slots: {} },
		});
		const result = validateScreen(screen, sampleRegistry());
		const error = result.errors.find(
			(e) => e.code === VALIDATION_CODES.COMPONENT_NOT_FOUND,
		);
		expect(error?.suggestion).toBe("Did you mean: TextField?");
	});

	it("returns a suggestion with a prop name close to a misspelled unknown Prop", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: { titel: "x" },
		});
		const result = validateScreen(screen, sampleRegistry());
		const error = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(error?.suggestion).toBe("Did you mean: title?");
	});

	it("detects an invalid enum value and returns a suggestion", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: {
				id: "node-btn",
				component: "Button",
				props: { variant: "danger" },
				slots: {},
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
		);
		expect(issue).toBeDefined();
		expect(issue?.suggestion).toContain("destructive");
	});

	it("detects a missing required Prop", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
			),
		).toBe(true);
	});

	// A required Prop declared only via a binding. Since the generated output emits
	// the binding expression as-is, this isn't technically missing, but that name
	// doesn't exist in the Story, so it won't type-check. Warn about this up front.
	it("a bound required Prop yields a BOUND_REQUIRED_PROP warning", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setBinding",
			nodeId: "node-header",
			bindings: { title: "page.title" },
		});
		const withoutProp = applyOperation(screen, {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const result = validateScreen(withoutProp, sampleRegistry());
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
			),
		).toBe(false);
		const warning = result.warnings.find(
			(w) => w.code === VALIDATION_CODES.BOUND_REQUIRED_PROP,
		);
		expect(warning?.message).toContain("title={page.title}");
		expect(warning?.suggestion).toContain("props.title");
	});

	// A binding that can't be written as an expression can't be emitted into the
	// output. Rather than silently writing a Story with the prop missing, this
	// blocks and prompts for a value.
	it("a required Prop with only a non-emittable binding yields MISSING_REQUIRED_PROP", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setBinding",
			nodeId: "node-header",
			bindings: { title: "page.title ?? ''" },
		});
		const withoutProp = applyOperation(screen, {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const result = validateScreen(withoutProp, sampleRegistry());
		const error = result.errors.find(
			(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
		);
		expect(error?.suggestion).toContain("is not a plain identifier path");
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.BOUND_REQUIRED_PROP,
			),
		).toBe(false);
	});

	it("detects a nonexistent Slot", () => {
		const screen = sampleScreen();
		screen.root.slots.nonexistent = [
			{ id: "node-z", component: "Button", props: {}, slots: {} },
		];
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.SLOT_NOT_FOUND),
		).toBe(true);
	});

	it("detects a Slot exceeding maxItems", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "header" },
			node: {
				id: "node-h2",
				component: "PageHeader",
				props: { title: "b" },
				slots: {},
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.SLOT_MAX_ITEMS_EXCEEDED,
			),
		).toBe(true);
	});

	it("detects an allowedParents violation", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-search", slot: "fields" },
			node: {
				id: "node-h3",
				component: "PageHeader",
				props: { title: "b" },
				slots: {},
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.PARENT_NOT_ALLOWED),
		).toBe(true);
	});

	it("a deprecated component yields a warning", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: {
				id: "node-legacy",
				component: "LegacyBanner",
				props: {},
				slots: {},
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(result.valid).toBe(true);
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.DEPRECATED_COMPONENT,
			),
		).toBe(true);
	});

	// A short id always resolves to the synthetic primitive. When the host also has a
	// component of the same name, mixing them up produces no error — just a screen
	// that "silently misses the typography component" — so this is surfaced as a warning.
	describe("name collision between a synthetic primitive and a host component", () => {
		function registryWithHostText(): ComponentRegistry {
			const registry = withSyntheticComponents(sampleRegistry());
			return parseComponentRegistry({
				...registry,
				components: [
					...registry.components,
					{
						id: "app/components/typography#Text",
						name: "Text",
						category: "typography",
						import: {
							packageName: "./app/components/typography.tsx",
							exportName: "Text",
						},
						props: { size: { kind: "enum", options: ["sm", "md"] } },
						slots: { children: {} },
					},
				],
			});
		}

		function screenWithSyntheticText(nodeIds: string[]): ScreenDefinition {
			return parseScreenDefinition({
				schemaVersion: "1.0",
				id: "shadowed",
				name: "同名衝突",
				componentRegistryVersion: "test:v1",
				revision: 0,
				root: {
					id: "root",
					component: "Box",
					props: {},
					slots: {
						children: nodeIds.map((id) => ({
							id,
							component: "Text",
							props: { text: id },
							slots: {},
						})),
					},
				},
			});
		}

		it("prompts for the full id via a warning when the host has a same-named component", () => {
			const result = validateScreen(
				screenWithSyntheticText(["label"]),
				registryWithHostText(),
			);
			// Using a synthetic primitive is itself legitimate, so this doesn't become an error.
			expect(result.valid).toBe(true);
			const warning = result.warnings.find(
				(w) => w.code === VALIDATION_CODES.SYNTHETIC_NAME_SHADOWED,
			);
			expect(warning?.nodeId).toBe("label");
			expect(warning?.suggestion).toContain("app/components/typography#Text");
		});

		// Text used for labels can appear dozens of times in a single screen. Reporting
		// it on every node would bury other warnings.
		it("reports the same-name warning at most once per screen", () => {
			const result = validateScreen(
				screenWithSyntheticText(["a", "b", "c"]),
				registryWithHostText(),
			);
			expect(
				result.warnings.filter(
					(w) => w.code === VALIDATION_CODES.SYNTHETIC_NAME_SHADOWED,
				),
			).toHaveLength(1);
		});

		it("does not warn when there is no same-named host component", () => {
			const result = validateScreen(
				screenWithSyntheticText(["label"]),
				withSyntheticComponents(sampleRegistry()),
			);
			expect(
				result.warnings.some(
					(w) => w.code === VALIDATION_CODES.SYNTHETIC_NAME_SHADOWED,
				),
			).toBe(false);
		});
	});

	it("detects duplicate Node IDs", () => {
		const screen = sampleScreen();
		screen.root.slots.body.push({
			id: "node-table",
			component: "Button",
			props: {},
			slots: {},
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.DUPLICATE_NODE_ID),
		).toBe(true);
	});

	it("a Registry Version mismatch yields a warning", () => {
		const screen = sampleScreen();
		screen.componentRegistryVersion = "test:old";
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.REGISTRY_VERSION_MISMATCH,
			),
		).toBe(true);
	});
});

// Slot constraints, parent-child constraints, and Prop kind branches don't trigger
// against sampleRegistry, so a dedicated Registry is used to test them individually.
function constraintRegistry(): ComponentRegistry {
	return parseComponentRegistry({
		version: "custom:v1",
		generatedAt: "2026-07-22T00:00:00.000Z",
		components: [
			{
				id: "Root",
				name: "Root",
				category: "layout",
				import: { packageName: "x", exportName: "Root" },
				props: {},
				// main only allows Allowed, and is required (empty triggers a warning).
				slots: { main: { allowedComponents: ["Allowed"], required: true } },
			},
			{
				id: "StrictParent",
				name: "StrictParent",
				category: "layout",
				import: { packageName: "x", exportName: "StrictParent" },
				props: {},
				slots: { children: {} },
				constraints: { allowedChildren: ["Allowed"] },
			},
			{
				id: "Allowed",
				name: "Allowed",
				category: "x",
				import: { packageName: "x", exportName: "Allowed" },
				props: {},
				slots: {},
			},
			{
				id: "Forbidden",
				name: "Forbidden",
				category: "x",
				import: { packageName: "x", exportName: "Forbidden" },
				props: {},
				slots: {},
			},
			{
				id: "Typed",
				name: "Typed",
				category: "x",
				import: { packageName: "x", exportName: "Typed" },
				props: {
					num: { kind: "number" },
					flag: { kind: "boolean" },
					maybe: { kind: "string", nullable: true },
					strict: { kind: "string" },
					payload: { kind: "json", editable: false },
					slot: { kind: "reactNode", editable: false },
					onPress: { kind: "function", editable: false },
				},
				slots: {},
			},
		],
	});
}

function screenWith(root: ScreenNode) {
	return parseScreenDefinition({
		schemaVersion: "1.0",
		id: "s",
		name: "s",
		status: "draft",
		componentRegistryVersion: "custom:v1",
		revision: 1,
		root,
	});
}

describe("validateScreen: Slot / parent-child constraints", () => {
	it("an allowedComponents violation yields SLOT_COMPONENT_NOT_ALLOWED", () => {
		const screen = screenWith({
			id: "r",
			component: "Root",
			props: {},
			slots: {
				main: [{ id: "c", component: "Forbidden", props: {}, slots: {} }],
			},
		});
		const result = validateScreen(screen, constraintRegistry());
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.SLOT_COMPONENT_NOT_ALLOWED,
			),
		).toBe(true);
	});

	it("an empty required Slot yields a MISSING_REQUIRED_SLOT warning", () => {
		const screen = screenWith({
			id: "r",
			component: "Root",
			props: {},
			slots: { main: [] },
		});
		const result = validateScreen(screen, constraintRegistry());
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.MISSING_REQUIRED_SLOT,
			),
		).toBe(true);
	});

	it("an allowedChildren violation yields CHILD_NOT_ALLOWED", () => {
		const screen = screenWith({
			id: "r",
			component: "StrictParent",
			props: {},
			slots: {
				children: [{ id: "c", component: "Forbidden", props: {}, slots: {} }],
			},
		});
		const result = validateScreen(screen, constraintRegistry());
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.CHILD_NOT_ALLOWED),
		).toBe(true);
	});
});

describe("validateScreen: Prop kind branches", () => {
	function typed(props: Record<string, unknown>) {
		return validateScreen(
			screenWith({ id: "r", component: "Typed", props, slots: {} }),
			constraintRegistry(),
		);
	}

	it("a non-numeric value for number yields INVALID_PROP_VALUE", () => {
		expect(
			typed({ num: "x" }).errors.some(
				(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
			),
		).toBe(true);
	});

	it("NaN for number yields INVALID_PROP_VALUE", () => {
		expect(
			typed({ num: Number.NaN }).errors.some(
				(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
			),
		).toBe(true);
	});

	it("a non-boolean value for boolean yields INVALID_PROP_VALUE", () => {
		expect(
			typed({ flag: "yes" }).errors.some(
				(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
			),
		).toBe(true);
	});

	it("a nullable Prop accepts null", () => {
		expect(typed({ maybe: null }).valid).toBe(true);
	});

	it("null for a non-nullable Prop yields INVALID_PROP_VALUE", () => {
		expect(
			typed({ strict: null }).errors.some(
				(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
			),
		).toBe(true);
	});

	// Kinds whose value shape isn't validated don't validate null either. This is so
	// that props where null is a legitimately valid value (e.g. `{ a: number } | null`)
	// don't get rejected just because nullable wasn't declared.
	it("a kind with no value validation accepts null", () => {
		expect(typed({ payload: null }).valid).toBe(true);
		expect(typed({ slot: null }).valid).toBe(true);
	});
});

// Functions can't be represented in the Screen JSON. Writing a handler name as a
// string would emit it verbatim, e.g. `onPress="handlePress"`, and the resulting
// Story would neither compile nor run.
describe("validateScreen: Props that can't hold a value", () => {
	function typed(props: Record<string, unknown>) {
		return validateScreen(
			screenWith({ id: "r", component: "Typed", props, slots: {} }),
			constraintRegistry(),
		);
	}

	it("a value on a function-typed Prop yields FUNCTION_PROP_VALUE", () => {
		const result = typed({ onPress: "handlePress" });
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.FUNCTION_PROP_VALUE,
		);
		expect(issue?.message).toContain('"Typed.onPress" is a function');
		expect(issue?.suggestion).toContain('"events": { "onPress"');
		expect(result.valid).toBe(false);
	});

	it("a function-typed Prop does not accept null either", () => {
		expect(
			typed({ onPress: null }).errors.some(
				(e) => e.code === VALIDATION_CODES.FUNCTION_PROP_VALUE,
			),
		).toBe(true);
	});

	it("does not flag a function-typed Prop declared via events", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Typed",
				props: {},
				slots: {},
				events: { onPress: { action: "navigate" } },
			}),
			constraintRegistry(),
		);
		expect(result.valid).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	// Non-function editable=false kinds (json / reactNode) simply can't have their
	// value shape validated — writing a value can still be legitimate (e.g. a string
	// for reactNode), so this stays a warning.
	it("a value on an editable=false Prop yields a NOT_EDITABLE_PROP_VALUE warning", () => {
		const result = typed({ payload: { a: 1 } });
		const issue = result.warnings.find(
			(w) => w.code === VALIDATION_CODES.NOT_EDITABLE_PROP_VALUE,
		);
		expect(issue?.message).toContain('"Typed.payload" is not editable');
		expect(issue?.suggestion).toContain('"bindings": { "payload"');
		expect(result.valid).toBe(true);
	});

	it("does not flag a value on an editable Prop", () => {
		expect(typed({ num: 1 }).warnings).toEqual([]);
	});
});

describe("validateScreen: bindings / events targets", () => {
	function bound(node: Partial<ScreenNode>) {
		return validateScreen(
			screenWith({
				id: "r",
				component: "Typed",
				props: {},
				slots: {},
				...node,
			}),
			constraintRegistry(),
		);
	}

	it("a binding to a nonexistent prop yields UNKNOWN_BINDING_TARGET", () => {
		const result = bound({ bindings: { strct: "user.name" } });
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_BINDING_TARGET,
		);
		expect(result.valid).toBe(false);
		expect(issue?.suggestion).toContain("strict");
	});

	it("passes a binding to an existing prop", () => {
		expect(bound({ bindings: { strict: "user.name" } }).valid).toBe(true);
	});

	it("an event on a nonexistent prop yields an UNKNOWN_EVENT_TARGET warning", () => {
		const result = bound({ events: { onNope: { action: "go" } } });
		expect(result.valid).toBe(true);
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.UNKNOWN_EVENT_TARGET,
			),
		).toBe(true);
	});

	it("does not warn about an event matching a function prop", () => {
		expect(bound({ events: { onPress: { action: "go" } } }).warnings).toEqual(
			[],
		);
	});
});

// Emit never writes children / key / ref as JSX attributes, so a value under one of
// these names would vanish from the Story without a trace. It used to slip through as
// (at most) a NOT_EDITABLE_PROP_VALUE warning claiming the value is "written as-is".
describe("validateScreen: reserved prop names", () => {
	function reservedRegistry(): ComponentRegistry {
		return parseComponentRegistry({
			version: "custom:v1",
			components: [
				{
					id: "Button",
					name: "Button",
					import: { packageName: "x", exportName: "Button" },
					props: {
						label: { kind: "string" },
						children: { kind: "reactNode", editable: false, required: true },
					},
					slots: { children: {} },
				},
			],
		});
	}

	it("props.children yields RESERVED_PROP with a move-to-slots suggestion", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Button",
				props: { children: "Save" },
				slots: {},
			}),
			reservedRegistry(),
		);
		expect(result.valid).toBe(false);
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.RESERVED_PROP,
		);
		expect(issue?.suggestion).toContain('"slots": { "children"');
		// The old NOT_EDITABLE_PROP_VALUE warning claimed the value reaches the Story
		// as-is, which contradicts emit dropping it.
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.NOT_EDITABLE_PROP_VALUE,
			),
		).toBe(false);
	});

	it("props.key / props.ref yield RESERVED_PROP", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Button",
				props: { key: "k", ref: "r" },
				slots: {},
			}),
			reservedRegistry(),
		);
		expect(
			result.errors.filter((e) => e.code === VALIDATION_CODES.RESERVED_PROP),
		).toHaveLength(2);
	});

	// A required children prop can never be satisfied through props, so demanding a
	// value there would only lead back into RESERVED_PROP.
	it("a required children prop is not reported missing", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Button",
				props: { label: "Save" },
				slots: {},
			}),
			reservedRegistry(),
		);
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
			),
		).toBe(false);
	});
});

// A bracket lookup keyed by a screen-supplied name walks the prototype chain, so
// names like "toString" used to resolve to Object.prototype and pass as defined.
describe("validateScreen: prototype-derived names", () => {
	function protoRegistry(): ComponentRegistry {
		return parseComponentRegistry({
			version: "custom:v1",
			components: [
				{
					id: "Card",
					name: "Card",
					import: { packageName: "x", exportName: "Card" },
					props: { title: { kind: "string" } },
					slots: { children: {} },
				},
			],
		});
	}

	it("a slot named toString yields SLOT_NOT_FOUND", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Card",
				props: {},
				slots: {
					toString: [{ id: "c", component: "Card", props: {}, slots: {} }],
				},
			}),
			protoRegistry(),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.SLOT_NOT_FOUND),
		).toBe(true);
	});

	it("a prop named hasOwnProperty yields UNKNOWN_PROP", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Card",
				props: { hasOwnProperty: "x" },
				slots: {},
			}),
			protoRegistry(),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.code === VALIDATION_CODES.UNKNOWN_PROP),
		).toBe(true);
	});

	it("a binding to valueOf yields UNKNOWN_BINDING_TARGET", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Card",
				props: {},
				slots: {},
				bindings: { valueOf: "data.x" },
			}),
			protoRegistry(),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.UNKNOWN_BINDING_TARGET,
			),
		).toBe(true);
	});

	it("an event named toString yields an UNKNOWN_EVENT_TARGET warning", () => {
		const result = validateScreen(
			screenWith({
				id: "r",
				component: "Card",
				props: {},
				slots: {},
				events: { toString: { action: "go" } },
			}),
			protoRegistry(),
		);
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.UNKNOWN_EVENT_TARGET,
			),
		).toBe(true);
	});

	// A required prop must not be treated as present just because its name exists on
	// Object.prototype.
	it("a required prop named constructor is still reported missing", () => {
		const registry = parseComponentRegistry({
			version: "custom:v1",
			components: [
				{
					id: "Odd",
					name: "Odd",
					import: { packageName: "x", exportName: "Odd" },
					props: { constructor: { kind: "string", required: true } },
					slots: {},
				},
			],
		});
		const result = validateScreen(
			screenWith({ id: "r", component: "Odd", props: {}, slots: {} }),
			registry,
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
			),
		).toBe(true);
	});
});

// Everything the error needs so an agent can self-correct without a component inspect
// round-trip: the received value, the typed options, the prop's kind, and the node's
// position in the tree.
describe("validateScreen: self-correction info", () => {
	it("INVALID_PROP_VALUE carries the received value and typed enum options", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-table",
			props: { loading: "yes" },
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
		);
		// The stringified value makes a wrong type readable ("yes" vs yes vs 1).
		expect(issue?.message).toContain('received: "yes"');
	});

	it("INVALID_PROP_VALUE renders enum options with their type visible", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: {
				id: "node-btn",
				component: "Button",
				props: { variant: "danger" },
				slots: {},
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.INVALID_PROP_VALUE,
		);
		expect(issue?.suggestion).toBe(
			'Use one of: "default", "destructive", "secondary", "ghost", "link"',
		);
	});

	it("MISSING_REQUIRED_PROP names the prop's kind", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
		);
		expect(issue?.message).toContain('(kind "string")');
	});

	it("a missing required enum prop suggests its options", () => {
		const registry = parseComponentRegistry({
			version: "enum:v1",
			components: [
				{
					id: "Badge",
					name: "Badge",
					category: "x",
					import: { packageName: "x", exportName: "Badge" },
					props: {
						tone: { kind: "enum", required: true, options: ["info", "warn"] },
					},
					slots: {},
				},
			],
		});
		const screen = parseScreenDefinition({
			schemaVersion: "1.0",
			id: "s",
			name: "s",
			componentRegistryVersion: "enum:v1",
			revision: 0,
			root: { id: "r", component: "Badge", props: {}, slots: {} },
		});
		const issue = validateScreen(screen, registry).errors.find(
			(e) => e.code === VALIDATION_CODES.MISSING_REQUIRED_PROP,
		);
		expect(issue?.suggestion).toBe('Set it to one of: "info", "warn"');
	});

	it("a node-level field inside props gets a dedicated UNKNOWN_PROP suggestion", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: { bindings: { title: "page.title" } },
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(issue?.suggestion).toContain('"bindings" is not a prop');
		expect(issue?.suggestion).toContain("place it directly on the node");
	});

	it("issues carry the node's tree path", () => {
		const screen = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-keyword",
			props: { titel: "x" },
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(issue?.path).toBe("$.body[0].fields[0]");
	});

	// Built by hand — applyOperation rejects a duplicate id before validation would see it.
	it("DUPLICATE_NODE_ID names both colliding paths", () => {
		const base = sampleScreen();
		base.root.slots.body.push({
			id: "node-header",
			component: "PageHeader",
			props: { title: "again" },
			slots: {},
		});
		const result = validateScreen(base, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.DUPLICATE_NODE_ID,
		);
		expect(issue?.message).toContain("$.header[0]");
		expect(issue?.message).toContain("$.body[2]");
		expect(issue?.path).toBe("$.body[2]");
	});

	// Issues locate their node by object identity. Resolving through nodeId would
	// send a later duplicate's issues to the first occurrence's path.
	it("重複 id の後続ノードの issue は自分の path を持つ", () => {
		const base = sampleScreen();
		base.root.slots.body.push({
			id: "node-header",
			component: "PageHeader",
			props: { title: "again", titel: "typo" },
			slots: {},
		});
		const result = validateScreen(base, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(issue?.nodeId).toBe("node-header");
		expect(issue?.path).toBe("$.body[2]");
	});
});

describe("validateScreen: fixtures", () => {
	function withFixtures(
		screen: ScreenDefinition,
		fixtures: Record<string, unknown>,
	): ScreenDefinition {
		return parseScreenDefinition({ ...screen, fixtures });
	}

	// The fixture makes the bound identifier real in the generated Story, so the
	// "won't type-check" warning would be wrong.
	it("a fixture-backed bound required Prop yields no BOUND_REQUIRED_PROP warning", () => {
		const bound = applyOperation(sampleScreen(), {
			type: "setBinding",
			nodeId: "node-header",
			bindings: { title: "pageTitles.main" },
		});
		const withoutProp = applyOperation(bound, {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const screen = withFixtures(withoutProp, {
			pageTitles: { main: "Customers" },
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(result.valid).toBe(true);
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.BOUND_REQUIRED_PROP,
			),
		).toBe(false);
	});

	it("a bound required Prop without a matching fixture still warns", () => {
		const bound = applyOperation(sampleScreen(), {
			type: "setBinding",
			nodeId: "node-header",
			bindings: { title: "pageTitles.main" },
		});
		const withoutProp = applyOperation(bound, {
			type: "setProps",
			nodeId: "node-header",
			props: {},
			merge: false,
		});
		const screen = withFixtures(withoutProp, { customers: [] });
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.warnings.some(
				(w) => w.code === VALIDATION_CODES.BOUND_REQUIRED_PROP,
			),
		).toBe(true);
	});

	it("a fixture no binding references yields an UNUSED_FIXTURE warning", () => {
		const screen = withFixtures(sampleScreen(), { orphan: [1, 2] });
		const result = validateScreen(screen, sampleRegistry());
		const warning = result.warnings.find(
			(w) => w.code === VALIDATION_CODES.UNUSED_FIXTURE,
		);
		expect(warning?.message).toContain('"orphan"');
		expect(result.valid).toBe(true);
	});

	// sampleScreen binds rows to "customers", so the fixture counts as referenced
	// even though the binding sits on a member path elsewhere too.
	it("a fixture referenced from a binding head is not reported unused", () => {
		const screen = withFixtures(sampleScreen(), { customers: [] });
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.warnings.some((w) => w.code === VALIDATION_CODES.UNUSED_FIXTURE),
		).toBe(false);
	});
});

describe("validateScreen: repeat", () => {
	function withBodyNode(node: ScreenNode): ScreenDefinition {
		const screen = sampleScreen();
		screen.root.slots.body.push(node);
		return screen;
	}

	it("passes an in-range repeat", () => {
		const screen = withBodyNode({
			id: "node-row",
			component: "Table",
			props: {},
			slots: {},
			repeat: 3,
		});
		const result = validateScreen(screen, sampleRegistry());
		expect(result.valid).toBe(true);
	});

	it("an out-of-range repeat yields REPEAT_OUT_OF_RANGE", () => {
		for (const repeat of [1, 0, -2, 21]) {
			const screen = withBodyNode({
				id: "node-row",
				component: "Table",
				props: {},
				slots: {},
				repeat,
			});
			const result = validateScreen(screen, sampleRegistry());
			const issue = result.errors.find(
				(e) => e.code === VALIDATION_CODES.REPEAT_OUT_OF_RANGE,
			);
			expect(issue?.nodeId).toBe("node-row");
			expect(issue?.path).toBe("$.body[2]");
		}
	});

	it("repeat on the root yields REPEAT_ON_ROOT", () => {
		const screen = sampleScreen();
		screen.root.repeat = 2;
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.REPEAT_ON_ROOT,
		);
		expect(issue?.nodeId).toBe("node-page");
		expect(issue?.suggestion).toContain("Box");
	});

	it("nested repeats over the expansion budget yield REPEAT_EXPANSION_TOO_LARGE", () => {
		// Three nested repeat: 20 expand to 20 + 400 + 8000 nodes — over the
		// 2000-node budget even though every declaration is in range.
		const screen = withBodyNode({
			id: "node-group",
			component: "SearchForm",
			props: {},
			repeat: 20,
			slots: {
				fields: [
					{
						id: "node-row",
						component: "SearchForm",
						props: {},
						repeat: 20,
						slots: {
							fields: [
								{
									id: "node-cell",
									component: "TextField",
									props: { label: "cell" },
									repeat: 20,
									slots: {},
								},
							],
						},
					},
				],
			},
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.REPEAT_EXPANSION_TOO_LARGE,
		);
		expect(issue?.message).toContain("limit");
		expect(issue?.suggestion).toContain("2000");
	});

	it("an expansion id collision yields DUPLICATE_NODE_ID", () => {
		const screen = withBodyNode({
			id: "node-row",
			component: "Table",
			props: {},
			slots: {},
			repeat: 2,
		});
		screen.root.slots.body.push({
			id: "node-row-2",
			component: "Table",
			props: {},
			slots: {},
		});
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.DUPLICATE_NODE_ID,
		);
		expect(issue?.nodeId).toBe("node-row-2");
		expect(issue?.message).toContain("repeat");
	});
});

describe("validateScreen: variants", () => {
	function withVariants(
		variants: ScreenDefinition["variants"],
		fixtures?: Record<string, unknown>,
	): ScreenDefinition {
		return parseScreenDefinition({
			...sampleScreen(),
			...(fixtures ? { fixtures } : {}),
			variants,
		});
	}

	it("a variant whose applied tree is sound adds no issues", () => {
		const screen = withVariants([
			{
				name: "Loading",
				operations: [
					{ type: "setProps", nodeId: "node-table", props: { loading: true } },
				],
			},
		]);
		const result = validateScreen(screen, sampleRegistry());
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("an issue raised by a variant's tree carries the variant name", () => {
		const screen = withVariants([
			{
				name: "Errored",
				operations: [
					{ type: "setProps", nodeId: "node-table", props: { bogus: 1 } },
				],
			},
		]);
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(issue?.variant).toBe("Errored");
		expect(issue?.nodeId).toBe("node-table");
		// The path addresses the tree after the operations were applied.
		expect(issue?.path).toBe("$.body[1]");
	});

	it("an operation targeting a missing node yields VARIANT_OPERATION_FAILED", () => {
		const screen = withVariants([
			{
				name: "Broken",
				operations: [
					{ type: "setProps", nodeId: "no-such-node", props: { a: 1 } },
				],
			},
			{
				name: "Loading",
				operations: [
					{ type: "setProps", nodeId: "node-table", props: { loading: true } },
				],
			},
		]);
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.VARIANT_OPERATION_FAILED,
		);
		expect(issue?.variant).toBe("Broken");
		expect(issue?.nodeId).toBe("no-such-node");
		expect(issue?.message).toContain("NODE_NOT_FOUND");
		// The failure is scoped to its variant; the other variant still validated.
		expect(result.errors).toHaveLength(1);
	});

	// The variant tree contains the whole base tree, so base issues would repeat
	// once per variant; fixing the base clears them everywhere, so they are
	// reported once, on the base.
	it("does not repeat a base issue inside every variant", () => {
		const broken = withVariants([
			{ name: "Empty", operations: [] },
			{ name: "Loading", operations: [] },
		]);
		broken.root.slots.body[1].props.bogus = 1;
		const result = validateScreen(broken, sampleRegistry());
		const issues = result.errors.filter(
			(e) => e.code === VALIDATION_CODES.UNKNOWN_PROP,
		);
		expect(issues).toHaveLength(1);
		expect(issues[0].variant).toBeUndefined();
	});

	it("a fixture referenced only by a variant's binding is not unused", () => {
		const withoutVariant = withVariants([], { skeletonRows: [] });
		expect(
			validateScreen(withoutVariant, sampleRegistry()).warnings.some(
				(w) => w.code === VALIDATION_CODES.UNUSED_FIXTURE,
			),
		).toBe(true);

		const screen = withVariants(
			[
				{
					name: "Loading",
					operations: [
						{
							type: "setBinding",
							nodeId: "node-table",
							bindings: { rows: "skeletonRows" },
						},
					],
				},
			],
			{ skeletonRows: [] },
		);
		const result = validateScreen(screen, sampleRegistry());
		expect(
			result.warnings.some((w) => w.code === VALIDATION_CODES.UNUSED_FIXTURE),
		).toBe(false);
	});

	it("a variant that swaps in an out-of-range repeat is reported with its context", () => {
		const screen = withVariants([
			{
				name: "Long",
				operations: [
					{
						type: "replaceNode",
						nodeId: "node-table",
						node: {
							id: "node-table",
							component: "Table",
							props: {},
							slots: {},
							repeat: 25,
						},
					},
				],
			},
		]);
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.REPEAT_OUT_OF_RANGE,
		);
		expect(issue?.variant).toBe("Long");
		expect(issue?.nodeId).toBe("node-table");
	});

	it("a component added only by a variant is still checked against the registry", () => {
		const screen = withVariants([
			{
				name: "Empty",
				operations: [
					{
						type: "addNode",
						target: { parentNodeId: "node-page", slot: "body", index: 0 },
						node: {
							id: "node-banner",
							component: "NotRegistered",
							props: {},
							slots: {},
						},
					},
				],
			},
		]);
		const result = validateScreen(screen, sampleRegistry());
		const issue = result.errors.find(
			(e) => e.code === VALIDATION_CODES.COMPONENT_NOT_FOUND,
		);
		expect(issue?.variant).toBe("Empty");
		// Inserted at index 0, so the applied tree's path reflects the shift.
		expect(issue?.path).toBe("$.body[0]");
	});
});
