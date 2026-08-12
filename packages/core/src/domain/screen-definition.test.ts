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

	it("rejects the identifiers the generated Story itself declares", () => {
		expect(withFixtures({ meta: {} })).toThrow();
		expect(withFixtures({ Meta: {} })).toThrow();
		expect(withFixtures({ StoryObj: {} })).toThrow();
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
