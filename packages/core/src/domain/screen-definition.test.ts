import { describe, expect, it } from "bun:test";
import { sampleScreen } from "../test-fixtures.ts";
import {
	bindingRootIdentifier,
	collectNodeIds,
	findLocation,
	findNode,
	parseScreenDefinition,
	walkNodes,
} from "./screen-definition.ts";

describe("parseScreenDefinition", () => {
	it("can parse a valid screen definition", () => {
		const screen = sampleScreen();
		expect(screen.id).toBe("customer-list");
		expect(screen.root.component).toBe("Page");
	});

	it("fails when schemaVersion is invalid", () => {
		expect(() =>
			parseScreenDefinition({
				schemaVersion: "2.0",
				id: "x",
				name: "x",
				componentRegistryVersion: "v1",
				revision: 0,
				root: { id: "r", component: "Page", props: {}, slots: {} },
			}),
		).toThrow();
	});
});

describe("walkNodes / collectNodeIds", () => {
	it("enumerates all nodes in depth-first order", () => {
		const ids = collectNodeIds(sampleScreen().root);
		expect(ids).toEqual([
			"node-page",
			"node-header",
			"node-search",
			"node-keyword",
			"node-table",
		]);
	});

	it("walkNodes includes the root", () => {
		expect(walkNodes(sampleScreen().root)[0]?.id).toBe("node-page");
	});
});

describe("findNode / findLocation", () => {
	it("gets a node by id", () => {
		expect(findNode(sampleScreen().root, "node-keyword")?.component).toBe(
			"TextField",
		);
	});

	it("returns null for a nonexistent id", () => {
		expect(findNode(sampleScreen().root, "nope")).toBe(null);
	});

	it("gets the parent, Slot, and index", () => {
		const location = findLocation(sampleScreen().root, "node-keyword");
		expect(location?.parent.id).toBe("node-search");
		expect(location?.slot).toBe("fields");
		expect(location?.index).toBe(0);
	});

	it("the root has no location", () => {
		expect(findLocation(sampleScreen().root, "node-page")).toBe(null);
	});
});

// The id becomes the file name directly, as `<dir>/<id>.json`.
describe("screen id constraints", () => {
	function withId(id: string) {
		return () => parseScreenDefinition({ ...sampleScreen(), id });
	}

	it("rejects an id containing a path", () => {
		expect(withId("../../victim/target")).toThrow();
		expect(withId("nested/child")).toThrow();
		expect(withId("/etc/passwd")).toThrow();
		expect(withId("a.b")).toThrow();
	});

	it("allows letters, digits, hyphens, and underscores", () => {
		expect(withId("customer-list")()).toMatchObject({ id: "customer-list" });
		expect(withId("Screen_1")()).toMatchObject({ id: "Screen_1" });
	});
});

// Fixture names go verbatim into `const <name>` and are referenced from binding
// expressions, so emit can never rename them — illegal names are rejected here.
describe("fixtures constraints", () => {
	function withFixtures(fixtures: Record<string, unknown>) {
		return () => parseScreenDefinition({ ...sampleScreen(), fixtures });
	}

	it("accepts identifier-named fixtures with arbitrary JSON values", () => {
		const screen = withFixtures({
			customers: [{ name: "A" }, { name: "B" }],
			$count: 2,
			_flag: null,
		})();
		expect(screen.fixtures).toEqual({
			customers: [{ name: "A" }, { name: "B" }],
			$count: 2,
			_flag: null,
		});
	});

	it("rejects a name that is not a JavaScript identifier", () => {
		expect(withFixtures({ "customer-rows": [] })).toThrow();
		expect(withFixtures({ "1st": [] })).toThrow();
		expect(withFixtures({ "a b": [] })).toThrow();
	});

	// Reserved words match the identifier pattern but `const class = ...` is a
	// SyntaxError; the strict-mode set matters because a Story is a module.
	it("rejects a name that is a reserved word", () => {
		expect(withFixtures({ class: [] })).toThrow("reserved word");
		expect(withFixtures({ default: [] })).toThrow("reserved word");
		expect(withFixtures({ null: [] })).toThrow("reserved word");
		expect(withFixtures({ let: [] })).toThrow("reserved word");
		expect(withFixtures({ static: [] })).toThrow("reserved word");
		expect(withFixtures({ await: [] })).toThrow("reserved word");
		expect(withFixtures({ eval: [] })).toThrow("reserved word");
		expect(withFixtures({ arguments: [] })).toThrow("reserved word");
	});

	it("rejects the identifiers the generated Story itself declares", () => {
		expect(withFixtures({ meta: {} })).toThrow();
		expect(withFixtures({ Meta: {} })).toThrow();
		expect(withFixtures({ StoryObj: {} })).toThrow();
	});

	// A fixture is emitted verbatim as Story source, so anything JSON.stringify
	// would drop or mangle has to be rejected before the screen is ever saved.
	it("rejects values that have no JSON form", () => {
		expect(withFixtures({ value: undefined })).toThrow();
		expect(withFixtures({ value: new Date() })).toThrow();
		expect(withFixtures({ value: new Map() })).toThrow();
		expect(withFixtures({ value: () => 1 })).toThrow();
		expect(withFixtures({ value: Number.NaN })).toThrow();
		expect(withFixtures({ value: Number.POSITIVE_INFINITY })).toThrow();
	});

	it("rejects a non-JSON value nested inside an otherwise valid fixture", () => {
		expect(withFixtures({ rows: [{ createdAt: new Date() }] })).toThrow();
		expect(withFixtures({ rows: { deep: [undefined] } })).toThrow();
	});
});

