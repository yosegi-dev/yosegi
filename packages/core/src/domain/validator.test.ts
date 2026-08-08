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
