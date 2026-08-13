import { describe, expect, it } from "bun:test";
import type { ComponentRegistry, ScreenNode } from "@yosegi/core";
import { parseComponentRegistry, withSyntheticComponents } from "@yosegi/core";
import { buildImportMapResolver, emitCsf } from "@yosegi/core/emit";
import { sampleRegistry, sampleScreen } from "@yosegi/core/testing";
import { importStory, type StoryImportWarningCode } from "./story-importer.ts";

function registry(): ComponentRegistry {
	return withSyntheticComponents(sampleRegistry());
}

// node id isn't written into the Story and can't be reconstructed (the importer assigns it).
// When comparing structural equality, the id is stripped out.
type IdLess = Omit<ScreenNode, "id" | "slots"> & {
	slots: Record<string, IdLess[]>;
};

function stripIds(node: ScreenNode): IdLess {
	const { id: _id, slots, ...rest } = node;
	return {
		...rest,
		slots: Object.fromEntries(
			Object.entries(slots).map(([name, children]) => [
				name,
				children.map(stripIds),
			]),
		),
	};
}

function codes(warnings: { code: StoryImportWarningCode }[]): string[] {
	return warnings.map((warning) => warning.code);
}

function importSource(source: string, options: { storyName?: string } = {}) {
	return importStory({ source, registry: registry(), ...options });
}

