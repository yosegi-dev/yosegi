import {
	type ComponentRegistry,
	parseComponentRegistry,
} from "./domain/component-manifest.ts";
import {
	parseScreenDefinition,
	type ScreenDefinition,
} from "./domain/screen-definition.ts";

// A sample Registry for tests and prototyping. In production this is generated from Storybook.
export function sampleRegistry(): ComponentRegistry {
	return parseComponentRegistry({
		version: "test:v1",
		generatedAt: "2026-07-22T00:00:00.000Z",
		components: [
			{
				id: "Page",
				name: "Page",
				category: "layout",
				import: { packageName: "~/components/layout", exportName: "Page" },
				props: {},
				slots: {
					header: { maxItems: 1 },
					body: {},
				},
			},
			{
				id: "PageHeader",
				name: "PageHeader",
				category: "layout",
				import: {
					packageName: "~/components/layout",
					exportName: "PageHeader",
				},
				props: {
					title: { kind: "string", required: true },
				},
				slots: {},
				constraints: { allowedParents: ["Page"] },
			},
			{
				id: "SearchForm",
				name: "SearchForm",
				category: "form",
				import: { packageName: "~/components/form", exportName: "SearchForm" },
				props: {},
				slots: { fields: {} },
			},
			{
				id: "TextField",
				name: "TextField",
				category: "form",
				import: {
					packageName: "~/components/shadcn-ui/input",
					exportName: "TextField",
				},
				props: {
					label: { kind: "string", required: true },
					placeholder: { kind: "string" },
					disabled: { kind: "boolean", defaultValue: false },
					value: { kind: "string" },
				},
				slots: {},
			},
			{
				id: "Button",
				name: "Button",
				category: "shadcn-ui",
				import: {
					packageName: "~/components/shadcn-ui/button",
					exportName: "Button",
				},
				props: {
					variant: {
						kind: "enum",
						options: ["default", "destructive", "secondary", "ghost", "link"],
						defaultValue: "default",
					},
					disabled: { kind: "boolean", defaultValue: false },
					onClick: { kind: "function", editable: false },
				},
				slots: {},
			},
			{
				id: "Table",
				name: "Table",
				category: "data",
				import: { packageName: "~/components/table", exportName: "Table" },
				props: {
					loading: { kind: "boolean", defaultValue: false },
					rows: { kind: "json", editable: false },
					onRowClick: { kind: "function", editable: false },
				},
				slots: {},
			},
			{
				id: "LegacyBanner",
				name: "LegacyBanner",
				category: "layout",
				import: {
					packageName: "~/components/legacy",
					exportName: "LegacyBanner",
				},
				props: {},
				slots: {},
				constraints: { deprecated: true },
			},
		],
	});
}

// A sample screen (customer list), structured after the example in the design brief.
export function sampleScreen(): ScreenDefinition {
	return parseScreenDefinition({
		schemaVersion: "1.0",
		id: "customer-list",
		name: "Customer list",
		status: "draft",
		componentRegistryVersion: "test:v1",
		revision: 1,
		root: {
			id: "node-page",
			component: "Page",
			props: {},
			slots: {
				header: [
					{
						id: "node-header",
						component: "PageHeader",
						props: { title: "Customer list" },
						slots: {},
					},
				],
				body: [
					{
						id: "node-search",
						component: "SearchForm",
						props: {},
						slots: {
							fields: [
								{
									id: "node-keyword",
									component: "TextField",
									props: {
										label: "Customer name",
										placeholder: "Enter a customer name",
									},
									slots: {},
									bindings: { value: "filters.keyword" },
								},
							],
						},
					},
					{
						id: "node-table",
						component: "Table",
						props: {},
						slots: {},
						bindings: { rows: "customers", loading: "customerQuery.isLoading" },
						events: {
							onRowClick: {
								action: "navigate",
								arguments: { to: "/customers/:customerId" },
							},
						},
					},
				],
			},
		},
	});
}
