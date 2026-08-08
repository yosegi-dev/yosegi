import { describe, expect, it } from "bun:test";
import { sampleScreen } from "../test-fixtures.ts";
import { ComposerError, OPERATION_CODES } from "./errors.ts";
import {
	applyOperation,
	applyOperations,
	parseScreenOperation,
} from "./operation.ts";
import { collectNodeIds, findLocation, findNode } from "./screen-definition.ts";

describe("applyOperation: addNode", () => {
	it("adds a node to the end of a Slot", () => {
		const next = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: { id: "node-new", component: "Button", props: {}, slots: {} },
		});
		const body = next.root.slots.body;
		expect(body.at(-1)?.id).toBe("node-new");
	});

	it("controls the insertion position via index", () => {
		const next = applyOperation(sampleScreen(), {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body", index: 0 },
			node: { id: "node-new", component: "Button", props: {}, slots: {} },
		});
		expect(next.root.slots.body[0]?.id).toBe("node-new");
	});

	it("errors when id is duplicated", () => {
		expect(() =>
			applyOperation(sampleScreen(), {
				type: "addNode",
				target: { parentNodeId: "node-page", slot: "body" },
				node: { id: "node-table", component: "Button", props: {}, slots: {} },
			}),
		).toThrow(ComposerError);
	});

	it("errors when id is duplicated within the added subtree", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "addNode",
				target: { parentNodeId: "node-page", slot: "body" },
				node: {
					id: "node-wrap",
					component: "Box",
					props: {},
					slots: {
						children: [
							{ id: "dup", component: "Button", props: {}, slots: {} },
							{ id: "dup", component: "Button", props: {}, slots: {} },
						],
					},
				},
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.DUPLICATE_NODE_ID,
			);
		}
	});

	it("does not mutate the original screen (immutable)", () => {
		const original = sampleScreen();
		applyOperation(original, {
			type: "addNode",
			target: { parentNodeId: "node-page", slot: "body" },
			node: { id: "node-new", component: "Button", props: {}, slots: {} },
		});
		expect(collectNodeIds(original.root)).not.toContain("node-new");
	});
});

describe("applyOperation: removeNode", () => {
	it("removes a node", () => {
		const next = applyOperation(sampleScreen(), {
			type: "removeNode",
			nodeId: "node-table",
		});
		expect(findNode(next.root, "node-table")).toBe(null);
	});

	it("cannot remove the root", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "removeNode",
				nodeId: "node-page",
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.CANNOT_REMOVE_ROOT,
			);
		}
	});
});

describe("applyOperation: moveNode", () => {
	it("moves to a different Slot", () => {
		const next = applyOperation(sampleScreen(), {
			type: "moveNode",
			nodeId: "node-table",
			target: { parentNodeId: "node-search", slot: "fields" },
		});
		const location = findLocation(next.root, "node-table");
		expect(location?.parent.id).toBe("node-search");
	});

	it("cannot move into its own descendant", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "moveNode",
				nodeId: "node-search",
				target: { parentNodeId: "node-keyword", slot: "fields" },
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.CANNOT_MOVE_INTO_DESCENDANT,
			);
		}
	});
});

describe("applyOperation: setProps", () => {
	it("merges by default", () => {
		const next = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: { subtitle: "一覧" },
			merge: true,
		});
		const node = findNode(next.root, "node-header");
		expect(node?.props).toEqual({ title: "Customer list", subtitle: "一覧" });
	});

	it("replaces when merge=false", () => {
		const next = applyOperation(sampleScreen(), {
			type: "setProps",
			nodeId: "node-header",
			props: { title: "新タイトル" },
			merge: false,
		});
		expect(findNode(next.root, "node-header")?.props).toEqual({
			title: "新タイトル",
		});
	});
});

