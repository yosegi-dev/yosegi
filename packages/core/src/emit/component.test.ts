import { describe, expect, it } from "bun:test";
import type { ComponentRegistry } from "../domain/component-manifest.ts";
import { parseComponentRegistry } from "../domain/component-manifest.ts";
import type { ScreenNode } from "../domain/screen-definition.ts";
import { parseScreenDefinition } from "../domain/screen-definition.ts";
import { withSyntheticComponents } from "../domain/synthetics.ts";
import { sampleRegistry, sampleScreen } from "../test-fixtures.ts";
import { emitComponent } from "./component.ts";
import { emitCsf } from "./csf.ts";

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
	return emitComponent(root, withSyntheticComponents(registry));
}

describe("emitComponent", () => {
	it("import・export された関数コンポーネントの形で出力する", () => {
		const source = emitComponent(sampleScreen().root, sampleRegistry());
		expect(source).toContain('import type { ReactElement } from "react";');
		expect(source).toContain(
			'import { Page, PageHeader } from "~/components/layout";',
		);
		expect(source).toContain("export function Screen(): ReactElement {");
		expect(source).toContain("\treturn (");
		expect(source).toContain('<PageHeader title="Customer list" />');
		expect(source.endsWith("}\n")).toBe(true);
	});

	it("CSF 固有の要素(meta / Story 型 / title)を含まない", () => {
		const source = emitComponent(sampleScreen().root, sampleRegistry());
		expect(source).not.toContain("Meta");
		expect(source).not.toContain("StoryObj");
		expect(source).not.toContain("const meta");
		expect(source).not.toContain("title:");
		expect(source).not.toContain("@storybook");
	});

	it("componentName を差し替えられ、識別子でない名前は拒否する", () => {
		const source = emitComponent(sampleScreen().root, sampleRegistry(), {
			componentName: "CustomerList",
		});
		expect(source).toContain("export function CustomerList(): ReactElement {");
		expect(() =>
			emitComponent(sampleScreen().root, sampleRegistry(), {
				componentName: "1st screen",
			}),
		).toThrow("is not a valid JavaScript identifier");
	});

	it("bindings / events を CSF と同じ TODO コメントとして残す", () => {
		const source = emitComponent(sampleScreen().root, sampleRegistry());
		expect(source).toContain(
			'{/* TODO(yosegi): {"bindings":{"rows":"customers","loading":"customerQuery.isLoading"},"events":{"onRowClick":{"action":"navigate","arguments":{"to":"/customers/:customerId"}}}} */}',
		);
	});

	it("同じ画面から CSF と同一の JSX を描画する", () => {
		// The two targets share the renderer and the import plan; only the
		// document around the JSX differs. Compare the render bodies directly.
		const csf = emitCsf(sampleScreen().root, sampleRegistry(), {
			title: "S/T",
		});
		const component = emitComponent(sampleScreen().root, sampleRegistry());
		const csfJsx = csf
			.slice(csf.indexOf("render: () => ("), csf.lastIndexOf("),"))
			.split("\n")
			.slice(1)
			.map((line) => line.trim());
		const componentJsx = component
			.slice(component.indexOf("return ("), component.lastIndexOf(");"))
			.split("\n")
			.slice(1)
			.map((line) => line.trim());
		expect(componentJsx).toEqual(csfJsx);
	});

	it("fixtures を import の後・export の前に const として出力する", () => {
		const source = emitComponent(sampleScreen().root, sampleRegistry(), {
			fixtures: { customers: [{ name: "Sato" }], pageSize: 20 },
		});
		const imports = source.indexOf("import type { ReactElement }");
		const customers = source.indexOf("const customers = [");
		const pageSize = source.indexOf("const pageSize = 20;");
		const exported = source.indexOf("export function Screen");
		expect(imports).toBeGreaterThanOrEqual(0);
		expect(customers).toBeGreaterThan(imports);
		expect(pageSize).toBeGreaterThan(customers);
		expect(exported).toBeGreaterThan(pageSize);
	});

	it("fixture を参照する binding は optional な Prop でも式として書く", () => {
		const root = node("root", "Table", { bindings: { rows: "customers" } });
		const source = emitComponent(
			root,
			withSyntheticComponents(sampleRegistry()),
			{ fixtures: { customers: [] } },
		);
		expect(source).toContain("const customers = [];");
		expect(source).toContain("rows={customers}");
	});

	it("repeat を持つノードを複製として展開する", () => {
		const source = emit(
			node("root", "Box", {
				slots: {
					children: [
						node("row", "Table", { props: { loading: false }, repeat: 3 }),
					],
				},
			}),
		);
		expect(source.split("<Table loading={false} />").length - 1).toBe(3);
	});

	describe("variants", () => {
		it("ベースと各 variant を複数の export function として 1 ファイルに出力する", () => {
			const source = emitComponent(sampleScreen().root, sampleRegistry(), {
				variants: [
					{
						name: "Loading",
						operations: [
							{
								type: "setProps",
								nodeId: "node-table",
								props: { loading: true },
							},
						],
					},
					{
						name: "Empty",
						operations: [{ type: "removeNode", nodeId: "node-table" }],
					},
				],
			});
			expect(source).toContain("export function Screen(): ReactElement {");
			expect(source).toContain("export function Loading(): ReactElement {");
			expect(source).toContain("export function Empty(): ReactElement {");
			// The type import appears exactly once, shared by every export.
			expect(
				source.split('import type { ReactElement } from "react";').length - 1,
			).toBe(1);
		});

		it("variant には operations を適用した木が描画される", () => {
			const source = emitComponent(sampleScreen().root, sampleRegistry(), {
				variants: [
					{
						name: "Loading",
						operations: [
							{
								type: "setProps",
								nodeId: "node-table",
								props: { loading: true },
							},
						],
					},
				],
			});
			const base = source.slice(0, source.indexOf("export function Loading"));
			const variant = source.slice(source.indexOf("export function Loading"));
			expect(base).not.toContain("<Table loading");
			expect(variant).toContain("loading");
		});

		it("description を export 直上の JSDoc として出力する", () => {
			const source = emitComponent(sampleScreen().root, sampleRegistry(), {
				variants: [
					{
						name: "Empty",
						description: "No customers yet.",
						operations: [{ type: "removeNode", nodeId: "node-table" }],
					},
				],
			});
			expect(source).toContain(
				"/** No customers yet. */\nexport function Empty(): ReactElement {",
			);
		});

		it("variant だけが使うコンポーネントの import も出力する", () => {
			const source = emitComponent(sampleScreen().root, sampleRegistry(), {
				variants: [
					{
						name: "Empty",
						operations: [
							{ type: "removeNode", nodeId: "node-table" },
							{
								type: "addNode",
								target: { parentNodeId: "node-page", slot: "body" },
								node: {
									id: "node-banner",
									component: "LegacyBanner",
									props: {},
									slots: {},
								},
							},
						],
					},
				],
			});
			expect(source).toContain(
				'import { LegacyBanner } from "~/components/legacy";',
			);
			expect(source.split('from "~/components/legacy"').length - 1).toBe(1);
		});
	});

	describe("ローカル名の衝突", () => {
		it("component 名と衝突する export 名は退避する", () => {
			const source = emitComponent(
				node("root", "Screen"),
				withSyntheticComponents(singleComponentRegistry("Screen")),
			);
			expect(source).toContain('import { Screen as Screen2 } from "~/x";');
			expect(source).toContain("<Screen2 />");
			expect(source).toContain("export function Screen(): ReactElement {");
		});

		it("ReactElement と衝突する export 名は退避する", () => {
			const source = emitComponent(
				node("root", "ReactElement"),
				withSyntheticComponents(singleComponentRegistry("ReactElement")),
			);
			expect(source).toContain(
				'import { ReactElement as ReactElement2 } from "~/x";',
			);
			expect(source).toContain("<ReactElement2 />");
			expect(source).toContain('import type { ReactElement } from "react";');
		});

		// Kept identical to the CSF target on purpose: planImports reserves the
		// CSF names in both targets, so the same screen renders the same JSX.
		it("CSF 予約名(Meta)と衝突する export 名もここで退避する", () => {
			const source = emitComponent(
				node("root", "Meta"),
				withSyntheticComponents(singleComponentRegistry("Meta")),
			);
			expect(source).toContain('import { Meta as Meta2 } from "~/x";');
			expect(source).toContain("<Meta2 />");
		});

		it("fixture 名と衝突する export 名は退避する", () => {
			const source = emitComponent(
				node("root", "Card"),
				withSyntheticComponents(singleComponentRegistry("Card")),
				{ fixtures: { Card: { label: "x" } } },
			);
			expect(source).toContain('import { Card as Card2 } from "~/x";');
			expect(source).toContain("<Card2 />");
			expect(source).toContain("const Card = {");
		});
	});

	describe("名前の検証", () => {
		it("component 名と衝突する fixture 名を拒否する", () => {
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					fixtures: { Screen: [] },
				}),
			).toThrow("collides with the component export name");
		});

		it("ReactElement を fixture 名として拒否する", () => {
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					fixtures: { ReactElement: [] },
				}),
			).toThrow("not writable as a top-level const");
		});

		it("component 名・fixture・variant 同士の名前衝突を拒否する", () => {
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					variants: [{ name: "Screen", operations: [] }],
				}),
			).toThrow("collides with the component export name");
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					fixtures: { Empty: [] },
					variants: [{ name: "Empty", operations: [] }],
				}),
			).toThrow("collides with a fixture name");
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					variants: [
						{ name: "Empty", operations: [] },
						{ name: "Empty", operations: [] },
					],
				}),
			).toThrow("more than once");
			expect(() =>
				emitComponent(sampleScreen().root, sampleRegistry(), {
					variants: [{ name: "1st", operations: [] }],
				}),
			).toThrow("not writable as a component export");
		});
	});

	it("生成したコンポーネントファイルが fixtures / variants 込みで安定した全文になる", () => {
		const screen = parseScreenDefinition({
			...sampleScreen(),
			fixtures: { customers: [{ name: "Sato" }] },
			variants: [
				{
					name: "Loading",
					description: "Rows are being fetched.",
					operations: [
						{
							type: "setProps",
							nodeId: "node-table",
							props: { loading: true },
						},
					],
				},
				{
					name: "Empty",
					operations: [{ type: "removeNode", nodeId: "node-table" }],
				},
			],
		});
		const source = emitComponent(screen.root, sampleRegistry(), {
			componentName: "CustomerList",
			fixtures: screen.fixtures,
			variants: screen.variants,
		});
		expect(source).toMatchSnapshot();
	});
});
