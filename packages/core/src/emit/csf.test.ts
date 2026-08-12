import { describe, expect, it } from "bun:test";
import type { ComponentRegistry } from "../domain/component-manifest.ts";
import { parseComponentRegistry } from "../domain/component-manifest.ts";
import type { ScreenNode } from "../domain/screen-definition.ts";
import { parseScreenDefinition } from "../domain/screen-definition.ts";
import { withSyntheticComponents } from "../domain/synthetics.ts";
import { sampleRegistry, sampleScreen } from "../test-fixtures.ts";
import { buildImportMapResolver, emitCsf } from "./csf.ts";

// A lightweight ScreenNode builder that lets props / slots be omitted.
function node(
	id: string,
	component: string,
	extra: Partial<ScreenNode> = {},
): ScreenNode {
	return { id, component, props: {}, slots: {}, ...extra };
}

// A one-component registry for local-name collision cases.
function singleComponentRegistry(
	exportName: string,
	id = exportName,
): ComponentRegistry {
	return parseComponentRegistry({
		version: "v1",
		components: [
			{
				id,
				name: exportName,
				import: { packageName: "~/x", exportName },
				props: {},
				slots: {},
			},
		],
	});
}

function emit(
	root: ScreenNode,
	registry: ComponentRegistry = sampleRegistry(),
) {
	return emitCsf(root, withSyntheticComponents(registry), { title: "S/T" });
}