describe("bindingRootIdentifier", () => {
	it("returns the leading identifier of a member path", () => {
		expect(bindingRootIdentifier("customers.items")).toBe("customers");
		expect(bindingRootIdentifier("customers")).toBe("customers");
	});

	it("returns null for a non-emittable expression", () => {
		expect(bindingRootIdentifier("fn(a, b)")).toBe(null);
		expect(bindingRootIdentifier("a + b")).toBe(null);
	});
});

describe("repeat schema", () => {
	function withRepeat(repeat: unknown) {
		const screen = sampleScreen();
		return () =>
			parseScreenDefinition({
				...screen,
				root: {
					...screen.root,
					slots: {
						...screen.root.slots,
						body: [
							{
								id: "node-x",
								component: "Table",
								props: {},
								slots: {},
								repeat,
							},
						],
					},
				},
			});
	}

	it("accepts an integer", () => {
		const screen = withRepeat(3)();
		expect(findNode(screen.root, "node-x")?.repeat).toBe(3);
	});

	// Range is the validator's job (so the error carries nodeId / path); the
	// schema only rejects shapes that could never mean a copy count.
	it("rejects a non-integer", () => {
		expect(withRepeat(2.5)).toThrow();
		expect(withRepeat("3")).toThrow();
	});
});

describe("variants constraints", () => {
	function withVariants(variants: unknown, fixtures?: Record<string, unknown>) {
		return () =>
			parseScreenDefinition({
				...sampleScreen(),
				...(fixtures ? { fixtures } : {}),
				variants,
			});
	}

	it("accepts named variants carrying operations", () => {
		const screen = withVariants([
			{
				name: "Loading",
				description: "Every row replaced by a skeleton.",
				operations: [
					{ type: "setProps", nodeId: "node-table", props: { loading: true } },
				],
			},
			{ name: "Empty", operations: [] },
		])();
		expect(screen.variants?.map((variant) => variant.name)).toEqual([
			"Loading",
			"Empty",
		]);
		expect(screen.variants?.[0].operations).toHaveLength(1);
	});

	it("rejects a name that is not a JavaScript identifier", () => {
		expect(withVariants([{ name: "loading state", operations: [] }])).toThrow();
		expect(withVariants([{ name: "1st", operations: [] }])).toThrow();
	});

	// Same mechanism as fixture names: the name lands verbatim in an identifier
	// position (`export const <name>`), so a reserved word can never compile.
	it("rejects a name that is a reserved word", () => {
		expect(withVariants([{ name: "default", operations: [] }])).toThrow(
			"reserved word",
		);
		expect(withVariants([{ name: "class", operations: [] }])).toThrow(
			"reserved word",
		);
	});

	it("rejects the identifiers the generated Story itself declares", () => {
		expect(withVariants([{ name: "meta", operations: [] }])).toThrow();
		expect(withVariants([{ name: "Meta", operations: [] }])).toThrow();
		expect(withVariants([{ name: "StoryObj", operations: [] }])).toThrow();
	});

	it("rejects two variants sharing a name", () => {
		expect(
			withVariants([
				{ name: "Loading", operations: [] },
				{ name: "Loading", operations: [] },
			]),
		).toThrow("more than once");
	});

	it("rejects a variant name colliding with a fixture name", () => {
		expect(
			withVariants([{ name: "customers", operations: [] }], {
				customers: [],
			}),
		).toThrow("collides with a fixture");
	});

	it("rejects an operation with an unknown shape", () => {
		expect(
			withVariants([{ name: "Loading", operations: [{ type: "explode" }] }]),
		).toThrow();
	});
});
