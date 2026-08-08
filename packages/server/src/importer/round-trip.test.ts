import { describe, expect, it } from "bun:test";
import type { ComponentRegistry, ScreenNode } from "@yosegi/core";
import { withSyntheticComponents } from "@yosegi/core";
import { emitCsf } from "@yosegi/core/emit";
import * as ts from "typescript";
import { importStory } from "./story-importer.ts";

// Covers the emit -> import -> emit round trip with "values that break a naive implementation" —
// delimiter characters, JSX reserved characters, comment terminators, and the like. The Storybook
// on the host runs the generated Story as-is, so this also confirms the syntax isn't broken.

const registry: ComponentRegistry = withSyntheticComponents({
	version: "test:v1",
	components: [
		{
			id: "ui/card#Card",
			name: "Card",
			import: { packageName: "./ui/card", exportName: "Card" },
			props: { title: { kind: "string" } },
			slots: { children: {}, header: {}, footer: {} },
		},
		{
			id: "ui/button#Button",
			name: "Button",
			import: { packageName: "./ui/button", exportName: "Button" },
			props: { label: { kind: "string" } },
			slots: { children: {} },
		},
	],
});

function node(
	id: string,
	component: string,
	props: Record<string, unknown> = {},
	slots: Record<string, ScreenNode[]> = {},
	extra: Partial<ScreenNode> = {},
): ScreenNode {
	return { id, component, props, slots, ...extra };
}

// node id isn't written into the Story and the importer renumbers it, so only the structure is compared.
function shape(target: ScreenNode): unknown {
	return {
		component: target.component,
		props: target.props,
		bindings: target.bindings,
		events: target.events,
		when: target.when,
		each: target.each,
		slots: Object.fromEntries(
			Object.entries(target.slots)
				.filter(([, children]) => children.length > 0)
				.map(([name, children]) => [name, children.map(shape)]),
		),
	};
}

function syntaxErrors(source: string): string[] {
	const sourceFile = ts.createSourceFile(
		"round-trip.stories.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	// parseDiagnostics isn't part of the public API, but it's the only way to know whether there's a syntax error.
	const diagnostics = (
		sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }
	).parseDiagnostics;
	return diagnostics.map((diagnostic) =>
		ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
	);
}

