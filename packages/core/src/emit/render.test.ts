import { describe, expect, it } from "bun:test";
import { indexRegistry } from "../domain/component-manifest.ts";
import type { ScreenNode } from "../domain/screen-definition.ts";
import { withSyntheticComponents } from "../domain/synthetics.ts";
import { sampleRegistry } from "../test-fixtures.ts";
import {
	decodeIntent,
	encodeIntent,
	type RenderContext,
	renderRoot,
} from "./render.ts";

// A lightweight ScreenNode builder that lets props / slots be omitted.
function node(
	id: string,
	component: string,
	extra: Partial<ScreenNode> = {},
): ScreenNode {
	return { id, component, props: {}, slots: {}, ...extra };
}

function context(fixtureNames: string[] = []): RenderContext {
	return {
		manifests: indexRegistry(withSyntheticComponents(sampleRegistry())),
		// The plan csf.ts derives is not under test here; the map is written by hand.
		localNames: new Map([
			["Table", "Table"],
			["Button", "Button"],
		]),
		fixtureNames: new Set(fixtureNames),
	};
}

describe("encodeIntent / decodeIntent", () => {
	it("エンコードした宣言をそのまま復元する", () => {
		const payload = {
			bindings: { rows: "customers", label: "a, b ← c" },
			events: {
				onRowClick: { action: "navigate", arguments: { to: "/customers/:id" } },
			},
			when: "customers.length > 0",
			each: "customer in customers",
		};
		const decoded = decodeIntent(encodeIntent(payload));
		expect(decoded).toEqual(payload);
	});

	it("*/ をコメントを閉じない形にエスケープし、復元で元へ戻す", () => {
		const encoded = encodeIntent({ bindings: { rows: "a */ b" } });
		expect(encoded).not.toContain("*/");
		expect(decodeIntent(encoded)?.bindings).toEqual({ rows: "a */ b" });
	});

	it("持たない項目は空の既定値で埋めて返す", () => {
		expect(decodeIntent(encodeIntent({ when: "x" }))).toEqual({
			bindings: {},
			events: {},
			when: "x",
			each: null,
		});
	});

	it("JSON でない・形が違う入力は null を返す", () => {
		expect(decodeIntent("not json")).toBeNull();
		expect(decodeIntent('{"bindings": "not-a-record"}')).toBeNull();
	});
});

describe("renderRoot", () => {
	it("コンポーネントのルートを JSX 行として描画する", () => {
		const lines = renderRoot(
			node("root", "Table", { props: { loading: true } }),
			context(),
		);
		expect(lines).toEqual(["<Table loading />"]);
	});

	it("テキストのルートは式になるよう Fragment で包む", () => {
		const lines = renderRoot(
			node("root", "Text", { props: { text: "just text" } }),
			context(),
		);
		expect(lines).toEqual(["<>just text</>"]);
	});

	it("意図を持つルートは Fragment で包んでコメントを添える", () => {
		const lines = renderRoot(
			node("root", "Table", { bindings: { rows: "customers" } }),
			context(),
		);
		expect(lines[0]).toBe("<>");
		expect(lines[1]).toContain(
			'TODO(yosegi): {"bindings":{"rows":"customers"}}',
		);
		expect(lines.at(-1)).toBe("</>");
	});

	it("fixture を先頭に持つ binding は式として書く", () => {
		const lines = renderRoot(
			node("root", "Table", { bindings: { rows: "customers" } }),
			context(["customers"]),
		);
		expect(lines.join("\n")).toContain("rows={customers}");
	});

	it("未登録の component id は throw する", () => {
		expect(() => renderRoot(node("root", "Unknown"), context())).toThrow(
			'Component "Unknown" (node "root") is not registered.',
		);
	});
});