describe("importStory", () => {
	// The top-priority guarantee: the upstream (Screen JSON -> Story) output can be read back as-is.
	describe("emitCsf とのラウンドトリップ", () => {
		it("sampleScreen は id 以外が完全に一致する", () => {
			const screen = sampleScreen();
			const source = emitCsf(screen.root, registry(), {
				title: "Screens/顧客一覧",
			});

			const imported = importStory({ source, registry: registry() });

			expect(imported.warnings).toEqual([]);
			expect(imported.title).toBe("Screens/顧客一覧");
			expect(imported.storyName).toBe("Default");
			expect(imported.root).not.toBeNull();
			expect(stripIds(imported.root as ScreenNode)).toEqual(
				stripIds(screen.root),
			);
		});

		it("bindings と events（action / 引数）まで復元する", () => {
			const screen = sampleScreen();
			const source = emitCsf(screen.root, registry(), { title: "S/T" });

			const root = importStory({ source, registry: registry() })
				.root as ScreenNode;
			const table = root.slots.body[1];

			expect(table.bindings).toEqual({
				rows: "customers",
				loading: "customerQuery.isLoading",
			});
			expect(table.events).toEqual({
				onRowClick: {
					action: "navigate",
					arguments: { to: "/customers/:customerId" },
				},
			});
		});

		it("合成プリミティブ（Box / Heading / Text）を復元する", () => {
			const root: ScreenNode = {
				id: "root",
				component: "Box",
				props: { className: "flex flex-col gap-4 p-6" },
				slots: {
					children: [
						{
							id: "heading",
							component: "Heading",
							props: { text: "顧客一覧" },
							slots: {},
						},
						{
							id: "text",
							component: "Text",
							props: { text: "説明文" },
							slots: {},
						},
					],
				},
			};
			const source = emitCsf(root, registry(), { title: "S/T" });

			const imported = importStory({ source, registry: registry() });

			expect(imported.warnings).toEqual([]);
			expect(stripIds(imported.root as ScreenNode)).toEqual(stripIds(root));
		});

		it("式コンテナへ退避したテキストも元の値に戻る", () => {
			const root: ScreenNode = {
				id: "root",
				component: "Box",
				props: {},
				slots: {
					children: [
						{
							id: "a",
							component: "Text",
							props: { text: "a < b" },
							slots: {},
						},
					],
				},
			};
			const source = emitCsf(root, registry(), { title: "S/T" });

			const imported = importStory({ source, registry: registry() });

			expect(stripIds(imported.root as ScreenNode)).toEqual(stripIds(root));
		});

		it("import-map で書き出した Story は同じ import-map で読み戻せる", () => {
			const screen = sampleScreen();
			const source = emitCsf(screen.root, registry(), {
				title: "S/T",
				resolveImport: buildImportMapResolver("~/components=@host/ui"),
			});

			const imported = importStory({
				source,
				registry: registry(),
				resolveImport: buildImportMapResolver("~/components=@host/ui"),
			});

			expect(imported.warnings).toEqual([]);
			expect(stripIds(imported.root as ScreenNode)).toEqual(
				stripIds(screen.root),
			);
		});

		it("props を型ごとに復元する", () => {
			const widgetRegistry = withSyntheticComponents(
				parseComponentRegistry({
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
				}),
			);
			const root: ScreenNode = {
				id: "root",
				component: "Widget",
				props: {
					label: "顧客",
					quoted: 'say "hi"',
					count: 3,
					negative: -1.5,
					open: true,
					closed: false,
					items: [1, 2],
					config: { a: 1 },
					empty: null,
				},
				slots: {},
			};
			const source = emitCsf(root, widgetRegistry, { title: "S/T" });

			const imported = importStory({ source, registry: widgetRegistry });

			expect(imported.warnings).toEqual([]);
			expect((imported.root as ScreenNode).props).toEqual(root.props);
		});
	});

	describe("メタ情報", () => {
		it("import 文を Registry の component id へ突き合わせる", () => {
			const source = emitCsf(sampleScreen().root, registry(), { title: "S/T" });

			const imported = importStory({ source, registry: registry() });

			expect(imported.imports).toContainEqual({
				specifier: "~/components/layout",
				exportName: "PageHeader",
				localName: "PageHeader",
				componentId: "PageHeader",
			});
			// A type-only import (Meta / StoryObj) isn't a building block, so it isn't picked up.
			expect(imported.imports.map((entry) => entry.localName)).not.toContain(
				"Meta",
			);
		});

		it("--story-name で取り込む Story を選べる", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'import { Button } from "~/components/shadcn-ui/button";',
				"",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"",
				"export const Default: StoryObj = { render: () => <Table /> };",
				"export const Wide: StoryObj = { render: () => <Button /> };",
			].join("\n");

			expect(importSource(source).root?.component).toBe("Table");
			expect(importSource(source, { storyName: "Wide" }).root?.component).toBe(
				"Button",
			);
		});

		it("存在しない Story 名は候補を添えて STORY_NOT_FOUND", () => {
			const source = [
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <div /> };",
			].join("\n");

			const imported = importSource(source, { storyName: "Nope" });

			expect(imported.root).toBeNull();
			expect(codes(imported.warnings)).toEqual(["STORY_NOT_FOUND"]);
			expect(imported.warnings[0].message).toContain("Default");
		});

		it("render を持たない Story は RENDER_NOT_STATIC", () => {
			const source = [
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				'export const Default: StoryObj = { args: { label: "ボタン" } };',
			].join("\n");

			const imported = importSource(source, { storyName: "Default" });

			expect(imported.root).toBeNull();
			expect(codes(imported.warnings)).toEqual(["RENDER_NOT_STATIC"]);
		});

		it("render が block でも return の JSX を取り出す", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => {",
				"\t\treturn <Table />;",
				"\t},",
				"};",
			].join("\n");

			expect(importSource(source).root?.component).toBe("Table");
		});

		it("静的に読めない title は TITLE_NOT_STATIC", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: prefix + "/顧客一覧" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(imported.title).toBeNull();
			expect(codes(imported.warnings)).toContain("TITLE_NOT_STATIC");
			// Only title failed to read. The tree is still returned.
			expect(imported.root?.component).toBe("Table");
		});
	});

	describe("解釈できない構文（不透明ノード）", () => {
		it("map 式は警告に載せ、読めた範囲を返す", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => (",
				"\t\t<div>",
				"\t\t\t{rows.map((row) => (",
				"\t\t\t\t<Table key={row.id} />",
				"\t\t\t))}",
				"\t\t\t<Table />",
				"\t\t</div>",
				"\t),",
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["OPAQUE_EXPRESSION"]);
			expect(imported.warnings[0].line).toBe(7);
			// The contents inside map are dropped, but the sibling Table remains.
			expect(imported.root?.component).toBe("Box");
			expect(imported.root?.slots.children).toHaveLength(1);
			expect(imported.root?.slots.children[0].component).toBe("Table");
		});

		it("静的に読めない prop は落として警告に載せる", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				'\trender: () => <Table loading={isLoading} className="p-6" />,',
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["OPAQUE_PROP"]);
			expect(imported.root?.props).toEqual({ className: "p-6" });
		});

		it("spread 属性は展開せず警告に載せる", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table {...args} /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["SPREAD_ATTRIBUTE"]);
			expect(imported.root?.props).toEqual({});
		});

		it("Registry に無いコンポーネントは局所名のまま残して警告に載せる", () => {
			const source = [
				'import { Unknown } from "~/components/unknown";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				'export const Default: StoryObj = { render: () => <Unknown title="x" /> };',
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["COMPONENT_NOT_RESOLVED"]);
			// The structure is preserved. The later validate step can surface COMPONENT_NOT_FOUND with candidates to fix it.
			expect(imported.root?.component).toBe("Unknown");
			expect(imported.root?.props).toEqual({ title: "x" });
		});

		it("対応する合成プリミティブが無い DOM タグは Box として残す", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				'\trender: () => <section className="p-6"><Table /></section>,',
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["OPAQUE_ELEMENT"]);
			expect(imported.root?.component).toBe("Box");
			expect(imported.root?.props).toEqual({ className: "p-6" });
			expect(imported.root?.slots.children[0].component).toBe("Table");
		});

		it("ルートが複数あるときは Box で束ねて警告に載せる", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => (",
				"\t\t<>",
				"\t\t\t<Table />",
				"\t\t\t<Table />",
				"\t\t</>",
				"\t),",
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["MULTIPLE_ROOTS"]);
			expect(imported.root?.component).toBe("Box");
			expect(imported.root?.props).toEqual({});
			expect(imported.root?.slots.children).toHaveLength(2);
		});
	});

	// when / each are declarations with no JSX of their own, so a comment is the only clue.
	it("意図コメントの when / each を読み戻す", () => {
		const source = [
			'const meta: Meta = { title: "S/T" };',
			"export default meta;",
			"export const Default: StoryObj = {",
			"\trender: () => (",
			"\t\t<div>",
			'\t\t\t{/* TODO(yosegi): {"when":"canEdit","each":"customers"} */}',
			'\t\t\t<div className="a" />',
			"\t\t</div>",
			"\t),",
			"};",
		].join("\n");

		const child = importSource(source).root?.slots.children[0];

		expect(child?.when).toBe("canEdit");
		expect(child?.each).toBe("customers");
	});

	// The emit side stopped assembling with delimiter characters, but Stories generated in that
	// format still exist on hosts, so the read side keeps accepting it.
	it("旧形式の意図コメントも読み戻す", () => {
		const source = [
			'const meta: Meta = { title: "S/T" };',
			"export default meta;",
			"export const Default: StoryObj = {",
			"\trender: () => (",
			"\t\t<div>",
			'\t\t\t{/* TODO(yosegi): bindings: value←filters.keyword / events: onClick→navigate {"to":"/x"} */}',
			'\t\t\t<div className="a" />',
			"\t\t</div>",
			"\t),",
			"};",
		].join("\n");

		const child = importSource(source).root?.slots.children[0];

		expect(child?.bindings).toEqual({ value: "filters.keyword" });
		expect(child?.events).toEqual({
			onClick: { action: "navigate", arguments: { to: "/x" } },
		});
	});

	it("Yosegi が書いたものではないコメントは意図として読まない", () => {
		const source = [
			'const meta: Meta = { title: "S/T" };',
			"export default meta;",
			"export const Default: StoryObj = {",
			"\trender: () => (",
			"\t\t<div>",
			"\t\t\t{/* あとで直す */}",
			'\t\t\t<div className="a" />',
			"\t\t</div>",
			"\t),",
			"};",
		].join("\n");

		const child = importSource(source).root?.slots.children[0];

		expect(child?.bindings).toBeUndefined();
		expect(child?.events).toBeUndefined();
	});

	// A Fragment used to swallow the intent before it (the comment applied to nothing,
	// with no warning either). One reconstructed node gets the intent; several get a warning.
	describe("Fragment 直前の意図コメント", () => {
		function fragmentSource(children: string[]): string {
			return [
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => (",
				"\t\t<div>",
				'\t\t\t{/* TODO(yosegi): {"bindings":{"label":"row.name"}} */}',
				"\t\t\t<>",
				...children.map((child) => `\t\t\t\t${child}`),
				"\t\t\t</>",
				"\t\t</div>",
				"\t),",
				"};",
			].join("\n");
		}

		it("1 ノードに展開される Fragment には intent を引き継ぐ", () => {
			const imported = importSource(fragmentSource(['<div className="a" />']));

			expect(imported.warnings).toEqual([]);
			expect(imported.root?.slots.children[0]?.bindings).toEqual({
				label: "row.name",
			});
		});

		it("複数ノードに展開される Fragment では INTENT_NOT_APPLIED を警告する", () => {
			const imported = importSource(
				fragmentSource(['<div className="a" />', '<div className="b" />']),
			);

			expect(codes(imported.warnings)).toEqual(["INTENT_NOT_APPLIED"]);
			const children = imported.root?.slots.children ?? [];
			expect(children).toHaveLength(2);
			expect(children[0]?.bindings).toBeUndefined();
			expect(children[1]?.bindings).toBeUndefined();
		});
	});

	// emit writes the intent comment directly before a Text node's raw text, so the
	// read side has to attach it there too — it used to be dropped in silence.
	it("生テキスト直前の意図コメントを Text ノードへ引き継ぐ", () => {
		const source = [
			'const meta: Meta = { title: "S/T" };',
			"export default meta;",
			"export const Default: StoryObj = {",
			"\trender: () => (",
			"\t\t<div>",
			'\t\t\t{/* TODO(yosegi): {"bindings":{"text":"user.name"}} */}',
			"\t\t\tHello",
			"\t\t</div>",
			"\t),",
			"};",
		].join("\n");

		const imported = importSource(source);

		expect(imported.warnings).toEqual([]);
		expect(imported.root?.slots.children[0]?.component).toBe("Text");
		expect(imported.root?.slots.children[0]?.bindings).toEqual({
			text: "user.name",
		});
	});

	describe("手書き Story", () => {
		it("テキストだけのインライン要素は Text へ畳む", () => {
			const source = [
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => (",
				"\t\t<div>",
				"\t\t\t<span>ラベル</span>",
				"\t\t\t<h2>見出し</h2>",
				"\t\t</div>",
				"\t),",
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(imported.warnings).toEqual([]);
			expect(imported.root?.slots.children.map((c) => c.component)).toEqual([
				"Text",
				"Heading",
			]);
			expect(imported.root?.slots.children[1].props).toEqual({
				text: "見出し",
			});
		});

		it("複数行に折り返したテキストは 1 行へ畳む", () => {
			const source = [
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => (",
				"\t\t<div>",
				"\t\t\t表示レイアウト確認用のサンプル値です。",
				"\t\t\t実データとは連動していません。",
				"\t\t</div>",
				"\t),",
				"};",
			].join("\n");

			const imported = importSource(source);

			expect(imported.root?.slots.children[0].props.text).toBe(
				"表示レイアウト確認用のサンプル値です。 実データとは連動していません。",
			);
		});

		it("値なしの属性は true として読む", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table loading /> };",
			].join("\n");

			expect(importSource(source).root?.props).toEqual({ loading: true });
		});

		it("import 元が Registry と違っても export 名が一意なら解決し警告に載せる", () => {
			const source = [
				'import { Table } from "~/legacy/table-v2";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["IMPORT_PATH_MISMATCH"]);
			expect(imported.root?.component).toBe("Table");
		});

		it("同じ export 名の候補が複数あるときは解決せず候補を出す", () => {
			const ambiguous = withSyntheticComponents(
				parseComponentRegistry({
					version: "v1",
					components: [
						{
							id: "a/card#Card",
							name: "Card",
							import: { packageName: "./a/card", exportName: "Card" },
							props: {},
							slots: {},
						},
						{
							id: "b/card#Card",
							name: "Card",
							import: { packageName: "./b/card", exportName: "Card" },
							props: {},
							slots: {},
						},
					],
				}),
			);
			const source = [
				'import { Card } from "~/somewhere/else";',
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Card /> };",
			].join("\n");

			const imported = importStory({ source, registry: ambiguous });

			expect(codes(imported.warnings)).toEqual([
				"COMPONENT_AMBIGUOUS",
				"COMPONENT_NOT_RESOLVED",
			]);
			expect(imported.warnings[0].message).toContain("a/card#Card");
			expect(imported.root?.component).toBe("Card");
		});
	});

	describe("fixtures の読み戻し", () => {
		it("トップレベルの const を JSON リテラルとして復元する", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"",
				'const customers = [\n\t{\n\t\t"name": "Sato"\n\t},\n\t{\n\t\t"name": "Suzuki"\n\t}\n];',
				"const pageSize = 20;",
				"",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(imported.warnings).toEqual([]);
			expect(imported.fixtures).toEqual({
				customers: [{ name: "Sato" }, { name: "Suzuki" }],
				pageSize: 20,
			});
		});

		// The inverse of emit writing a fixture-backed binding as `prop={expression}`.
		it("fixture を参照する属性式は binding として読み戻す", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"const customers = [];",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table rows={customers} /> };",
			].join("\n");

			const imported = importSource(source);

			expect(imported.warnings).toEqual([]);
			expect(imported.root?.bindings).toEqual({ rows: "customers" });
			expect(imported.root?.props).toEqual({});
		});

		it("fixture に無い識別子の属性式は従来どおり OPAQUE_PROP", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"const customers = [];",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table rows={orders} /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual(["OPAQUE_PROP"]);
			expect(imported.root?.bindings).toBeUndefined();
		});

		it("const meta は fixture として読まない", () => {
			const screen = sampleScreen();
			const source = emitCsf(screen.root, registry(), { title: "S/T" });

			expect(importSource(source).fixtures).toEqual({});
		});

		it("JSON リテラルでない const は OPAQUE_FIXTURE として警告する", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"const rows = buildRows();",
				"const helper = () => 1;",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual([
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
			]);
			expect(imported.warnings[0].message).toContain('"rows"');
			expect(imported.fixtures).toEqual({});
		});

		it("初期化後に変異された const は OPAQUE_FIXTURE として警告し fixture に読まない", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"const customers = [];",
				'const settings = { theme: "light" };',
				"const rows = [1, 2];",
				"const totals = { a: 1 };",
				"const extra = { a: 1 };",
				"const stats = { count: 0 };",
				"const series = { items: [1, 2] };",
				"const keep = [3, 4];",
				'customers.push({ name: "Sato" });',
				'settings.theme = "dark";',
				"rows[0] = 9;",
				"Object.assign(totals, { b: 2 });",
				"delete extra.a;",
				"stats.count++;",
				"series.items[0]--;",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual([
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
			]);
			for (const warning of imported.warnings) {
				expect(warning.message).toContain("mutated after initialization");
			}
			expect(imported.fixtures).toEqual({ keep: [3, 4] });
		});

		it("変異しないメソッド呼び出しやプロパティ参照は fixture を保つ", () => {
			const source = [
				'import { Table } from "~/components/table";',
				'const customers = [{ name: "Sato" }];',
				"customers.map((c) => c.name);",
				"customers.length;",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table rows={customers} /> };",
			].join("\n");

			const imported = importSource(source);

			expect(imported.warnings).toEqual([]);
			expect(imported.fixtures).toEqual({ customers: [{ name: "Sato" }] });
			expect(imported.root?.bindings).toEqual({ rows: "customers" });
		});

		it("let / var 宣言は OPAQUE_FIXTURE として警告し fixture に読まない", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"let rows = [1, 2];",
				"var pageSize = 20;",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			const imported = importSource(source);

			expect(codes(imported.warnings)).toEqual([
				"OPAQUE_FIXTURE",
				"OPAQUE_FIXTURE",
			]);
			expect(imported.warnings[0].message).toContain('"rows"');
			expect(imported.warnings[0].message).toContain('"let"');
			expect(imported.warnings[1].message).toContain('"pageSize"');
			expect(imported.warnings[1].message).toContain('"var"');
			expect(imported.fixtures).toEqual({});
		});

		it("export された const は fixture として読まない", () => {
			const source = [
				'import { Table } from "~/components/table";',
				"export const shared = [1, 2];",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
				"export const Default: StoryObj = { render: () => <Table /> };",
			].join("\n");

			expect(importSource(source).fixtures).toEqual({});
		});

		it("render を読めなくても fixtures は返す", () => {
			const source = [
				"const customers = [];",
				'const meta: Meta = { title: "S/T" };',
				"export default meta;",
			].join("\n");

			const imported = importSource(source);

			expect(imported.root).toBeNull();
			expect(imported.fixtures).toEqual({ customers: [] });
		});
	});
});