const cases: { name: string; root: ScreenNode }[] = [
	{
		name: "名前付き Slot の中のテキスト",
		root: node(
			"card-1",
			"ui/card#Card",
			{},
			{ header: [node("t-1", "Text", { text: "Hello" })] },
		),
	},
	{
		name: "名前付き Slot の中の、JSX に書けない文字を含むテキスト",
		root: node(
			"card-1",
			"ui/card#Card",
			{},
			{ header: [node("t-1", "Text", { text: "a<b" })] },
		),
	},
	{
		name: "ルートがテキスト",
		root: node("t-1", "Text", { text: "just text" }),
	},
	{
		name: "改行を含むテキスト",
		root: node(
			"box-1",
			"Box",
			{},
			{ children: [node("t-1", "Text", { text: "line1\nline2" })] },
		),
	},
	{
		name: "隣り合うテキスト",
		root: node(
			"box-1",
			"Box",
			{},
			{
				children: [
					node("t-1", "Text", { text: "alpha" }),
					node("t-2", "Text", { text: "beta" }),
				],
			},
		),
	},
	{
		name: "テキストと要素が兄弟",
		root: node(
			"box-1",
			"Box",
			{},
			{
				children: [
					node("t-1", "Text", { text: "label" }),
					node("b-1", "ui/button#Button", { label: "ok" }),
				],
			},
		),
	},
	{
		name: "HTML エンティティを含むテキスト",
		root: node(
			"box-1",
			"Box",
			{},
			{ children: [node("t-1", "Text", { text: "Tom &amp; Jerry" })] },
		),
	},
	{
		name: "前後に空白があるテキスト",
		root: node(
			"box-1",
			"Box",
			{},
			{ children: [node("t-1", "Text", { text: "  padded  " })] },
		),
	},
	{
		name: "二重引用符を含む Box の className",
		root: node("box-1", "Box", { className: 'a"b' }),
	},
	{
		name: "波括弧を含む Box の className",
		root: node("box-1", "Box", { className: "a{b}" }),
	},
	{
		name: "二重引用符を含む Heading のテキスト",
		root: node("h-1", "Heading", { text: 'say "hi"' }),
	},
	{
		name: "HTML エンティティを含む string prop",
		root: node("btn-1", "ui/button#Button", { label: "A &amp; B" }),
	},
	{
		name: "山括弧を含む string prop",
		root: node("b-1", "ui/button#Button", { label: "a<b>c" }),
	},
	{
		name: "波括弧を含む string prop",
		root: node("b-1", "ui/button#Button", { label: "a{b}c" }),
	},
	{
		name: "改行を含む string prop",
		root: node("b-1", "ui/button#Button", { label: "a\nb" }),
	},
	{
		name: "object の prop",
		root: node("btn-1", "ui/button#Button", {
			label: "x",
			data: { a: 1, b: [true, null, "s"] },
		}),
	},
	{
		name: "セクション区切りと同じ文字を含む binding",
		root: node(
			"btn-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { label: "total / count" },
			},
		),
	},
	{
		name: "コメント終端を含む binding",
		root: node(
			"btn-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { label: "a */ b" },
			},
		),
	},
	{
		name: "カンマを含む binding",
		root: node(
			"btn-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { label: "fn(a, b)" },
			},
		),
	},
	{
		name: "binding の区切りと同じ文字を含む prop 名",
		root: node(
			"b-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { "a←b": "expr" },
			},
		),
	},
	{
		name: "binding の区切りと同じ文字を含む式",
		root: node(
			"b-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { label: "x←y" },
			},
		),
	},
	{
		name: "コメント終端を含む event の action",
		root: node(
			"b-1",
			"ui/button#Button",
			{},
			{},
			{
				events: { onClick: { action: "a*/b" } },
			},
		),
	},
	{
		name: "空白を含む event 名",
		root: node(
			"btn-1",
			"ui/button#Button",
			{},
			{},
			{
				events: { "on Click": { action: "go" } },
			},
		),
	},
	{
		name: "同じノードの binding と event 引数",
		root: node(
			"btn-1",
			"ui/button#Button",
			{},
			{},
			{
				bindings: { label: "user.name" },
				events: { onClick: { action: "navigate", arguments: { to: "/x" } } },
			},
		),
	},
	{
		name: "when / each の宣言",
		root: node(
			"box-1",
			"Box",
			{},
			{
				children: [
					node(
						"b-1",
						"ui/button#Button",
						{ label: "ok" },
						{},
						{ when: "canEdit", each: "customers" },
					),
				],
			},
		),
	},
	{
		name: "コメント終端を含む each",
		root: node(
			"box-1",
			"Box",
			{},
			{
				children: [node("b-1", "ui/button#Button", {}, {}, { each: "a */ b" })],
			},
		),
	},
	{
		name: "binding と each を併せ持つノード",
		root: node(
			"box-1",
			"Box",
			{},
			{
				children: [
					node(
						"b-1",
						"ui/button#Button",
						{},
						{},
						{ bindings: { label: "customer.name" }, each: "customers" },
					),
				],
			},
		),
	},
	{
		name: "意図コメント付きの子が複数ある名前付き Slot",
		root: node(
			"card-1",
			"ui/card#Card",
			{},
			{
				footer: [
					node(
						"b-1",
						"ui/button#Button",
						{ label: "ok" },
						{},
						{
							bindings: { label: "l1" },
						},
					),
					node("b-2", "ui/button#Button", { label: "ng" }),
				],
			},
		),
	},
	{
		name: "名前付き Slot の値が Heading",
		root: node(
			"c-1",
			"ui/card#Card",
			{},
			{ header: [node("h-1", "Heading", { text: "Title" })] },
		),
	},
	{
		name: "名前付き Slot の値が Box",
		root: node(
			"c-1",
			"ui/card#Card",
			{},
			{ header: [node("bx-1", "Box", { className: "z" })] },
		),
	},
	{
		name: "空の名前付き Slot",
		root: node("c-1", "ui/card#Card", {}, { header: [] }),
	},
	{
		name: "深い入れ子",
		root: node(
			"box-1",
			"Box",
			{ className: "a" },
			{
				children: [
					node(
						"box-2",
						"Box",
						{ className: "b" },
						{
							children: [
								node(
									"card-1",
									"ui/card#Card",
									{ title: "t" },
									{ children: [node("t-1", "Text", { text: "deep" })] },
								),
							],
						},
					),
				],
			},
		),
	},
];

