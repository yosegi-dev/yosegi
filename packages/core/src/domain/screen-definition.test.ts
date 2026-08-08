import { describe, expect, it } from "bun:test";
import { sampleScreen } from "../test-fixtures.ts";
import {
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