describe("applyOperation: duplicateNode", () => {
	it("a duplicated node is inserted right after its sibling, with a unique id", () => {
		const next = applyOperation(sampleScreen(), {
			type: "duplicateNode",
			nodeId: "node-table",
		});
		const body = next.root.slots.body;
		expect(body.map((n) => n.id)).toContain("node-table-copy");
		// The original and the duplicate don't share an id.
		const ids = collectNodeIds(next.root);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("reassigns ids for descendants too", () => {
		const next = applyOperation(sampleScreen(), {
			type: "duplicateNode",
			nodeId: "node-search",
		});
		const ids = collectNodeIds(next.root);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain("node-search-copy");
	});
});

describe("applyOperations", () => {
	it("applies multiple operations in sequence", () => {
		const next = applyOperations(sampleScreen(), [
			{
				type: "addNode",
				target: { parentNodeId: "node-page", slot: "body" },
				node: { id: "node-btn", component: "Button", props: {}, slots: {} },
			},
			{ type: "setProps", nodeId: "node-btn", props: { variant: "secondary" } },
		]);
		expect(findNode(next.root, "node-btn")?.props.variant).toBe("secondary");
	});
});

describe("parseScreenOperation", () => {
	it("fails on an unknown type", () => {
		expect(() =>
			parseScreenOperation({ type: "frobnicate", nodeId: "x" }),
		).toThrow();
	});
});

describe("applyOperation: moveNode within the same slot", () => {
	it("reorders within the same slot via index (evaluated post-detach)", () => {
		// body: [node-search(0), node-table(1)] → move node-search to index 1
		const next = applyOperation(sampleScreen(), {
			type: "moveNode",
			nodeId: "node-search",
			target: { parentNodeId: "node-page", slot: "body", index: 1 },
		});
		expect(next.root.slots.body.map((n) => n.id)).toEqual([
			"node-table",
			"node-search",
		]);
	});
});

describe("applyOperation: addNode out of range", () => {
	it("an out-of-range index yields SLOT_INDEX_OUT_OF_RANGE", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "addNode",
				target: { parentNodeId: "node-page", slot: "body", index: 99 },
				node: { id: "node-x", component: "Button", props: {}, slots: {} },
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.SLOT_INDEX_OUT_OF_RANGE,
			);
		}
	});
});

describe("applyOperation: replaceNode", () => {
	it("replaces a non-root node", () => {
		const next = applyOperation(sampleScreen(), {
			type: "replaceNode",
			nodeId: "node-table",
			node: { id: "node-btn", component: "Button", props: {}, slots: {} },
		});
		expect(findNode(next.root, "node-table")).toBe(null);
		expect(findNode(next.root, "node-btn")?.component).toBe("Button");
	});

	it("replaces the root node", () => {
		const next = applyOperation(sampleScreen(), {
			type: "replaceNode",
			nodeId: "node-page",
			node: { id: "node-root2", component: "Page", props: {}, slots: {} },
		});
		expect(next.root.id).toBe("node-root2");
	});

	it("replacing with an id that exists elsewhere yields DUPLICATE_NODE_ID", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "replaceNode",
				nodeId: "node-table",
				// node-header already exists in the header slot → the id collides after replacement.
				node: { id: "node-header", component: "Button", props: {}, slots: {} },
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.DUPLICATE_NODE_ID,
			);
		}
	});

	it("a duplicate id inside the replacement node yields DUPLICATE_NODE_ID", () => {
		try {
			applyOperation(sampleScreen(), {
				type: "replaceNode",
				nodeId: "node-table",
				node: {
					id: "node-dup",
					component: "Box",
					props: {},
					slots: {
						children: [
							{ id: "same", component: "Button", props: {}, slots: {} },
							{ id: "same", component: "Button", props: {}, slots: {} },
						],
					},
				},
			});
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as ComposerError).code).toBe(
				OPERATION_CODES.DUPLICATE_NODE_ID,
			);
		}
	});
});

describe("applyOperation: setBinding / setEvent", () => {
	it("setBinding merges by default", () => {
		const next = applyOperation(sampleScreen(), {
			type: "setBinding",
			nodeId: "node-table",
			bindings: { rows: "orders" },
		});
		// Merges into the existing rows/loading (rows is overwritten)
		expect(findNode(next.root, "node-table")?.bindings).toMatchObject({
			rows: "orders",
			loading: "customerQuery.isLoading",
		});
	});

	it("setEvent merges by default", () => {
		const next = applyOperation(sampleScreen(), {
			type: "setEvent",
			nodeId: "node-table",
			events: { onRowSelect: { action: "select" } },
		});
		const events = findNode(next.root, "node-table")?.events;
		expect(events?.onRowSelect?.action).toBe("select");
		expect(events?.onRowClick?.action).toBe("navigate");
	});
});