describe("emitCsf", () => {
	it("meta / default export / Story を CSF の形で出力する", () => {
		const source = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "Screens/顧客一覧",
		});
		expect(source).toContain(
			'import type { Meta, StoryObj } from "@storybook/react";',
		);
		expect(source).toContain('title: "Screens/顧客一覧",');
		expect(source).toContain("export default meta;");
		expect(source).toContain("export const Default: StoryObj = {");
		expect(source).toContain("\trender: () => (");
		expect(source.endsWith("};\n")).toBe(true);
	});

	it("storyName / frameworkPackage を差し替えられる", () => {
		const source = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "S/T",
			storyName: "Wide",
			frameworkPackage: "@storybook/react-vite",
		});
		expect(source).toContain(
			'import type { Meta, StoryObj } from "@storybook/react-vite";',
		);
		expect(source).toContain("export const Wide: StoryObj = {");
	});

	it("同一 specifier の import をまとめ、Registry 由来の import だけを出す", () => {
		const source = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "S/T",
		});
		expect(source).toContain(
			'import { Page, PageHeader } from "~/components/layout";',
		);
		expect(source).toContain('import { SearchForm } from "~/components/form";');
		expect(source).toContain('import { Table } from "~/components/table";');
	});

	it("import を specifier とメンバの昇順で並べる", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Zebra",
					name: "Zebra",
					import: { packageName: "~/z", exportName: "Zebra" },
					props: {},
					slots: { children: {} },
				},
				{
					id: "Beta",
					name: "Beta",
					import: { packageName: "~/a", exportName: "Beta" },
					props: {},
					slots: {},
				},
				{
					id: "Alpha",
					name: "Alpha",
					import: { packageName: "~/a", exportName: "Alpha" },
					props: {},
					slots: {},
				},
			],
		});
		const source = emit(
			node("root", "Zebra", {
				slots: { children: [node("b", "Beta"), node("a", "Alpha")] },
			}),
			registry,
		);
		const imports = source
			.split("\n")
			.filter((line) => line.startsWith("import {"));
		expect(imports).toEqual([
			'import { Alpha, Beta } from "~/a";',
			'import { Zebra } from "~/z";',
		]);
	});

	it("子がテキスト 1 つだけの要素は 1 行に畳む", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Badge",
					name: "Badge",
					import: { packageName: "~/badge", exportName: "Badge" },
					props: {},
					slots: { children: {} },
				},
			],
		});
		const source = emit(
			node("root", "Badge", {
				slots: { children: [node("t", "Text", { props: { text: "公開中" } })] },
			}),
			registry,
		);
		expect(source).toContain("<Badge>公開中</Badge>");
	});

	it("子が要素の場合は畳まず縦積みにする", () => {
		const source = emit(
			node("root", "Box", {
				props: { className: "p-6" },
				slots: {
					children: [node("inner", "Box", { slots: { children: [] } })],
				},
			}),
		);
		expect(source).toContain('<div className="p-6">\n');
	});

	it("局所名が別 specifier と衝突したら as で退避する", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Wrapper",
					name: "Wrapper",
					import: { packageName: "~/a", exportName: "Wrapper" },
					props: {},
					slots: { children: {} },
				},
				{
					id: "OtherCard",
					name: "OtherCard",
					import: { packageName: "~/b", exportName: "Card" },
					props: {},
					slots: {},
				},
				{
					id: "Card",
					name: "Card",
					import: { packageName: "~/c", exportName: "Card" },
					props: {},
					slots: {},
				},
			],
		});
		const source = emit(
			node("root", "Wrapper", {
				slots: { children: [node("a", "OtherCard"), node("b", "Card")] },
			}),
			registry,
		);
		expect(source).toContain('import { Card } from "~/b";');
		expect(source).toContain('import { Card as Card2 } from "~/c";');
		expect(source).toContain("<Card />");
		expect(source).toContain("<Card2 />");
	});

	it("specifier から拡張子と .stories を落とす", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Alert",
					name: "Alert",
					import: {
						packageName: "./app/components/alert.stories.tsx",
						exportName: "Alert",
					},
					props: {},
					slots: {},
				},
			],
		});
		const source = emit(node("root", "Alert"), registry);
		expect(source).toContain('import { Alert } from "./app/components/alert";');
	});

	it("合成プリミティブは import せず素の JSX へ展開する", () => {
		const source = emit(
			node("root", "Box", {
				props: { className: "p-6" },
				slots: {
					children: [
						node("h", "Heading", { props: { text: "顧客一覧" } }),
						node("t", "Text", { props: { text: "説明文" } }),
					],
				},
			}),
		);
		expect(source).not.toContain("@yosegi/synthetic");
		expect(source).toContain('<div className="p-6">');
		expect(source).toContain(
			'<h1 className="font-bold text-2xl tracking-tight">顧客一覧</h1>',
		);
		expect(source).toContain("説明文");
	});

	it("className の無い Box は素の div になる", () => {
		const source = emit(node("root", "Box", { slots: { children: [] } }));
		expect(source).toContain("<div />");
	});

	it("JSX に直接書けないテキストは式コンテナへ退避する", () => {
		const source = emit(
			node("root", "Box", {
				slots: {
					children: [
						node("a", "Text", { props: { text: "a < b" } }),
						node("b", "Text", { props: { text: " 前後空白 " } }),
						node("c", "Text", { props: { text: "" } }),
						node("d", "Text", { props: { text: "改行\nあり" } }),
					],
				},
			}),
		);
		expect(source).toContain('{"a < b"}');
		expect(source).toContain('{" 前後空白 "}');
		expect(source).toContain('{""}');
		expect(source).toContain('{"改行\\nあり"}');
	});

	it("単独のテキストは生テキストのまま書く", () => {
		const source = emit(
			node("root", "Box", {
				slots: { children: [node("a", "Text", { props: { text: "普通" } })] },
			}),
		);
		expect(source).toContain("<div>普通</div>");
	});

	// Adjacent raw text fuses into a single text node on read-back.
	it("隣接するテキストは式コンテナで境界を残す", () => {
		const source = emit(
			node("root", "Box", {
				slots: {
					children: [
						node("a", "Text", { props: { text: "alpha" } }),
						node("b", "Text", { props: { text: "beta" } }),
					],
				},
			}),
		);
		expect(source).toContain('{"alpha"}');
		expect(source).toContain('{"beta"}');
	});

	// Text isn't an expression, so it can't be placed directly as an attribute value or at the root.
	it("名前付き Slot とルートのテキストは Fragment で包む", () => {
		const inSlot = emit(
			node("root", "Page", {
				slots: { header: [node("t", "Text", { props: { text: "Hello" } })] },
			}),
		);
		expect(inSlot).toContain("header={<>Hello</>}");

		const asRoot = emit(node("root", "Text", { props: { text: "just text" } }));
		expect(asRoot).toContain("\t\t<>just text</>\n");
	});

	it("props を型ごとに直列化し、children / 関数は出力しない", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Widget",
					name: "Widget",
					import: { packageName: "~/widget", exportName: "Widget" },
					props: {},
					slots: {},
				},
			],
		});
		const source = emit(
			node("root", "Widget", {
				props: {
					label: "顧客",
					quoted: 'say "hi"',
					count: 3,
					open: true,
					closed: false,
					items: [1, 2],
					config: { a: 1 },
					empty: null,
					children: "ignored",
					onClick: () => undefined,
				},
			}),
			registry,
		);
		expect(source).toContain('label="顧客"');
		expect(source).toContain('quoted={"say \\"hi\\""}');
		expect(source).toContain("count={3}");
		expect(source).toContain(" open ");
		expect(source).toContain("closed={false}");
		expect(source).toContain("items={[1,2]}");
		expect(source).toContain('config={{"a":1}}');
		expect(source).toContain("empty={null}");
		expect(source).not.toContain("ignored");
		expect(source).not.toContain("onClick");
	});

	it("children Slot は JSX children、名前付き Slot は属性になる", () => {
		const source = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "S/T",
		});
		expect(source).toContain('header={<PageHeader title="Customer list" />}');
		expect(source).toContain("body={");
		expect(source).toContain("<>");
	});

	it("空の名前付き Slot は属性を出さない", () => {
		const source = emit(
			node("root", "Page", { slots: { header: [], body: [] } }),
		);
		expect(source).toContain("<Page />");
	});

	it("bindings / events を TODO コメントとして残す", () => {
		const source = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "S/T",
		});
		// Events keep not just the name but the action and arguments too, so implementers
		// can read what to wire up, and the declaration isn't lost when the Story is read back.
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"rows":"customers","loading":"customerQuery.isLoading"},"events":{"onRowClick":{"action":"navigate","arguments":{"to":"/customers/:customerId"}}}} */}',
		);
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"value":"filters.keyword"}} */}',
		);
	});

	it("引数の無いイベントは action だけを残す", () => {
		const source = emit(
			node("root", "Table", { events: { onRowClick: { action: "navigate" } } }),
		);
		expect(source).toContain(
			'{/* TODO(yosegi): {"events":{"onRowClick":{"action":"navigate"}}} */}',
		);
	});

	// If a value containing `*/` closed the comment, the rest of the source would break and the Story would stop working.
	it("値に */ を含んでもコメントを閉じない", () => {
		const source = emit(
			node("root", "Table", {
				bindings: { rows: "a */ b" },
				events: {
					onRowClick: { action: "navigate", arguments: { to: "/a*/b" } },
				},
			}),
		);
		expect(source).toContain('"rows":"a *\\/ b"');
		expect(source).toContain('"to":"/a*\\/b"');
		// The comment is only ever closed once.
		expect(source.split("*/").length - 1).toBe(1);
	});

	// Building this with delimiter characters would break read-back the moment the expression side contains the same character.
	it("区切り文字と同じ文字を含む式をそのまま残す", () => {
		const source = emit(
			node("root", "Table", {
				bindings: { rows: "total / count", "a←b": "x, y" },
			}),
		);
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"rows":"total / count","a←b":"x, y"}} */}',
		);
	});

	// bindings / events don't carry a value, but dropping even required props would
	// remove them from the generated output entirely, producing a Story that passes
	// neither tsc nor Storybook.
	describe("宣言だけの required Prop", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "DataTable",
					name: "DataTable",
					import: { packageName: "~/data-table", exportName: "DataTable" },
					props: {
						table: { kind: "json", required: true, editable: false },
						caption: { kind: "string" },
						onPageChange: { kind: "function", required: true, editable: false },
						onSort: { kind: "function", editable: false },
					},
					slots: {},
				},
			],
		});

		it("binding だけの required Prop は式として書く", () => {
			const source = emit(
				node("root", "DataTable", {
					bindings: { table: "table", onPageChange: "x" },
				}),
				registry,
			);
			expect(source).toContain("table={table}");
		});

		it("メンバー参照の binding も書ける", () => {
			const source = emit(
				node("root", "DataTable", {
					bindings: { table: "customerQuery.data.table", onPageChange: "x" },
				}),
				registry,
			);
			expect(source).toContain("table={customerQuery.data.table}");
		});

		// A binding expression is a free-form string that arrives from the Screen JSON.
		// Only identifiers and member references get written into the expression position;
		// anything else is not written (the validator prompts for a value and stops generation).
		it("識別子でない binding 式はコードとして書かない", () => {
			const source = emit(
				node("root", "DataTable", {
					bindings: {
						table: 'require("child_process").execSync("touch /tmp/PWNED")',
						onPageChange: "x",
					},
				}),
				registry,
			);
			expect(source).not.toContain('child_process")');
			expect(source).toContain("<DataTable");
		});

		it("required な関数 Prop は何もしないハンドラで埋める", () => {
			const source = emit(
				node("root", "DataTable", {
					props: { table: [] },
					events: { onPageChange: { action: "paginate" } },
				}),
				registry,
			);
			expect(source).toContain("onPageChange={() => {}}");
			expect(source).toContain(
				'{/* TODO(yosegi): {"events":{"onPageChange":{"action":"paginate"}}} */}',
			);
		});

		// A mock renders fine without an optional prop. Filling it in would only make the generated code harder to read.
		it("optional な Prop は宣言があっても書かない", () => {
			const source = emit(
				node("root", "DataTable", {
					props: { table: [] },
					bindings: { caption: "segment.name" },
					events: {
						onPageChange: { action: "paginate" },
						onSort: {
							action: "sort",
						},
					},
				}),
				registry,
			);
			expect(source).not.toContain("caption=");
			expect(source).not.toContain("onSort=");
		});

		it("値を持つ Prop は binding があっても値を優先する", () => {
			const source = emit(
				node("root", "DataTable", {
					props: { table: [{ id: 1 }] },
					bindings: { table: "table", onPageChange: "x" },
				}),
				registry,
			);
			expect(source).toContain('table={[{"id":1}]}');
			expect(source).not.toContain("table={table}");
		});
	});

	// when / each have no matching JSX in a mock, but if they disappeared the
	// declaration would be lost both on Story read-back and when handed to
	// implementation. Carried forward via a comment, same as bindings / events.
	it("when / each を TODO コメントとして残す", () => {
		const source = emit(
			node("root", "Box", {
				slots: {
					children: [
						node("row", "Box", {
							when: "customers.length > 0",
							each: "customers",
						}),
					],
				},
			}),
		);
		expect(source).toContain(
			'{/* TODO(yosegi): {"when":"customers.length > 0","each":"customers"} */}',
		);
	});

	it("bindings と each を 1 つのコメントにまとめる", () => {
		const source = emit(
			node("root", "Table", { bindings: { rows: "customers" }, each: "pages" }),
		);
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"rows":"customers"},"each":"pages"} */}',
		);
	});

	it("ルートに意図がある場合は Fragment で包んでコメントを残す", () => {
		const source = emit(
			node("root", "Table", { bindings: { rows: "customers" } }),
		);
		expect(source).toContain("<>");
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"rows":"customers"}} */}',
		);
		expect(source).toContain("</>");
	});

	// storyName / framework / import-map can arrive as arbitrary strings from the
	// CLI or MCP. Since Storybook executes the generated output directly, never let
	// them escape an identifier or string literal position.
	describe("生成オプションからのコード混入", () => {
		it("識別子にならない storyName を拒否する", () => {
			expect(() =>
				emitCsf(sampleScreen().root, sampleRegistry(), {
					title: "S/T",
					storyName:
						'X = (() => { require("child_process").execSync("touch /tmp/PWNED"); return {}; })() as any; export const Y',
				}),
			).toThrow("is not a valid JavaScript identifier");
			expect(() =>
				emitCsf(sampleScreen().root, sampleRegistry(), {
					title: "S/T",
					storyName: "1Story",
				}),
			).toThrow("is not a valid JavaScript identifier");
		});

		it("frameworkPackage を文字列リテラルとして書く", () => {
			const source = emitCsf(sampleScreen().root, sampleRegistry(), {
				title: "S/T",
				frameworkPackage: '@storybook/react"; import "./evil.ts"; //',
			});
			expect(source).toContain(
				'import type { Meta, StoryObj } from "@storybook/react\\"; import \\"./evil.ts\\"; //";',
			);
			expect(source).not.toContain('import "./evil.ts";');
		});

		it("import-map で置換した specifier を文字列リテラルとして書く", () => {
			const source = emitCsf(sampleScreen().root, sampleRegistry(), {
				title: "S/T",
				resolveImport: buildImportMapResolver(
					'~/components=x"; import "./evil.ts"; //',
				),
			});
			expect(source).not.toContain('import "./evil.ts";');
			expect(source).toContain('import \\"./evil.ts\\";');
		});

		it("識別子にならない export 名を持つ Registry を拒否する", () => {
			const registry = parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Evil",
						name: "Evil",
						import: {
							packageName: "~/components/evil",
							exportName: 'X } from "./evil.ts"; import { Y',
						},
						props: {},
						slots: {},
					},
				],
			});
			expect(() => emit(node("root", "Evil"), registry)).toThrow(
				"is not a valid JavaScript identifier",
			);
		});
	});

	it("未登録の component id は throw する", () => {
		expect(() => emit(node("root", "Unknown"))).toThrow(
			'Component "Unknown" (node "root") is not registered.',
		);
	});

	it("ホストが同名の実コンポーネントを登録していれば import を優先する", () => {
		const registry = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Text",
					name: "Text",
					import: { packageName: "~/components/text", exportName: "Text" },
					props: { text: { kind: "string" } },
					slots: {},
				},
			],
		});
		const source = emit(
			node("root", "Text", { props: { text: "実コンポーネント" } }),
			registry,
		);
		expect(source).toContain('import { Text } from "~/components/text";');
		expect(source).toContain('<Text text="実コンポーネント" />');
	});

	// Meta boilerplate (tags / parameters, JSDoc with design references) is
	// host-specific, so it's received and spliced in as a raw source fragment.
	// Yosegi never interprets its contents.
	describe("meta テンプレート", () => {
		it("JSDoc・import・プロパティを meta へ差し込む", () => {
			const source = emitCsf(sampleScreen().root, sampleRegistry(), {
				title: "Screens/顧客一覧",
				meta: {
					imports: [
						'import { DesignDocsPage } from "~/components/storybook/design-docs-page";',
					],
					jsdoc: "/**\n * Figma: https://example.com/file\n */",
					properties: [
						'tags: ["autodocs"]',
						"parameters: {\n\tdocs: { page: DesignDocsPage },\n}",
					],
				},
			});
			expect(source).toContain(
				'import { DesignDocsPage } from "~/components/storybook/design-docs-page";',
			);
			expect(source).toContain(
				"/**\n * Figma: https://example.com/file\n */\nconst meta: Meta = {",
			);
			// title is written by Yosegi; the template's properties follow after it.
			expect(source).toContain(
				'\ttitle: "Screens/顧客一覧",\n\ttags: ["autodocs"],\n\tparameters: {\n\t\tdocs: { page: DesignDocsPage },\n\t},\n};',
			);
		});

		it("生成済みの import と完全一致するテンプレート import は足さない", () => {
			const source = emitCsf(sampleScreen().root, sampleRegistry(), {
				title: "S/T",
				meta: {
					imports: ['import { Page, PageHeader } from "~/components/layout";'],
				},
			});
			expect(
				source
					.split("\n")
					.filter((line) => line.includes("~/components/layout")),
			).toHaveLength(1);
		});

		it("テンプレートを渡さなければ従来どおり title だけの meta になる", () => {
			const source = emitCsf(sampleScreen().root, sampleRegistry(), {
				title: "S/T",
			});
			expect(source).toContain('const meta: Meta = {\n\ttitle: "S/T",\n};');
		});
	});

	it("生成した CSF が sampleScreen で安定した全文になる", () => {
		const screen = parseScreenDefinition(sampleScreen());
		const source = emitCsf(screen.root, sampleRegistry(), {
			title: `Screens/${screen.name}`,
			resolveImport: buildImportMapResolver("~/components=~/ui"),
		});
		expect(source).toMatchSnapshot();
	});
});

