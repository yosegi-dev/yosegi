import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	parseScreenDefinition,
	parseScreenOperations,
	screenIdSchema,
	screenNodeSchema,
	validateScreen,
	withSyntheticComponents,
} from "@yosegi/core";
import type { Composer } from "@yosegi/core/app";
import {
	agentActor,
	buildImplementationContext,
	ValidationFailedError,
} from "@yosegi/core/app";
import { buildImportMapResolver, emitCsf } from "@yosegi/core/emit";
import { z } from "zod";
import { toErrorResponse } from "../error-response.ts";

// Convert a tool's return value into MCP's content format (JSON text).
function ok(value: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
	};
}

function fail(error: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(toErrorResponse(error).body, null, 2),
			},
		],
		isError: true,
	};
}

// Exposes the Composer as an MCP server. It has no MCP-specific logic of its own — it's
// strictly an Adapter that calls the Application Service (Composer). Updates run under
// agent permissions (Draft only).
export function createMcpServer(composer: Composer): McpServer {
	const server = new McpServer({ name: "yosegi", version: "0.1.0" });

	server.registerTool(
		"search_components",
		{
			description: "Search the registered components by name and category",
			inputSchema: {
				query: z.string().optional(),
				category: z.string().optional(),
			},
		},
		async ({ query, category }) =>
			ok(composer.components.searchComponents({ query, category })),
	);

	server.registerTool(
		"get_component",
		{
			description: "Get a component's manifest",
			inputSchema: { componentId: z.string() },
		},
		async ({ componentId }) => {
			// Return COMPONENT_NOT_FOUND, same as HTTP (not INTERNAL_ERROR).
			try {
				return ok(composer.components.requireComponent(componentId));
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"list_screens",
		{ description: "List the stored screens", inputSchema: {} },
		async () => ok(await composer.screens.listScreens()),
	);

	server.registerTool(
		"get_screen",
		{
			description: "Get a screen definition",
			inputSchema: { screenId: screenIdSchema },
		},
		async ({ screenId }) => {
			try {
				return ok(await composer.screens.getScreen(screenId));
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"create_screen",
		{
			description: "Create a new screen (as a draft)",
			inputSchema: {
				id: screenIdSchema,
				name: z.string(),
				root: z.unknown(),
			},
		},
		async ({ id, name, root }) => {
			try {
				const parsedRoot = screenNodeSchema.parse(root);
				return ok(
					await composer.screens.createScreen(
						{ id, name, root: parsedRoot },
						agentActor(),
					),
				);
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"apply_screen_operations",
		{
			description:
				"Apply operations to update part of a screen (optimistic locking)",
			inputSchema: {
				screenId: screenIdSchema,
				baseRevision: z.number().int().nonnegative(),
				operations: z.array(z.unknown()),
			},
		},
		async ({ screenId, baseRevision, operations }) => {
			try {
				const parsed = parseScreenOperations(operations);
				return ok(
					await composer.screens.applyOperations(
						screenId,
						parsed,
						baseRevision,
						agentActor(),
					),
				);
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"validate_screen",
		{
			description: "Validate a screen definition",
			inputSchema: { screenId: screenIdSchema },
		},
		async ({ screenId }) => {
			try {
				return ok(await composer.screens.validate(screenId));
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"duplicate_screen",
		{
			description: "Duplicate a screen (as a draft)",
			inputSchema: {
				screenId: screenIdSchema,
				newId: screenIdSchema,
				newName: z.string(),
			},
		},
		async ({ screenId, newId, newName }) => {
			try {
				return ok(
					await composer.screens.duplicateScreen(
						screenId,
						newId,
						newName,
						agentActor(),
					),
				);
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"generate_story",
		{
			description:
				"Generate Storybook Story (CSF) source from a screen tree. Save it under the host's stories directory",
			inputSchema: {
				root: z.unknown(),
				title: z.string(),
				storyName: z.string().optional(),
				importMap: z.string().optional(),
				framework: z.string().optional(),
			},
		},
		async ({ root, title, storyName, importMap, framework }) => {
			try {
				const parsedRoot = screenNodeSchema.parse(root);
				const registry = withSyntheticComponents(
					composer.components.getRegistry(),
				);
				// A throwaway Screen Definition, used only for pre-generation validation. Never persisted.
				const screen = parseScreenDefinition({
					schemaVersion: "1.0",
					id: "generate-story",
					name: title,
					componentRegistryVersion: registry.version,
					revision: 0,
					root: parsedRoot,
				});
				const result = validateScreen(screen, registry);
				if (result.errors.length > 0) {
					throw new ValidationFailedError(result);
				}
				return ok(
					emitCsf(parsedRoot, registry, {
						title,
						storyName,
						frameworkPackage: framework,
						resolveImport: importMap
							? buildImportMapResolver(importMap)
							: undefined,
					}),
				);
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"generate_implementation_context",
		{
			description:
				"Generate implementation context for a coding agent (import statements, used props, slot structure, and the bindings / events wiring tasks)",
			inputSchema: {
				screenId: screenIdSchema,
				route: z.string().optional(),
				preferredPath: z.string().optional(),
				importMap: z.string().optional(),
			},
		},
		async ({ screenId, route, preferredPath, importMap }) => {
			try {
				const screen = await composer.screens.getScreen(screenId);
				return ok(
					buildImplementationContext(screen, composer.components, {
						target: { route, preferredPath },
						resolveImport: importMap
							? buildImportMapResolver(importMap)
							: undefined,
					}),
				);
			} catch (error) {
				return fail(error);
			}
		},
	);

	return server;
}
