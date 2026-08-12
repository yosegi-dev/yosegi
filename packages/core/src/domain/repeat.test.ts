import { describe, expect, it } from "bun:test";
import { expandRepeat, hasRepeat, RepeatIdCollisionError } from "./repeat.ts";
import type { ScreenNode } from "./screen-definition.ts";
import { collectNodeIds } from "./screen-definition.ts";

function node(id: string, extra: Partial<ScreenNode> = {}): ScreenNode {
	return { id, component: "Box", props: {}, slots: {}, ...extra };
}

describe("expandRepeat", () => {
	it("returns the tree unchanged when nothing declares repeat", () => {
		const root = node("root", {
			slots: { children: [node("child")] },
		});
		expect(expandRepeat(root)).toEqual(root);
		expect(hasRepeat(root)).toBe(false);
	});

	it("expands a repeated node into N copies with -1..-N id suffixes", () => {
		const root = node("root", {
			slots: {
				children: [
					node("row", {
						repeat: 3,
						slots: { children: [node("cell")] },
					}),
				],
			},
		});
		const expanded = expandRepeat(root);
		expect(collectNodeIds(expanded)).toEqual([
			"root",
			"row-1",
			"cell-1",
			"row-2",
			"cell-2",
			"row-3",
			"cell-3",
		]);
		// The copies no longer carry repeat, so re-expanding is a no-op.
		expect(hasRepeat(expanded)).toBe(false);
	});

	it("does not mutate the input tree", () => {
		const root = node("root", {
			slots: { children: [node("row", { repeat: 2 })] },
		});
		expandRepeat(root);
		expect(collectNodeIds(root)).toEqual(["root", "row"]);
		expect(root.slots.children[0].repeat).toBe(2);
	});

	it("keeps siblings and copies props / bindings / each on every copy", () => {
		const root = node("root", {
			slots: {
				children: [
					node("head"),
					node("row", {
						component: "Card",
						props: { title: "t" },
						bindings: { title: "customer.name" },
						each: "customer in customers",
						repeat: 2,
					}),
				],
			},
		});
		const expanded = expandRepeat(root);
		const children = expanded.slots.children;
		expect(children.map((child) => child.id)).toEqual([
			"head",
			"row-1",
			"row-2",
		]);
		expect(children[1]).toMatchObject({
			component: "Card",
			props: { title: "t" },
			bindings: { title: "customer.name" },
			each: "customer in customers",
		});
		expect(children[1].repeat).toBeUndefined();
	});

	it("expands nested repeats inner-first, composing the suffixes", () => {
		const root = node("root", {
			slots: {
				children: [
					node("group", {
						repeat: 2,
						slots: { children: [node("item", { repeat: 2 })] },
					}),
				],
			},
		});
		expect(collectNodeIds(expandRepeat(root))).toEqual([
			"root",
			"group-1",
			"item-1-1",
			"item-2-1",
			"group-2",
			"item-1-2",
			"item-2-2",
		]);
	});

	it("throws RepeatIdCollisionError when an expanded id already exists", () => {
		const root = node("root", {
			slots: {
				children: [node("row", { repeat: 2 }), node("row-2")],
			},
		});
		expect(() => expandRepeat(root)).toThrow(RepeatIdCollisionError);
	});

	it("rejects repeat on the root", () => {
		expect(() => expandRepeat(node("root", { repeat: 2 }))).toThrow(
			'The root node "root" cannot carry "repeat"',
		);
	});

	it("rejects an out-of-range count as a safety net", () => {
		const belowMin = node("root", {
			slots: { children: [node("row", { repeat: 1 })] },
		});
		const aboveMax = node("root", {
			slots: { children: [node("row", { repeat: 21 })] },
		});
		expect(() => expandRepeat(belowMin)).toThrow("expected an integer");
		expect(() => expandRepeat(aboveMax)).toThrow("expected an integer");
	});
});
