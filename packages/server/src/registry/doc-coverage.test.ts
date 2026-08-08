import { describe, expect, it } from "bun:test";
import {
	type ComponentManifest,
	componentManifestSchema,
	syntheticComponentManifests,
} from "@yosegi/core";
import {
	collectUndocumentedProps,
	summarizeDocCoverage,
} from "./doc-coverage.ts";

function manifest(
	id: string,
	props: ComponentManifest["props"],
	options: { recommended?: boolean } = {},
): ComponentManifest {
	return componentManifestSchema.parse({
		id,
		name: id.split("#")[1] ?? id,
		import: {
			packageName: `./${id.split("#")[0]}.tsx`,
			exportName: id.split("#")[1] ?? id,
		},
		props,
		slots: {},
		curation: { recommended: options.recommended ?? false },
	});
}

describe("summarizeDocCoverage", () => {
	it("description を持つ props と不透明な props を数える", () => {
		const stats = summarizeDocCoverage([
			manifest("ui/table#DataTable", {
				table: { kind: "json", required: true },
				caption: { kind: "string", description: "見出し" },
			}),
		]);
		expect(stats).toEqual({
			props: 2,
			documentedProps: 1,
			opaqueProps: 1,
			undocumentedRequiredOpaqueProps: 1,
			withUndocumentedRequiredOpaqueProps: 1,
		});
	});

	// Props that aren't required, or whose value can be written as a literal, aren't the "blocks implementation" combination.
	it("任意の不透明な props とリテラルを書ける props は required 集計に入れない", () => {
		const stats = summarizeDocCoverage([
			manifest("ui/chart#Chart", {
				formatter: { kind: "function" },
				variant: { kind: "enum", required: true, options: ["a", "b"] },
			}),
		]);
		expect(stats.opaqueProps).toBe(1);
		expect(stats.undocumentedRequiredOpaqueProps).toBe(0);
		expect(stats.withUndocumentedRequiredOpaqueProps).toBe(0);
	});

	it("同じコンポーネント内の複数件は props 数で数え、コンポーネント数は 1 にする", () => {
		const stats = summarizeDocCoverage([
			manifest("ui/form#Form", {
				schema: { kind: "json", required: true },
				onSubmit: { kind: "function", required: true },
			}),
			manifest("ui/text#Text", { value: { kind: "string", required: true } }),
		]);
		expect(stats.undocumentedRequiredOpaqueProps).toBe(2);
		expect(stats.withUndocumentedRequiredOpaqueProps).toBe(1);
	});

	// JSDoc consisting only of whitespace doesn't count as "written".
	it("空文字や空白だけの description は未記載として扱う", () => {
		const stats = summarizeDocCoverage([
			manifest("ui/box#Box", {
				data: { kind: "json", required: true, description: "   " },
			}),
		]);
		expect(stats.documentedProps).toBe(0);
		expect(stats.undocumentedRequiredOpaqueProps).toBe(1);
	});

	// Synthetic primitives are pseudo-components on the Yosegi side, not something the host is expected to write JSDoc for.
	it("合成プリミティブは分母から除く", () => {
		expect(summarizeDocCoverage(syntheticComponentManifests()).props).toBe(0);
	});
});

describe("collectUndocumentedProps", () => {
	it("required + 不透明 → 任意 + 不透明 → リテラルの順に並べる", () => {
		const report = collectUndocumentedProps([
			manifest("ui/a#A", {
				literal: { kind: "string", required: true },
				optionalOpaque: { kind: "json" },
				requiredOpaque: { kind: "json", required: true },
			}),
		]);
		expect(report.props.map((entry) => entry.prop)).toEqual([
			"requiredOpaque",
			"optionalOpaque",
			"literal",
		]);
		expect(report.props.map((entry) => entry.priority)).toEqual([
			"required-opaque",
			"optional-opaque",
			"required-literal",
		]);
		expect(report.totalCount).toBe(3);
		expect(report.requiredOpaqueCount).toBe(1);
	});

	// A Story is the only signal a host gives for "safe to use", so within the same priority it goes first.
	it("同順位なら Story を持つコンポーネントを先に出す", () => {
		const report = collectUndocumentedProps([
			manifest("ui/z#Z", { data: { kind: "json", required: true } }),
			manifest(
				"ui/a#A",
				{ data: { kind: "json", required: true } },
				{ recommended: true },
			),
		]);
		expect(report.props.map((entry) => entry.component)).toEqual([
			"ui/a#A",
			"ui/z#Z",
		]);
	});

	it("description を持つ props は載せない", () => {
		const report = collectUndocumentedProps([
			manifest("ui/a#A", {
				documented: { kind: "json", required: true, description: "行データ" },
			}),
		]);
		expect(report.totalCount).toBe(0);
		expect(report.props).toEqual([]);
	});

	// A shape read one level deep from the type is the only clue toward what should be written for a json prop.
	it("shape があればフィールドの手掛かりを添える", () => {
		const report = collectUndocumentedProps([
			manifest("ui/table#Table", {
				columns: {
					kind: "json",
					required: true,
					shape: {
						type: "Column",
						array: true,
						fields: [
							{ name: "header", type: "string" },
							{ name: "width", type: "number", optional: true },
						],
					},
				},
			}),
		]);
		expect(report.props[0].shape).toEqual({
			type: "Column[]",
			fields: ["header: string", "width?: number"],
		});
	});

	it("上限を超えた分は omitted に残して切り落とす", () => {
		const props = Object.fromEntries(
			Array.from({ length: 5 }, (_, i) => [
				`prop${i}`,
				{ kind: "json", required: true } as const,
			]),
		);
		const report = collectUndocumentedProps([manifest("ui/a#A", props)], {
			limit: 2,
		});
		expect(report.props).toHaveLength(2);
		expect(report.totalCount).toBe(5);
		expect(report.omitted).toBe(3);
	});

	it("切り落としが無ければ omitted を付けない", () => {
		const report = collectUndocumentedProps([
			manifest("ui/a#A", { data: { kind: "json", required: true } }),
		]);
		expect(report.omitted).toBeUndefined();
	});
});
