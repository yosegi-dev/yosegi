import { describe, expect, it } from "bun:test";
import {
	expandRepeat,
	hasRepeat,
	MAX_EXPANDED_NODE_COUNT,
	RepeatBudgetExceededError,
	RepeatIdCollisionError,
} from "./repeat.ts";
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

	it("rejects nested repeats whose expanded total exceeds the budget", () => {
		// Three nested repeat: 20 expand to 20 + 400 + 8000 nodes — over 2000.
		const root = node("root", {
			slots: {
				children: [
					node("group", {
						repeat: 20,
						slots: {
							children: [
								node("row", {
									repeat: 20,
									slots: { children: [node("cell", { repeat: 20 })] },
								}),
							],
						},
					}),
				],
			},
		});
		expect(() => expandRepeat(root)).toThrow(RepeatBudgetExceededError);
	});

	it("fails an astronomically nested expansion before allocating anything", () => {
		// Eight nested repeat: 20 would be on the order of 20^8 (~25 billion)
		// nodes. The budget is checked arithmetically, so this returns instantly
		// instead of exhausting memory.
		let subtree = node("level-8", { repeat: 20 });
		for (let level = 7; level >= 1; level--) {
			subtree = node(`level-${level}`, {
				repeat: 20,
				slots: { children: [subtree] },
			});
		}
		const root = node("root", { slots: { children: [subtree] } });
		let caught: unknown;
		try {
			expandRepeat(root);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(RepeatBudgetExceededError);
		if (caught instanceof RepeatBudgetExceededError) {
			expect(caught.expandedCount).toBeGreaterThan(20 ** 8);
			expect(caught.message).toContain(`${MAX_EXPANDED_NODE_COUNT}`);
		}
	});

	it("allows an expansion that stays within the budget", () => {
		// 20 x 20 = 400 leaf copies plus their parents — well under 2000.
		const root = node("root", {
			slots: {
				children: [
					node("group", {
						repeat: 20,
						slots: { children: [node("row", { repeat: 20 })] },
					}),
				],
			},
		});
		const expanded = expandRepeat(root);
		expect(collectNodeIds(expanded)).toHaveLength(1 + 20 + 20 * 20);
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