describe("buildImportMapResolver", () => {
	it("プレフィックスを置換する", () => {
		const resolve = buildImportMapResolver("./app=~,./packages/x=@y");
		expect(resolve("./app/components/button")).toBe("~/components/button");
		expect(resolve("./packages/x/a")).toBe("@y/a");
	});

	it("一致しないパッケージ名はそのまま返す", () => {
		const resolve = buildImportMapResolver("./app=~");
		expect(resolve("react")).toBe("react");
	});

	it("空の指定は恒等関数になる", () => {
		expect(buildImportMapResolver("")("./app/x")).toBe("./app/x");
	});

	it("より長いプレフィックスを優先する", () => {
		const resolve = buildImportMapResolver("./app=~,./app/ui=@ui");
		expect(resolve("./app/ui/button")).toBe("@ui/button");
		expect(resolve("./app/other")).toBe("~/other");
	});

	it("= を含まないエントリは throw する", () => {
		expect(() => buildImportMapResolver("./app")).toThrow(
			'Invalid import map entry "./app". Expected "<from>=<to>".',
		);
	});
});

describe("emitCsf の default export", () => {
	function registryWithDefault(): ComponentRegistry {
		return parseComponentRegistry({
			version: "test:default",
			components: [
				{
					id: "EmptyStatePage",
					name: "EmptyStatePage",
					import: {
						packageName: "./app/components/examples/empty-state.tsx",
						exportName: "EmptyStatePage",
						kind: "default",
						specifier: "~/components/examples/empty-state",
					},
					props: {},
					slots: {},
				},
				{
					// A part that can also be pulled from the same file as a named export. Combined into one statement.
					id: "EmptyStateIllustration",
					name: "EmptyStateIllustration",
					import: {
						packageName: "./app/components/examples/empty-state.tsx",
						exportName: "EmptyStateIllustration",
						specifier: "~/components/examples/empty-state",
					},
					props: {},
					slots: {},
				},
			],
		});
	}

	it("default export は名前付きの波括弧を付けずに import する", () => {
		const source = emit(node("root", "EmptyStatePage"), registryWithDefault());
		expect(source).toContain(
			'import EmptyStatePage from "~/components/examples/empty-state";',
		);
	});

	it("同じ specifier の default と named は 1 文にまとめる", () => {
		const source = emit(
			node("root", "EmptyStatePage", {
				slots: { children: [node("i", "EmptyStateIllustration")] },
			}),
			registryWithDefault(),
		);
		expect(source).toContain(
			'import EmptyStatePage, { EmptyStateIllustration } from "~/components/examples/empty-state";',
		);
	});

	it("specifier があれば import map なしでもホストの書き方になる", () => {
		const source = emit(
			node("root", "EmptyStateIllustration"),
			registryWithDefault(),
		);
		expect(source).toContain(
			'import { EmptyStateIllustration } from "~/components/examples/empty-state";',
		);
	});

	it("--import-map を渡した場合は specifier より import map が勝つ", () => {
		const source = emitCsf(
			node("root", "EmptyStateIllustration"),
			withSyntheticComponents(registryWithDefault()),
			{
				title: "S/T",
				resolveImport: buildImportMapResolver("./app=@acme/ui"),
			},
		);
		expect(source).toContain(
			'import { EmptyStateIllustration } from "@acme/ui/components/examples/empty-state";',
		);
	});
});

