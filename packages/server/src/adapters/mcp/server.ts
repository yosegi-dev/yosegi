import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	ComposerError,
	parseScreenDefinition,
	parseScreenOperations,
	SERVICE_CODES,
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
import {
	buildImportMapResolver,
	emitComponent,
	emitCsf,
} from "@yosegi/core/emit";
import { z } from "zod";
import { yosegiVersion } from "../../config.ts";
import {
	formatRegistryVersionWarning,
	summarizeComponent,
} from "../cli/format.ts";
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

// What a client sees before it calls anything. The tool list already says what each tool
// does, so this covers only what it cannot: these tools read a registry the CLI builds, and
// the steps that need the TypeScript compiler or the host's files have no MCP equivalent.
// Without it, an agent connected over MCP alone discovers that by getting an empty registry.
const INSTRUCTIONS = [
	"Yosegi assembles a screen out of the components already registered in the host project, and returns it as a Storybook Story (CSF) or as a plain React component.",
	'These tools read a Component Registry; they cannot build one. If it is missing or empty, run `yosegi registry build --source "<glob>" --tsconfig <path>` in the host first.',
	"Building the registry, scaffolding metadata for components whose props could not be read, importing an existing Story back into Screen JSON, and recomputing drift against the host's sources are CLI-only. `get_registry_status` reports provenance alone; `yosegi registry status` is what compares the registry against the sources.",
].join("\n\n");

// Exposes the Composer as an MCP server. It has no MCP-specific logic of its own — it's
// strictly an Adapter that calls the Application Service (Composer). Updates run under
// agent permissions (Draft only).
export function createMcpServer(composer: Composer): McpServer {
	// The version is the package's own, so a client reports the Yosegi it is actually
	// talking to and there is no second place to bump on release.
	const server = new McpServer(
		{ name: "yosegi", version: yosegiVersion() },
		{ instructions: INSTRUCTIONS },
	);

	// Full manifests for a whole registry run to hundreds of kilobytes — far past what a
	// tool result should put into a context window — so the default is a capped list of
	// summaries carrying the same information as the CLI's component list.
	server.registerTool(
		"search_components",
		{
			description:
				'Search the registered components by name and category. Returns summaries (id, category, prop-type tokens, slots) capped at `limit` (default 50, max 200); pass detail: "full" for complete manifests',
			inputSchema: {
				query: z.string().optional(),
				category: z.string().optional(),
				detail: z.enum(["summary", "full"]).optional(),
				// The cap keeps a detail: "full" response from ballooning into an
				// unbounded tool result on a large registry.
				limit: z.number().int().positive().max(200).optional(),
			},
		},
		async ({ query, category, detail, limit }) => {
			const matched = composer.components.searchComponents({ query, category });
			const shown = matched.slice(0, limit ?? 50);
			return ok({
				total: matched.length,
				shown: shown.length,
				truncated: shown.length < matched.length,
				components: detail === "full" ? shown : shown.map(summarizeComponent),
			});
		},
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
		"list_categories",
		{
			description: "List the categories present in the registry",
			inputSchema: {},
		},
		async () => ok(composer.components.listCategories()),
	);

	// The CLI warns about a version mismatch on stderr on every read; MCP has no stderr
	// a client surfaces, so the same warning rides in this tool's payload instead.
	// Unlike the CLI's registry status, this does not recompute source drift (that needs
	// the TypeScript compiler and the host's files) — it reports provenance only.
	server.registerTool(
		"get_registry_status",
		{
			description:
				"Report the registry's provenance (version, build time, recorded inputs) and warn when it was built by a different Yosegi than the one running. Does not recompute source drift; run the CLI's registry status for that",
			inputSchema: {},
		},
		async () => {
			const registry = composer.components.getRegistry();
			return ok({
				version: registry.version,
				generatedAt: registry.generatedAt ?? null,
				builtWith: registry.builtWith ?? null,
				builtWithCliPath: registry.builtWithCliPath ?? null,
				inputs: registry.inputs ?? null,
				runningVersion: yosegiVersion(),
				warning: formatRegistryVersionWarning(registry, yosegiVersion()),
			});
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
				"Generate Storybook Story (CSF) source from a screen tree, or — with target: \"component\" — a plain React component file for hosts without Storybook (no meta, one exported function per screen state; title and framework do not apply). Save it under the host's stories directory (or, for a component, wherever the user chose). Optional variants ({ name, description?, operations }) emit additional Story exports (or component exports) for the screen's other states (loading / error / empty)",
			inputSchema: {
				root: z.unknown(),
				// Required with the default story target (it becomes meta.title);
				// meaningless for the component target, which has no meta.
				title: z.string().optional(),
				storyName: z.string().optional(),
				importMap: z.string().optional(),
				framework: z.string().optional(),
				fixtures: z.record(z.string(), z.unknown()).optional(),
				variants: z.array(z.unknown()).optional(),
				target: z.enum(["story", "component"]).optional(),
			},
		},
		async ({
			root,
			title,
			storyName,
			importMap,
			framework,
			fixtures,
			variants,
			target,
		}) => {
			try {
				const emitTarget = target ?? "story";
				// Mirrors the CLI's cross-checks: a CSF-only argument on the component
				// target is rejected rather than silently ignored.
				if (emitTarget === "story" && title === undefined) {
					throw new ComposerError(
						SERVICE_CODES.INVALID_ARGUMENT,
						'generate_story requires "title" unless target is "component" (it becomes the Story meta\'s title).',
					);
				}
				if (
					emitTarget === "component" &&
					(title !== undefined || framework !== undefined)
				) {
					throw new ComposerError(
						SERVICE_CODES.INVALID_ARGUMENT,
						'target "component" does not take "title" or "framework": the component file has no Story meta, so both would be ignored.',
					);
				}
				const parsedRoot = screenNodeSchema.parse(root);
				const registry = withSyntheticComponents(
					composer.components.getRegistry(),
				);
				// A throwaway Screen Definition, used only for pre-generation validation. Never
				// persisted. Routing fixtures and variants through it also runs their schemas
				// (name legality, operation shapes), so the MCP path rejects the same inputs
				// the CLI path does.
				const screen = parseScreenDefinition({
					schemaVersion: "1.0",
					id: "generate-story",
					name: title ?? storyName ?? "Screen",
					componentRegistryVersion: registry.version,
					revision: 0,
					fixtures,
					variants,
					root: parsedRoot,
				});
				const result = validateScreen(screen, registry);
				if (result.errors.length > 0) {
					throw new ValidationFailedError(result);
				}
				const resolveImport = importMap
					? buildImportMapResolver(importMap)
					: undefined;
				return ok(
					emitTarget === "component"
						? emitComponent(parsedRoot, registry, {
								// storyName names the base export on both targets, same as the CLI.
								componentName: storyName,
								resolveImport,
								fixtures: screen.fixtures,
								variants: screen.variants,
							})
						: emitCsf(parsedRoot, registry, {
								// The story branch has already rejected an absent title above.
								title: title ?? "",
								storyName,
								frameworkPackage: framework,
								resolveImport,
								fixtures: screen.fixtures,
								variants: screen.variants,
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
