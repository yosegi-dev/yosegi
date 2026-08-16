import { describe, expect, it } from "bun:test";
import { ComposerError } from "../domain/errors.ts";
import {
	parseScreenDefinition,
	type ScreenDefinition,
} from "../domain/screen-definition.ts";
import { withSyntheticComponents } from "../domain/synthetics.ts";
import { buildImportMapResolver } from "../emit/csf.ts";
import { sampleRegistry, sampleScreen } from "../test-fixtures.ts";
import { ComponentService } from "./component-service.ts";
import {
	buildImplementationContext,
	type EventTask,
} from "./implementation-context.ts";

function components(): ComponentService {
	return new ComponentService(withSyntheticComponents(sampleRegistry()));
}

describe("buildImplementationContext", () => {
	it("使用中コンポーネントのみ収集する", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		const ids = context.components.map((c) => c.id).sort();
		expect(ids).toEqual([
			"Page",
			"PageHeader",
			"SearchForm",
			"Table",
			"TextField",
		]);
		// Button, which is unused, is not included.
		expect(ids).not.toContain("Button");
	});

	it("使用コンポーネントごとに import 文・使用 props・使用 slots を返す", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		const page = context.components.find((c) => c.id === "Page");
		expect(page?.importStatement).toBe(
			'import { Page } from "~/components/layout";',
		);
		expect(page?.usedSlots).toEqual(["header", "body"]);
		expect(page?.usageCount).toBe(1);
		expect(page?.nodeIds).toEqual(["node-page"]);

		const header = context.components.find((c) => c.id === "PageHeader");
		expect(header?.usedProps).toEqual({ title: ["Customer list"] });
		// The Manifest (the source of truth for props that can be passed) is bundled in too.
		expect(header?.manifest?.props.title.required).toBe(true);
	});

	it("画面に貼れる import 文を specifier 単位でまとめて返す", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		expect(context.imports).toEqual([
			'import { SearchForm } from "~/components/form";',
			'import { Page, PageHeader } from "~/components/layout";',
			'import { TextField } from "~/components/shadcn-ui/input";',
			'import { Table } from "~/components/table";',
		]);
	});

	it("resolveImport でホストの alias へ寄せられる", () => {
		const context = buildImplementationContext(sampleScreen(), components(), {
			resolveImport: buildImportMapResolver("~/components=~/ui"),
		});
		expect(context.imports).toContain(
			'import { Page, PageHeader } from "~/ui/layout";',
		);
	});

	it("bindings / events を結線タスクとして平坦化する", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		expect(context.tasks).toContainEqual({
			kind: "binding",
			nodeId: "node-keyword",
			component: "TextField",
			path: "$.body[0].fields[0]",
			prop: "value",
			expression: "filters.keyword",
		});

		const event = context.tasks.find(
			(task): task is EventTask => task.kind === "event",
		);
		expect(event).toEqual({
			kind: "event",
			nodeId: "node-table",
			component: "Table",
			path: "$.body[1]",
			event: "onRowClick",
			action: "navigate",
			arguments: { to: "/customers/:customerId" },
		});
	});

	it("構造サマリにノード数・深さ・slot 位置を含める", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		expect(context.structure.nodeCount).toBe(5);
		expect(context.structure.componentCount).toBe(5);
		// Page(0) > SearchForm(1) > TextField(2).
		expect(context.structure.depth).toBe(2);

		const root = context.structure.nodes[0];
		expect(root.slot).toBeNull();
		expect(root.path).toBe("$");
		expect(root.slots).toEqual(["header", "body"]);

		const table = context.structure.nodes.find(
			(n) => n.nodeId === "node-table",
		);
		expect(table?.slot).toBe("body");
		expect(table?.bindings).toEqual(["rows", "loading"]);
		expect(table?.events).toEqual(["onRowClick"]);
	});

	it("outline はインデントで階層を表す", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		expect(context.structure.outline[0]).toBe("Page #node-page");
		expect(context.structure.outline).toContain(
			"  header: PageHeader #node-header props=title",
		);
		expect(context.structure.outline).toContain(
			"  body: Table #node-table bindings=rows,loading events=onRowClick",
		);
	});

	it("合成プリミティブは import を持たず synthetic として印を付ける", () => {
		const screen = sampleScreen();
		screen.root = {
			id: "root",
			component: "Box",
			props: { className: "p-6" },
			slots: {
				children: [
					{
						id: "label",
						component: "Text",
						props: { text: "顧客一覧" },
						slots: {},
					},
				],
			},
		};
		const context = buildImplementationContext(screen, components());
		const box = context.components.find((c) => c.id === "Box");
		expect(box?.synthetic).toBe(true);
		expect(box?.unregistered).toBe(false);
		expect(box?.importStatement).toBeNull();
		expect(context.imports).toEqual([]);
	});

	it("未登録の component は unregistered として残す（例外にしない）", () => {
		const screen = sampleScreen();
		screen.root = {
			id: "root",
			component: "app/components/unknown#Unknown",
			props: {},
			slots: {},
		};
		const context = buildImplementationContext(screen, components());
		expect(context.components).toHaveLength(1);
		expect(context.components[0]).toMatchObject({
			id: "app/components/unknown#Unknown",
			unregistered: true,
			synthetic: false,
			importStatement: null,
			manifest: null,
		});
	});

	it("既定の実装制約は中立（framework/routing=null）で raw HTML/CSS 禁止", () => {
		const context = buildImplementationContext(sampleScreen(), components());
		expect(context.implementation).toEqual({
			framework: null,
			routing: null,
			allowRawHtml: false,
			allowCustomCss: false,
		});
	});

	it("ホストは options.implementation で上書きできる", () => {
		const context = buildImplementationContext(sampleScreen(), components(), {
			implementation: { framework: "react", routing: "react-router" },
		});
		expect(context.implementation.framework).toBe("react");
		expect(context.implementation.routing).toBe("react-router");
	});

	it("target と requirements を上書きできる", () => {
		const context = buildImplementationContext(sampleScreen(), components(), {
			target: {
				route: "/customers",
				preferredPath: "app/routes/customers.tsx",
			},
			requirements: ["既存の ErrorBoundary を使う"],
		});
		expect(context.target.route).toBe("/customers");
		expect(context.requirements).toEqual(["既存の ErrorBoundary を使う"]);
	});

	describe("variants", () => {
		// The Empty state drops the table and puts a Button there instead. Button is in
		// the Registry but nowhere in the base tree, so it is exactly the component the
		// context used to lose.
		function screenWithEmptyVariant(): ScreenDefinition {
			return parseScreenDefinition({
				...sampleScreen(),
				variants: [
					{
						name: "Empty",
						description: "No customers matched.",
						operations: [
							{ type: "removeNode", nodeId: "node-table" },
							{
								type: "addNode",
								target: { parentNodeId: "node-page", slot: "body" },
								node: {
									id: "node-empty-action",
									component: "Button",
									props: { variant: "secondary" },
									slots: {},
									events: {
										onClick: {
											action: "navigate",
											arguments: { to: "/customers/new" },
										},
									},
								},
							},
						],
					},
				],
			});
		}

		it("variant でしか使われないコンポーネントも imports と components に現れる", () => {
			const context = buildImplementationContext(
				screenWithEmptyVariant(),
				components(),
			);
			expect(context.imports).toContain(
				'import { Button } from "~/components/shadcn-ui/button";',
			);

			const button = context.components.find((c) => c.id === "Button");
			expect(button?.importStatement).toBe(
				'import { Button } from "~/components/shadcn-ui/button";',
			);
			expect(button?.variantOnly).toBe(true);
			expect(button?.variants).toEqual(["Empty"]);
			expect(button?.nodeIds).toEqual(["node-empty-action"]);
			// The props a variant passes are part of what has to be implemented.
			expect(button?.usedProps).toEqual({ variant: ["secondary"] });
		});

		it("ベースにしか無いコンポーネントは variants が付かない", () => {
			const context = buildImplementationContext(
				screenWithEmptyVariant(),
				components(),
			);
			// The Empty variant removes the table, so its absence here is the signal
			// that the state does not render one.
			const table = context.components.find((c) => c.id === "Table");
			expect(table?.variants).toBeUndefined();
			expect(table?.variantOnly).toBeUndefined();

			const page = context.components.find((c) => c.id === "Page");
			expect(page?.variants).toEqual(["Empty"]);
			expect(page?.variantOnly).toBeUndefined();
		});

		it("variant 由来の結線タスクは variant 名を持つ", () => {
			const context = buildImplementationContext(
				screenWithEmptyVariant(),
				components(),
			);
			expect(context.tasks).toContainEqual({
				kind: "event",
				nodeId: "node-empty-action",
				component: "Button",
				path: "$.body[1]",
				event: "onClick",
				action: "navigate",
				arguments: { to: "/customers/new" },
				variant: "Empty",
			});
			// The base's own tasks stay untagged.
			expect(
				context.tasks
					.filter((task) => task.nodeId === "node-keyword")
					.every((task) => task.variant === undefined),
			).toBe(true);
		});

		it("ベースと同じ結線は variant 側で重複しない", () => {
			const screen = parseScreenDefinition({
				...sampleScreen(),
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
			const context = buildImplementationContext(screen, components());
			expect(
				context.tasks.filter((task) => task.nodeId === "node-table"),
			).toHaveLength(3);
			expect(context.tasks.every((task) => task.variant === undefined)).toBe(
				true,
			);
			// A node the variant keeps is one node, not two.
			const table = context.components.find((c) => c.id === "Table");
			expect(table?.usageCount).toBe(1);
			expect(table?.nodeIds).toEqual(["node-table"]);
			// setProps is a prop the state passes, so it shows up as a used value.
			expect(table?.usedProps).toEqual({ loading: [true] });
		});

		it("variants には outline と追加コンポーネントが入り structure はベースのまま", () => {
			const context = buildImplementationContext(
				screenWithEmptyVariant(),
				components(),
			);
			expect(context.variants).toEqual([
				{
					name: "Empty",
					description: "No customers matched.",
					outline: [
						"Page #node-page",
						"  header: PageHeader #node-header props=title",
						"  body: SearchForm #node-search",
						"    fields: TextField #node-keyword props=label,placeholder bindings=value",
						"  body: Button #node-empty-action props=variant events=onClick",
					],
					addedComponents: ["Button"],
				},
			]);
			// The top-level structure keeps describing the base tree alone.
			expect(context.structure.outline).toContain(
				"  body: Table #node-table bindings=rows,loading events=onRowClick",
			);
			expect(
				context.structure.nodes.some((n) => n.nodeId === "node-empty-action"),
			).toBe(false);
		});

		it("variants を持たない画面は variant 用のキーを一切出さない", () => {
			const context = buildImplementationContext(sampleScreen(), components());
			expect("variants" in context).toBe(false);
			expect(
				context.components.every(
					(usage) => !("variants" in usage) && !("variantOnly" in usage),
				),
			).toBe(true);
			expect(context.tasks.every((task) => !("variant" in task))).toBe(true);
		});

		it("適用できない variant は例外にする（emit と同じ扱い）", () => {
			const screen = parseScreenDefinition({
				...sampleScreen(),
				variants: [
					{
						name: "Broken",
						operations: [{ type: "removeNode", nodeId: "node-missing" }],
					},
				],
			});
			expect(() => buildImplementationContext(screen, components())).toThrow(
				ComposerError,
			);
		});
	});
});
