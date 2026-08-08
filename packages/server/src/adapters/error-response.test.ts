import { describe, expect, it } from "bun:test";
import { screenDefinitionSchema } from "@yosegi/core";
import { toErrorResponse } from "./error-response.ts";

// A Screen JSON schema violation only returns a zod issue, giving no clue to the "correct
// shape". Since bindings and events are asymmetric in shape, pin down that a hint appears
// when they're written incorrectly.
function schemaErrorFor(root: unknown): unknown {
	try {
		screenDefinitionSchema.parse({
			schemaVersion: "1.0",
			id: "s",
			name: "s",
			componentRegistryVersion: "v1",
			revision: 0,
			root,
		});
	} catch (error) {
		return error;
	}
	throw new Error("expected the payload to fail schema validation");
}

const node = (extra: Record<string, unknown>) => ({
	id: "root",
	component: "Box",
	props: {},
	slots: {},
	...extra,
});

describe("toErrorResponse", () => {
	it("bindings をオブジェクトで書いたら文字列で書くヒントを返す", () => {
		const { body } = toErrorResponse(
			schemaErrorFor(node({ bindings: { children: { expression: "count" } } })),
		);
		expect(body.error.code).toBe("INVALID_REQUEST");
		expect(body.error.hints).toEqual([
			expect.stringContaining('{ "children": "coupons.length" }'),
		]);
	});

	it("events を文字列で書いたら action / arguments のヒントを返す", () => {
		const { body } = toErrorResponse(
			schemaErrorFor(node({ events: { onClick: "navigate" } })),
		);
		expect(body.error.hints).toEqual([expect.stringContaining('"action"')]);
	});

	it("bindings / events と無関係なスキーマ違反にはヒントを付けない", () => {
		const { body } = toErrorResponse(schemaErrorFor(node({ id: 1 })));
		expect(body.error.code).toBe("INVALID_REQUEST");
		expect(body.error.hints).toBeUndefined();
	});
});