// The generated file itself declares `const meta`, imports the Meta / StoryObj types,
// and exports the Story name. A host export sharing one of those names used to be
// imported verbatim, producing a duplicate identifier the host cannot compile.
describe("emitCsf のローカル名衝突", () => {
	it("ホストの export 名 Meta は Meta2 に退避する", () => {
		const source = emit(node("root", "Meta"), singleComponentRegistry("Meta"));
		expect(source).toContain('import { Meta as Meta2 } from "~/x";');
		expect(source).toContain("<Meta2 />");
		expect(source).toContain("const meta: Meta = {");
	});

	it("小文字の export 名は大文字始まりの別名を得る", () => {
		// A lowercase JSX tag is read as an HTML intrinsic element, so `meta` must not
		// appear in a tag position — and `Meta` is taken by the type import.
		const source = emit(node("root", "meta"), singleComponentRegistry("meta"));
		expect(source).toContain('import { meta as Meta2 } from "~/x";');
		expect(source).toContain("<Meta2 />");
	});

	it("StoryObj と衝突する export 名は StoryObj2 に退避する", () => {
		const source = emit(
			node("root", "StoryObj"),
			singleComponentRegistry("StoryObj"),
		);
		expect(source).toContain('import { StoryObj as StoryObj2 } from "~/x";');
		expect(source).toContain("<StoryObj2 />");
	});

	it("Story の export 名と衝突する export 名は退避する", () => {
		const source = emitCsf(
			node("root", "Default"),
			withSyntheticComponents(singleComponentRegistry("Default")),
			{ title: "S/T" },
		);
		expect(source).toContain('import { Default as Default2 } from "~/x";');
		expect(source).toContain("export const Default: StoryObj = {");
	});
});