describe("emitCsf と importStory のラウンドトリップ", () => {
	for (const testCase of cases) {
		it(`${testCase.name} を構文も構造も保ったまま往復する`, () => {
			const source = emitCsf(testCase.root, registry, { title: "S/T" });
			expect(syntaxErrors(source)).toEqual([]);

			const imported = importStory({ source, registry });
			expect(imported.root).not.toBeNull();
			expect(shape(imported.root as ScreenNode)).toEqual(shape(testCase.root));
		});
	}

	// If the source rewritten after reading it back matches the original, editing a Story and
	// round-tripping it doesn't produce diff noise.
	it("2 周目以降の生成結果が一致する", () => {
		const root = node(
			"card-1",
			"ui/card#Card",
			{ title: "Dashboard" },
			{
				header: [node("h-1", "Heading", { text: "Hi" })],
				children: [
					node(
						"box-1",
						"Box",
						{ className: "flex gap-2" },
						{
							children: [
								node(
									"b-1",
									"ui/button#Button",
									{ label: "Save" },
									{},
									{
										bindings: { label: "t.save" },
										events: {
											onClick: {
												action: "submit",
												arguments: { form: "main" },
											},
										},
									},
								),
								node("t-1", "Text", { text: "or" }),
								node(
									"b-2",
									"ui/button#Button",
									{ label: "Cancel" },
									{ children: [node("t-2", "Text", { text: "x" })] },
								),
							],
						},
					),
				],
				footer: [node("t-3", "Text", { text: "footnote" })],
			},
		);

		const first = emitCsf(root, registry, { title: "S/Dash" });
		const reimported = importStory({ source: first, registry }).root;
		const second = emitCsf(reimported as ScreenNode, registry, {
			title: "S/Dash",
		});

		expect(second).toBe(first);
	});
});

describe("default export のラウンドトリップ", () => {
	const withDefaultExport: ComponentRegistry = withSyntheticComponents({
		version: "test:default",
		components: [
			{
				id: "examples/empty-state#EmptyStatePage",
				name: "EmptyStatePage",
				import: {
					packageName: "./app/examples/empty-state.tsx",
					exportName: "EmptyStatePage",
					kind: "default",
					specifier: "~/examples/empty-state",
				},
				props: { heading: { kind: "string" } },
				slots: {},
			},
		],
	});

	it("default import で書かれた Story を元の component id へ戻せる", () => {
		const root = node("root", "examples/empty-state#EmptyStatePage", {
			heading: "データがありません",
		});
		const source = emitCsf(root, withDefaultExport, { title: "S/T" });
		expect(source).toContain(
			'import EmptyStatePage from "~/examples/empty-state";',
		);

		const imported = importStory({
			source,
			registry: withDefaultExport,
			fileName: "empty.stories.tsx",
		});
		expect(imported.warnings).toEqual([]);
		expect(imported.root?.component).toBe(
			"examples/empty-state#EmptyStatePage",
		);
		expect(imported.root?.props.heading).toBe("データがありません");
	});
});
