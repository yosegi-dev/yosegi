import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
	type ComponentManifest,
	type ComponentRegistry,
	ComposerError,
	componentManifestSchema,
	didYouMean,
	parseComponentRegistry,
	parseScreenDefinition,
	parseScreenOperations,
	SERVICE_CODES,
	validateScreen,
	withSyntheticComponents,
} from "@yosegi/core";
import {
	buildImplementationContext,
	ComponentService,
	Composer,
	FileScreenRepository,
} from "@yosegi/core/app";
import { buildImportMapResolver, emitCsf } from "@yosegi/core/emit";
import {
	buildRegistryFromStorybook,
	type ComposerMetadata,
	composerMetadataSchema,
	storybookIndexSchema,
} from "@yosegi/core/registry";
import { z } from "zod";
import {
	DEFAULT_DATA_DIR,
	loadRegistry,
	registryPath,
	screensDir,
	yosegiCliPath,
	yosegiVersion,
} from "../../config.ts";
import { parseMetaTemplate } from "../../emit/meta-template.ts";
import { importStory } from "../../importer/story-importer.ts";
import { buildCvaMetadata } from "../../registry/cva-metadata.ts";
import { collectUndocumentedProps } from "../../registry/doc-coverage.ts";
import { buildRegistryFromSource } from "../../registry/source-registry.ts";
import { toErrorResponse } from "../error-response.ts";
import {
	formatComponentInspect,
	formatComponentList,
	formatRegistryHeader,
	formatRegistryStatus,
	formatRegistryVersionWarning,
	type RegistryIndexCheck,
	type RegistrySourceCheck,
} from "./format.ts";

// Suffix stripped from a Story file name, used as the default screen id.
const STORY_FILE_PATTERN = /\.stories\.(tsx|ts|jsx|js)$/;

// Flags that can be repeated (e.g. --source) become an array.
export type CliFlagValue = string | boolean | string[];
export type CliFlags = Record<string, CliFlagValue>;

// A simple parser that separates flags (--key value / --flag) from positional args.
export function parseArgs(argv: string[]): {
	positionals: string[];
	flags: CliFlags;
} {
	const positionals: string[] = [];
	const flags: CliFlags = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const key = token.slice(2);
		const nextToken = argv[i + 1];
		if (!nextToken || nextToken.startsWith("--")) {
			flags[key] = true;
			continue;
		}
		i += 1;
		const existing = flags[key];
		// Repeated flags accumulate into an array. A single occurrence stays a string
		// so the existing branch below doesn't break.
		if (Array.isArray(existing)) {
			existing.push(nextToken);
		} else if (typeof existing === "string") {
			flags[key] = [existing, nextToken];
		} else {
			flags[key] = nextToken;
		}
	}
	return { positionals, flags };
}

// Extract a list of strings, supporting both repeated flags and comma-separated values.
function flagList(flags: CliFlags, key: string): string[] {
	const value = flags[key];
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? [value]
			: [];
	return raw
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function flagString(flags: CliFlags, key: string): string | undefined {
	const value = flags[key];
	if (typeof value === "string") {
		return value;
	}
	// If the flag was repeated, take the last occurrence.
	return Array.isArray(value) ? value.at(-1) : undefined;
}

// A flag that takes no value (e.g. --json). `--json true` is also accepted.
function flagBoolean(flags: CliFlags, key: string): boolean {
	const value = flags[key];
	return value === true || value === "true";
}

// Every command and the flags it understands. parseArgs accepts any --flag, so without
// this inventory a misspelled flag is silently dropped and the command runs as if it
// were never passed — the worst failure mode for an agent, which then trusts the output.
const COMMAND_FLAGS: Record<string, readonly string[]> = {
	"registry build": [
		"source",
		"tsconfig",
		"project-root",
		"index",
		"storybook-url",
		"metadata",
		"import-map",
		"report",
		"out",
		"version",
		"json",
	],
	"registry metadata": ["tsconfig", "project-root", "source", "out"],
	"registry status": ["json"],
	"component list": ["category", "query", "json", "quiet"],
	"component inspect": ["json", "quiet"],
	"screen list": [],
	"screen pull": [],
	"screen export": [],
	"screen validate": [],
	"screen push": [],
	"screen apply": [],
	"screen generate": [
		"out",
		"title",
		"story-name",
		"import-map",
		"framework",
		"meta-template",
		"registry",
	],
	"screen context": [
		"registry",
		"import-map",
		"route",
		"preferred-path",
		"out",
	],
	"story import": [
		"registry",
		"import-map",
		"story-name",
		"screen-id",
		"screen-name",
		"out",
	],
	mcp: [],
};

// Accepted by every command.
const COMMON_FLAGS = ["data-dir"];

// Synonyms the edit-distance matcher can't reach (--search is nowhere near --query).
// Only suggested when the target flag exists on the command at hand.
const FLAG_SYNONYMS: Record<string, string> = {
	search: "query",
	find: "query",
	filter: "query",
};

// The uniform shape of a command-level failure: JSON with a code, never bare usage text,
// so an agent parses the same contract everywhere. Usage stays reserved for --help.
function commandError(
	code: "MISSING_ARGUMENT" | "UNKNOWN_COMMAND" | "UNKNOWN_FLAG",
	message: string,
	extra: Record<string, unknown> = {},
): number {
	print({ error: { code, message, ...extra } });
	return 1;
}

function missingArgument(command: string, message: string): number {
	return commandError(
		"MISSING_ARGUMENT",
		`${message} Run "yosegi --help" for usage.`,
		{ command },
	);
}

function unknownCommand(command: string): number {
	const names = Object.keys(COMMAND_FLAGS);
	// A bare group ("yosegi registry") lists its subcommands outright; anything else
	// falls back to fuzzy matching against the full command names.
	const subcommands = names.filter((name) => name.startsWith(`${command} `));
	const suggestion =
		subcommands.length > 0
			? `Did you mean: ${subcommands.join(", ")}?`
			: didYouMean(command, names);
	return commandError(
		"UNKNOWN_COMMAND",
		`Unknown command "${command}". Run "yosegi --help" for the command list.`,
		suggestion ? { suggestion } : {},
	);
}

// Rejects flags the command doesn't understand. Returns null when everything is known.
function checkFlags(command: string, flags: CliFlags): number | null {
	const known = [...(COMMAND_FLAGS[command] ?? []), ...COMMON_FLAGS];
	const knownSet = new Set(known);
	const unknown = Object.keys(flags).filter((name) => !knownSet.has(name));
	if (unknown.length === 0) {
		return null;
	}
	const first = unknown[0];
	const synonym = FLAG_SYNONYMS[first];
	const suggestion =
		synonym && knownSet.has(synonym)
			? `Did you mean: --${synonym}?`
			: didYouMean(
					`--${first}`,
					known.map((name) => `--${name}`),
				);
	return commandError(
		"UNKNOWN_FLAG",
		`Unknown flag${unknown.length > 1 ? "s" : ""} ${unknown
			.map((name) => `"--${name}"`)
			.join(", ")} for "${command}".`,
		{
			command,
			knownFlags: known.map((name) => `--${name}`).sort(),
			...(suggestion ? { suggestion } : {}),
		},
	);
}

// The base directory used to resolve --source globs and component id module paths.
// Defaults to the directory containing --tsconfig (i.e. the host's package root); cwd is
// never used as the base. Centralized here so registry build / registry metadata share the rule.
function resolveProjectRoot(flags: CliFlags): string | null {
	const explicit = flagString(flags, "project-root");
	if (explicit) {
		return resolve(explicit);
	}
	const tsconfigPath = flagString(flags, "tsconfig");
	return tsconfigPath ? dirname(resolve(tsconfigPath)) : null;
}

function print(value: unknown): void {
	console.log(
		typeof value === "string" ? value : JSON.stringify(value, null, 2),
	);
}

// Warn right after loading the registry if there's a version mismatch between the Yosegi
// that built it and the CLI now running. If the registry was built by an older Yosegi that
// lacks newer fields, every other freshness signal (version / generatedAt) still says
// "fresh", so this is the only place that catches it. Written to stderr (console.warn) so
// it doesn't pollute --json output, and it never hard-fails.
function warnIfRegistryStale(registry: ComponentRegistry): void {
	const message = formatRegistryVersionWarning(registry, yosegiVersion());
	if (message) {
		console.warn(message);
	}
}

async function makeComposer(dataDir: string): Promise<Composer> {
	const registry = await loadRegistry(dataDir);
	warnIfRegistryStale(registry);
	return new Composer(registry, new FileScreenRepository(screensDir(dataDir)));
}

// Read JSON from a file path or a URL, so a Storybook dev server's
// http://localhost:6006/index.json can be passed in directly.
async function readJsonSource(source: string): Promise<unknown> {
	if (source.startsWith("http://") || source.startsWith("https://")) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${source}: ${response.status} ${response.statusText}`,
			);
		}
		return await response.json();
	}
	return JSON.parse(await readFile(source, "utf8"));
}

// The registry used for generation: the --registry file if given, otherwise
// data/registry.json. Either way, synthetic primitives are added before returning it, so
// the validator doesn't treat them as unregistered.
async function loadEmitRegistry(
	flags: CliFlags,
	dataDir: string,
): Promise<ComponentRegistry> {
	const explicit = flagString(flags, "registry");
	const registry = explicit
		? parseComponentRegistry(JSON.parse(await readFile(explicit, "utf8")))
		: await loadRegistry(dataDir);
	warnIfRegistryStale(registry);
	return withSyntheticComponents(registry);
}

// Filter and list the usable components. The default is a text summary (showing prop
// types); --json returns the raw Manifest. For hosts whose registry has hundreds of
// entries, the normal flow is to narrow candidates with --category / --query first, then
// drop down to inspect.
function listComponents(composer: Composer, flags: CliFlags): number {
	// Repeated (or comma-separated) --query is OR'd together, same convention as --source.
	const queries = flagList(flags, "query");
	const category = flagString(flags, "category");
	const all = composer.components.listComponents();
	const components =
		queries.length > 0 || category
			? composer.components.searchComponents({ query: queries, category })
			: all;

	const registry = composer.components.getRegistry();

	if (flagBoolean(flags, "json")) {
		print({
			version: registry.version,
			generatedAt: registry.generatedAt ?? null,
			builtWith: registry.builtWith ?? null,
			builtWithCliPath: registry.builtWithCliPath ?? null,
			inputs: registry.inputs ?? null,
			total: all.length,
			categories: composer.components.listCategories(),
			components,
		});
		return 0;
	}

	const filters = [
		category ? `category=${category}` : null,
		queries.length > 0 ? `query=${queries.join(",")}` : null,
	].filter((entry): entry is string => entry !== null);
	print(
		formatComponentList(
			components,
			{
				shown: components.length,
				total: all.length,
				filters,
				registry: {
					version: registry.version,
					generatedAt: registry.generatedAt ?? null,
					inputs: registry.inputs ?? null,
					cliPath: registry.builtWithCliPath ?? null,
				},
			},
			{ quiet: flagBoolean(flags, "quiet") },
		),
	);
	return 0;
}

// Pin down one or more components' props / slots. The single source of truth for not
// guessing props. Accepts multiple ids so reading several components doesn't require
// looping the CLI and stripping a repeated header by hand — the registry provenance
// block below is printed at most once, not per id.
function inspectComponent(
	composer: Composer,
	componentIds: string[],
	flags: CliFlags,
): number {
	const asJson = flagBoolean(flags, "json");
	let exitCode = 0;
	const results: unknown[] = [];
	const blocks: string[] = [];
	for (const componentId of componentIds) {
		let component: ComponentManifest;
		try {
			// requireComponent owns the not-found representation (code + did-you-mean
			// candidates), so the CLI reports the same error CLI/MCP/HTTP all share.
			component = composer.components.requireComponent(componentId);
		} catch (error) {
			const { body } = toErrorResponse(error);
			exitCode = 1;
			if (asJson) {
				results.push(body);
			} else {
				blocks.push(JSON.stringify(body, null, 2));
			}
			continue;
		}
		if (asJson) {
			results.push(component);
		} else {
			blocks.push(formatComponentInspect(component));
		}
	}

	if (asJson) {
		// A single id keeps returning a bare object/error, unchanged from before multiple
		// ids were supported. Only two or more ids produce an array.
		print(componentIds.length === 1 ? results[0] : results);
		return exitCode;
	}

	// The header is genuinely useful (it carries the rebuild command and CLI path), so it
	// stays the default. It only appears for multiple ids — a single id's output is
	// unchanged from before this command accepted more than one.
	const showHeader = componentIds.length > 1 && !flagBoolean(flags, "quiet");
	if (showHeader) {
		const registry = composer.components.getRegistry();
		blocks.unshift(
			formatRegistryHeader({
				version: registry.version,
				generatedAt: registry.generatedAt ?? null,
				inputs: registry.inputs ?? null,
				cliPath: registry.builtWithCliPath ?? null,
			}),
		);
	}
	print(blocks.join("\n\n"));
	return exitCode;
}

// Write a Storybook Story (CSF) from a Screen Definition. Yosegi's final deliverable.
async function generateStory(
	screenFile: string | undefined,
	flags: CliFlags,
	dataDir: string,
): Promise<number> {
	if (screenFile === undefined) {
		return missingArgument(
			"screen generate",
			"screen generate requires a <screen.json> path.",
		);
	}
	const out = flagString(flags, "out");
	if (out === undefined) {
		return missingArgument(
			"screen generate",
			"screen generate requires --out <file.stories.tsx>.",
		);
	}
	const screen = parseScreenDefinition(
		JSON.parse(await readFile(screenFile, "utf8")),
	);
	const registry = await loadEmitRegistry(flags, dataDir);
	// A warning doesn't block generation (e.g. a registry version mismatch); only an error does.
	const { errors, warnings } = validateScreen(screen, registry);
	if (errors.length > 0) {
		print(errors);
		return 1;
	}
	const importMap = flagString(flags, "import-map");
	// The host's meta conventions (tags / parameters / design-reference JSDoc) are carried
	// over from the template. Anything not carried over, or that looks suspect, is warned about.
	const metaTemplatePath = flagString(flags, "meta-template");
	const metaTemplate = metaTemplatePath
		? parseMetaTemplate(
				await readFile(metaTemplatePath, "utf8"),
				metaTemplatePath,
			)
		: null;
	const source = emitCsf(screen.root, registry, {
		title: flagString(flags, "title") ?? `Screens/${screen.name}`,
		storyName: flagString(flags, "story-name"),
		frameworkPackage: flagString(flags, "framework"),
		resolveImport: importMap ? buildImportMapResolver(importMap) : undefined,
		meta: metaTemplate?.template,
		fixtures: screen.fixtures,
	});
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, source);
	print(`Wrote ${out}`);
	// Generation succeeded, but there's something worth fixing (e.g. a reference resolved
	// to a host component that shadows a synthetic primitive's name, or a stale registry).
	// Dropping these would remove any chance to notice them, so they always follow the output.
	if (warnings.length > 0) {
		print(warnings);
	}
	for (const warning of metaTemplate?.warnings ?? []) {
		print(`Warning: ${warning}`);
	}
	return 0;
}

// Build a `--metadata` scaffold, from the host's cva variants, for components whose props
// can't be read from types. The output is JSON that can be passed straight to
// `registry build --metadata`.
async function generateMetadata(
	componentIds: string[],
	flags: CliFlags,
): Promise<number> {
	if (componentIds.length === 0) {
		return missingArgument(
			"registry metadata",
			"registry metadata requires at least one <componentId>.",
		);
	}
	// Both the glob and the id's module path are resolved with the same base as registry build.
	const projectRoot = resolveProjectRoot(flags);
	if (!projectRoot) {
		throw new ComposerError(
			SERVICE_CODES.INVALID_ARGUMENT,
			"registry metadata requires --tsconfig <path> or --project-root <dir> (the base for --source globs and for component id module paths).",
		);
	}

	const { metadata, notes } = buildCvaMetadata({
		projectRoot,
		componentIds,
		sources: flagList(flags, "source"),
	});

	const out = flagString(flags, "out");
	if (out === undefined) {
		print(metadata);
	} else {
		await mkdir(dirname(out), { recursive: true });
		await writeFile(out, `${JSON.stringify(metadata, null, "\t")}\n`);
		print(`Wrote ${out}`);
	}
	for (const note of notes) {
		print(`Note: ${note}`);
	}
	// The scaffold only knows about cva variants. Staying silent here would mean assembling
	// a screen with non-variant props (a required discriminator prop like `as`, for example) missing.
	print(
		"Note: the template only covers cva variants. Read the source and add the other props.",
	);
	return 0;
}

// Build the default screen id from a file name (`yosegi-demo.stories.tsx` -> `yosegi-demo`).
function defaultScreenId(file: string): string {
	return basename(file).replace(STORY_FILE_PATTERN, "");
}

// Read a Story (.stories.tsx) back into a Screen Definition. The entry point for the
// downstream flow (converting to an implementation). Anything that couldn't be interpreted
// is recorded in warnings, and the tree is returned as far as it could be read.
async function importStoryFile(
	storyFile: string | undefined,
	flags: CliFlags,
	dataDir: string,
): Promise<number> {
	if (storyFile === undefined) {
		return missingArgument(
			"story import",
			"story import requires a <file.stories.tsx> path.",
		);
	}
	const registry = await loadEmitRegistry(flags, dataDir);
	const importMap = flagString(flags, "import-map");
	const imported = importStory({
		source: await readFile(storyFile, "utf8"),
		fileName: storyFile,
		registry,
		storyName: flagString(flags, "story-name"),
		resolveImport: importMap ? buildImportMapResolver(importMap) : undefined,
	});

	if (!imported.root) {
		// If the tree can't be restored, there's no Screen JSON to produce; the reason is in warnings.
		print({ warnings: imported.warnings });
		return 1;
	}

	const screenId = flagString(flags, "screen-id") ?? defaultScreenId(storyFile);
	const screen = parseScreenDefinition({
		schemaVersion: "1.0",
		id: screenId,
		name:
			flagString(flags, "screen-name") ??
			imported.title?.split("/").at(-1) ??
			screenId,
		componentRegistryVersion: registry.version,
		revision: 0,
		// A Story with no fixture consts keeps the field absent, so the output JSON
		// stays byte-identical to what this command produced before fixtures existed.
		...(Object.keys(imported.fixtures).length > 0
			? { fixtures: imported.fixtures }
			: {}),
		root: imported.root,
	});

	const out = flagString(flags, "out");
	if (out === undefined) {
		print({
			title: imported.title,
			storyName: imported.storyName,
			screen,
			warnings: imported.warnings,
		});
		return 0;
	}
	// --out gets Screen JSON that can be passed straight to screen validate / generate /
	// context. Warnings go to stdout instead, so they don't pollute the file contents.
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, `${JSON.stringify(screen, null, "\t")}\n`);
	print(`Wrote ${out}`);
	print({
		title: imported.title,
		storyName: imported.storyName,
		warnings: imported.warnings,
	});
	return 0;
}

// Expand a Screen Definition into an implementation context. This is the input used when
// converting a Story (mock) into a real page. The output is machine-readable JSON, written
// to stdout or to the --out file.
async function screenContext(
	screenFile: string | undefined,
	flags: CliFlags,
	dataDir: string,
): Promise<number> {
	if (screenFile === undefined) {
		return missingArgument(
			"screen context",
			"screen context requires a <screen.json> path.",
		);
	}
	const screen = parseScreenDefinition(
		JSON.parse(await readFile(screenFile, "utf8")),
	);
	const registry = await loadEmitRegistry(flags, dataDir);
	const importMap = flagString(flags, "import-map");
	const context = buildImplementationContext(
		screen,
		new ComponentService(registry),
		{
			target: {
				route: flagString(flags, "route"),
				preferredPath: flagString(flags, "preferred-path"),
			},
			resolveImport: importMap ? buildImportMapResolver(importMap) : undefined,
		},
	);
	const out = flagString(flags, "out");
	if (out === undefined) {
		print(context);
		return 0;
	}
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, `${JSON.stringify(context, null, "\t")}\n`);
	print(`Wrote ${out}`);
	return 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// curation and references.storybook are the only fields buildRegistryFromSource derives
// from --index (see collectStoryCuration in source-registry.ts) — everything else comes
// from the source types alone. Resetting them the same way on both sides isolates "did
// the source change" from "did the Storybook/curation layer change", so the source
// verdict never depends on whether index.json could be fetched.
//
// category also folds in the Story-derived value when an index was used
// (`curation?.category ?? directoryCategory(modulePath)`), so it's excluded from the
// source-only comparison the same way curation is. Rather than re-deriving
// directoryCategory (and re-guessing whether a stored category came from curation or from
// explicit --metadata) here, the source-only recompute is trusted as the source of truth
// for what each id's category would be without an index — id -> category, read off the
// recompute that's already known to exclude curation.
function stripIndexDerivedFields(
	components: ComponentManifest[],
	categoryWithoutIndex: Map<string, string | undefined>,
): ComponentManifest[] {
	return components.map((component) => {
		// A component's `references` may carry other, non-index fields (figma / notion)
		// set via --metadata; only the storybook key is index-derived, so only that key is
		// dropped, and the whole object collapses to undefined when nothing else is left
		// in it (matching what a recompute without --index actually produces, rather than
		// leaving behind a `references: {}` that would never match `references: undefined`).
		let references = component.references;
		if (references) {
			const { storybook: _storybook, ...rest } = references;
			references = Object.keys(rest).length > 0 ? rest : undefined;
		}
		// Re-parsed through the schema so both sides of the comparison get the same
		// deterministic key order regardless of how the input was serialized.
		return componentManifestSchema.parse({
			...component,
			category: categoryWithoutIndex.get(component.id) ?? component.category,
			curation: { recommended: false },
			references,
		});
	});
}

function sameComponents(
	a: ComponentManifest[],
	b: ComponentManifest[],
): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

// Answers two separate questions about data/registry.json:
// - source: does the host's --source content still match what this registry was built
//   from? Recomputed from source alone (--index is never fetched for this), so an
//   unreachable Storybook can never affect this verdict.
// - index: does the Storybook-derived curation layer (recommended / story links) still
//   match? Only meaningful once the source check comes back current — best-effort, and
//   failing to fetch --index is reported as "couldn't check", not "stale".
//
// The registry's version hash is computed over the *merged* (source + index) content, so
// neither check can be answered by comparing recomputedVersion === registry.version alone
// once --index is involved; see the source-only / merged split below.
async function checkRegistryStatus(registry: ComponentRegistry): Promise<{
	source: RegistrySourceCheck;
	index: RegistryIndexCheck;
}> {
	const inputs = registry.inputs;
	if (!inputs) {
		const reason =
			"registry has no recorded inputs (built before this was tracked); rebuild to enable this check";
		return {
			source: { checked: false, reason },
			index: { checked: false, reason },
		};
	}
	// An explicit --version pins the registry to a ref rather than a content hash, so a
	// content recompute would only ever compare that same ref against itself.
	if (inputs.version) {
		const reason =
			"version is pinned via --version, which doesn't track source content; rebuild manually to check for drift";
		return {
			source: { checked: false, reason },
			index: { checked: false, reason },
		};
	}

	let metadata: Record<string, ComposerMetadata> | undefined;
	try {
		metadata = inputs.metadata
			? z
					.record(z.string(), composerMetadataSchema)
					.parse(JSON.parse(await readFile(inputs.metadata, "utf8")))
			: undefined;
	} catch (error) {
		// A moved/unreadable --metadata file blocks both recomputes equally.
		const reason = `could not recompute: ${errorMessage(error)}`;
		return {
			source: { checked: false, reason },
			index: { checked: false, reason },
		};
	}

	if (!inputs.sources || inputs.sources.length === 0) {
		// Built from index.json alone (no --source): the whole registry IS the
		// index-derived content, so there's nothing source-only to isolate it from.
		const noSource: RegistrySourceCheck = {
			checked: false,
			reason:
				"registry was built from --index alone (no --source); there is no source-only signal to check",
		};
		try {
			// Same default as registry build's fallback branch.
			const indexPath =
				inputs.index ?? join(process.cwd(), "storybook-static/index.json");
			const index = storybookIndexSchema.parse(await readJsonSource(indexPath));
			const recomputed = buildRegistryFromStorybook(index, {
				storybookBaseUrl: inputs.storybookUrl,
				metadata,
			});
			return {
				source: noSource,
				index: {
					checked: true,
					current: recomputed.version === registry.version,
				},
			};
		} catch (error) {
			return {
				source: noSource,
				index: {
					checked: false,
					reason: `index unreachable: ${errorMessage(error)}`,
				},
			};
		}
	}

	if (!inputs.tsconfig) {
		const reason = "recorded inputs are missing --tsconfig; can't recompute";
		return {
			source: { checked: false, reason },
			index: { checked: false, reason },
		};
	}
	// Same default as registry build: projectRoot falls back to the tsconfig's directory
	// when it wasn't explicitly recorded.
	const projectRoot = inputs.projectRoot
		? resolve(inputs.projectRoot)
		: dirname(resolve(inputs.tsconfig));

	let sourceOnlyComponents: ComponentManifest[];
	try {
		// index intentionally omitted here — this recompute must never depend on
		// Storybook being reachable.
		const { registry: recomputed } = buildRegistryFromSource({
			projectRoot,
			sources: inputs.sources,
			tsconfigPath: inputs.tsconfig,
			storybookBaseUrl: inputs.storybookUrl,
			metadata,
		});
		sourceOnlyComponents = recomputed.components;
	} catch (error) {
		const reason = `could not recompute: ${errorMessage(error)}`;
		return {
			source: { checked: false, reason },
			index: {
				checked: false,
				reason:
					"source recompute failed, so the index layer was not checked either",
			},
		};
	}

	const categoryWithoutIndex = new Map(
		sourceOnlyComponents.map((component) => [component.id, component.category]),
	);
	const sourceCurrent = sameComponents(
		stripIndexDerivedFields(sourceOnlyComponents, categoryWithoutIndex),
		stripIndexDerivedFields(registry.components, categoryWithoutIndex),
	);
	const source: RegistrySourceCheck = { checked: true, current: sourceCurrent };

	if (!inputs.index) {
		return {
			source,
			index: {
				checked: false,
				reason:
					"registry was built without --index; no Storybook layer to check",
			},
		};
	}
	if (!sourceCurrent) {
		// The merged hash would differ from a changed source alone, which would make an
		// index-layer verdict here impossible to attribute correctly. Rebuilding refreshes
		// both anyway, so this doesn't need its own recompute.
		return {
			source,
			index: {
				checked: false,
				reason:
					"source already changed; rebuild to refresh the Storybook layer as well",
			},
		};
	}
	try {
		const index = storybookIndexSchema.parse(
			await readJsonSource(inputs.index),
		);
		const { registry: merged } = buildRegistryFromSource({
			projectRoot,
			sources: inputs.sources,
			tsconfigPath: inputs.tsconfig,
			index,
			storybookBaseUrl: inputs.storybookUrl,
			metadata,
		});
		return {
			source,
			index: { checked: true, current: merged.version === registry.version },
		};
	} catch (error) {
		// A missing/unreachable index.json (Storybook down or on a different port, the
		// common case). The source verdict above was already computed without touching
		// this, so it's unaffected.
		return {
			source,
			index: {
				checked: false,
				reason: `index unreachable: ${errorMessage(error)} — source check above is unaffected`,
			},
		};
	}
}

// `registry build` writes a registry; this reads one back and answers "is it still
// current?" in one shot, instead of a rebuild being the only way to find out.
async function registryStatus(
	flags: CliFlags,
	dataDir: string,
): Promise<number> {
	const registry = await loadRegistry(dataDir);
	const { source: sourceCheck, index: indexCheck } =
		await checkRegistryStatus(registry);
	if (flagBoolean(flags, "json")) {
		print({
			version: registry.version,
			generatedAt: registry.generatedAt ?? null,
			builtWith: registry.builtWith ?? null,
			builtWithCliPath: registry.builtWithCliPath ?? null,
			inputs: registry.inputs ?? null,
			runningVersion: yosegiVersion(),
			sourceCheck,
			indexCheck,
		});
		return 0;
	}
	print(
		formatRegistryStatus(registry, yosegiVersion(), sourceCheck, indexCheck),
	);
	// A read-only status query; staleness is reported in the output, not as a failure exit code.
	return 0;
}

// Record "when and from what this was built" on the registry itself. version is a content
// hash, so re-reading the host produces the same value as long as the content is the same —
// it can't be used to judge freshness. Recording this lets component list print the
// rebuild command directly.
function withBuildProvenance(
	registry: ComponentRegistry,
	flags: CliFlags,
): ComponentRegistry {
	const sources = flagList(flags, "source");
	return {
		version: registry.version,
		generatedAt: new Date().toISOString(),
		// Which Yosegi built it. Checked against the running CLI at read time (this catches
		// "an older Yosegi is missing newer fields", which version / generatedAt alone can't detect).
		builtWith: yosegiVersion(),
		// Which checkout's CLI built it. Printed as-is in component list's header, so the
		// reader doesn't have to guess which path the `yosegi` in the rebuild line refers to.
		builtWithCliPath: yosegiCliPath(),
		// Every flag that affects the content is recorded, so the rebuild can be reproduced
		// exactly. Dropping storybookUrl / version / projectRoot would make the rebuild line
		// produce a different registry.
		inputs: {
			sources: sources.length > 0 ? sources : undefined,
			tsconfig: flagString(flags, "tsconfig"),
			projectRoot: flagString(flags, "project-root"),
			index: flagString(flags, "index"),
			storybookUrl: flagString(flags, "storybook-url"),
			version: flagString(flags, "version"),
			metadata: flagString(flags, "metadata"),
			report: flagString(flags, "report"),
		},
		components: registry.components,
	};
}

// Build a registry and write it to data/registry.json.
//
// If --source is given, the host's source (TypeScript types) is used as the source of
// truth. Combined with --index, components that have a Story get a category and a
// recommendation flag (curation). Without --source, the registry is assembled from
// index.json alone, as before.
async function buildRegistry(flags: CliFlags): Promise<void> {
	const dataDir = flagString(flags, "data-dir") ?? DEFAULT_DATA_DIR;
	const out = flagString(flags, "out") ?? registryPath(dataDir);
	// The output destination is auto-created, same as screen generate. Otherwise an agent
	// would have to remember to insert an mkdir step just to pass a fresh --data-dir tmp/yosegi.
	await mkdir(dirname(out), { recursive: true });
	const storybookBaseUrl = flagString(flags, "storybook-url");
	const version = flagString(flags, "version");
	const sources = flagList(flags, "source");
	const indexFlag = flagString(flags, "index");
	// --metadata applies through either the --source or the --index path. If one path
	// silently ignored it, the result would be "I meant to supplement this but it had no
	// effect", so the load happens before the branch.
	const metadataPath = flagString(flags, "metadata");
	const metadata: Record<string, ComposerMetadata> | undefined = metadataPath
		? z
				.record(z.string(), composerMetadataSchema)
				.parse(JSON.parse(await readFile(metadataPath, "utf8")))
		: undefined;

	if (sources.length > 0) {
		const tsconfigPath = flagString(flags, "tsconfig");
		if (!tsconfigPath) {
			// INVALID_ARGUMENT rather than a bare Error: the caller can fix the invocation,
			// so it must not read as an internal failure.
			throw new ComposerError(
				SERVICE_CODES.INVALID_ARGUMENT,
				"--source requires --tsconfig <path>.",
			);
		}
		// The base for globs and ids. Defaults to the directory containing tsconfig (i.e.
		// the host's package root) when unspecified.
		const projectRoot =
			resolveProjectRoot(flags) ?? dirname(resolve(tsconfigPath));
		const index = indexFlag
			? storybookIndexSchema.parse(await readJsonSource(indexFlag))
			: undefined;
		// Defaults to resolving via tsconfig's paths. Hosts whose aliases live outside
		// tsconfig can spell them out with --import-map (same format as screen generate's
		// flag of the same name).
		const importMap = flagString(flags, "import-map");
		const {
			registry: built,
			stats,
			missed,
			unusedMetadataIds,
			outsideSources,
			reactTypesResolved,
		} = buildRegistryFromSource({
			projectRoot,
			sources,
			tsconfigPath,
			index,
			storybookBaseUrl,
			version,
			metadata,
			importMap: importMap ? buildImportMapResolver(importMap) : undefined,
		});
		const registry = withBuildProvenance(built, flags);
		await writeFile(out, `${JSON.stringify(registry, null, "\t")}\n`);
		const warnings: string[] = [];
		const hints: string[] = [];
		// Even if the glob matched zero files, a registry made up of only synthetic
		// primitives can still be written, so "Wrote 3 components" can look like a success.
		// Without a flag here, work could start on a screen with no real components, so
		// spell out the suspected misconfiguration explicitly.
		if (stats.files === 0) {
			warnings.push(
				`Warning: --source matched no files (--project-root: ${projectRoot}). Globs are relative to that directory.`,
			);
		}
		// The mirror image of the warning above: the glob matched files, but none of them
		// exported a React component (a non-React project, or globs that only cover
		// utilities). Only files: 0 warning would leave this case looking like a success.
		if (stats.files > 0 && stats.componentCandidates === 0) {
			warnings.push(
				`Warning: ${stats.files} files were read but no React component exports were found; check that the glob includes .tsx files and the project uses React.`,
			);
		}
		// Unresolved React typings degrade the registry without a single error: ReactNode
		// props collapse to `json` / `shape: any` and no slots are detected, yet
		// propsUnreadable stays at 0. Gated on componentCandidates so a non-React project
		// gets the warning above rather than both.
		if (stats.componentCandidates > 0 && !reactTypesResolved) {
			warnings.push(
				"Warning: React's type definitions did not resolve, so ReactNode props degrade to json and no slots are detected; check that the host's @types/react resolves through --tsconfig.",
			);
		}
		// A --metadata id that matched nothing is almost certainly a typo. Dropping it
		// silently would hide the reason the supplement had no effect, so name it explicitly.
		if (unusedMetadataIds.length > 0) {
			warnings.push(
				`Warning: these --metadata ids matched no component: ${unusedMetadataIds.join(", ")}`,
			);
		}
		// Prop JSDoc is the single input that most improves registry quality, and only the
		// host can write it. Even someone who doesn't pass --report should still learn
		// there's a place to write it.
		if (stats.withUndocumentedRequiredOpaqueProps > 0) {
			hints.push(
				`Hint: ${stats.undocumentedRequiredOpaqueProps} required props across ${stats.withUndocumentedRequiredOpaqueProps} components take a value no literal can express and carry no description. Add JSDoc to them; --report <path> lists which.`,
			);
		}
		// A prop referencing a type in a file --source doesn't cover leaves no entry and no
		// pointer in the Registry at all, so this is worth surfacing even to someone who
		// doesn't pass --report.
		if (outsideSources.totalCount > 0) {
			hints.push(
				`Hint: ${outsideSources.totalCount} host files are referenced by props but not covered by --source; see --report.`,
			);
		}
		// Don't drop what couldn't be extracted silently; let --report surface the breakdown.
		const reportPath = flagString(flags, "report");
		if (reportPath) {
			await mkdir(dirname(reportPath), { recursive: true });
			const undocumented = collectUndocumentedProps(registry.components);
			await writeFile(
				reportPath,
				`${JSON.stringify({ stats, missed, undocumented, outsideSources }, null, "\t")}\n`,
			);
		}
		// --json folds everything — including the warnings and hints the text output
		// interleaves — into one machine-readable object, so a caller doesn't have to
		// parse a mixed text/JSON stream.
		if (flagBoolean(flags, "json")) {
			print({
				out,
				version: registry.version,
				count: registry.components.length,
				stats,
				warnings,
				hints,
			});
			return;
		}
		print(
			`Wrote ${registry.components.length} components to ${out} (version ${registry.version})`,
		);
		for (const warning of warnings) {
			print(warning);
		}
		print(stats);
		for (const hint of hints) {
			print(hint);
		}
		if (reportPath) {
			print(`Wrote extraction report to ${reportPath}`);
		}
		return;
	}

	// Defaults to a host-independent cwd-relative path. Host-specific layouts spell it out
	// via --index.
	const indexPath =
		indexFlag ?? join(process.cwd(), "storybook-static/index.json");
	const index = storybookIndexSchema.parse(await readJsonSource(indexPath));
	const registry = withBuildProvenance(
		buildRegistryFromStorybook(index, {
			storybookBaseUrl,
			version,
			metadata,
		}),
		// Record the default path too, as "what this was built from", even when --index was omitted.
		{ ...flags, index: indexPath },
	);
	await writeFile(out, `${JSON.stringify(registry, null, "\t")}\n`);
	if (flagBoolean(flags, "json")) {
		// The index-only path has no extraction statistics; stats is null rather than
		// absent so the object's shape stays the same on both paths.
		print({
			out,
			version: registry.version,
			count: registry.components.length,
			stats: null,
			warnings: [],
			hints: [],
		});
		return;
	}
	print(
		`Wrote ${registry.components.length} components to ${out} (version ${registry.version})`,
	);
}

// The CLI itself: a thin Adapter that just calls the shared Application Service.
export async function runCli(argv: string[]): Promise<number> {
	// Help was asked for, so usage exits 0 — unlike an error, where usage never appears
	// and a coded JSON error does. Checked on the raw argv because parseArgs would fold
	// "--help <next token>" into a flag value and read "-h" as a positional.
	if (argv.includes("--help") || argv.includes("-h")) {
		print(usage());
		return 0;
	}
	const { positionals, flags } = parseArgs(argv);
	const [group, action, ...rest] = positionals;
	const dataDir = flagString(flags, "data-dir") ?? DEFAULT_DATA_DIR;

	if (positionals.length === 0) {
		// Only a bare "yosegi --version" reaches here — with a command present, --version
		// keeps its registry build meaning (the registry's version ref).
		if (flagBoolean(flags, "version")) {
			print({ version: yosegiVersion(), cliPath: yosegiCliPath() });
			return 0;
		}
		// A bare "yosegi" prints the command list, like --help, but exits 1: nothing was done.
		print(usage());
		return 1;
	}

	// "mcp" is the one group-only command; everything else is "<group> <action>".
	const command =
		group === "mcp"
			? "mcp"
			: action === undefined
				? group
				: `${group} ${action}`;
	if (COMMAND_FLAGS[command] === undefined) {
		return unknownCommand(command);
	}
	const flagFailure = checkFlags(command, flags);
	if (flagFailure !== null) {
		return flagFailure;
	}

	try {
		// The MCP server doesn't return until the connection closes. The import is kept
		// inside this branch so a single CLI invocation doesn't also load the MCP SDK
		// (the same reason bin/yosegi.js isn't started via exports).
		if (group === "mcp") {
			const { serveMcpOverStdio } = await import("../mcp/stdio.ts");
			await serveMcpOverStdio(dataDir);
			return 0;
		}

		if (group === "registry" && action === "build") {
			await buildRegistry(flags);
			return 0;
		}

		if (group === "registry" && action === "metadata") {
			return await generateMetadata(rest, flags);
		}

		if (group === "registry" && action === "status") {
			return await registryStatus(flags, dataDir);
		}

		if (group === "component") {
			const composer = await makeComposer(dataDir);
			if (action === "list") {
				return listComponents(composer, flags);
			}
			if (action === "inspect") {
				if (rest.length === 0) {
					return missingArgument(
						"component inspect",
						"component inspect requires at least one <componentId>.",
					);
				}
				return inspectComponent(composer, rest, flags);
			}
		}

		// generate / context don't use the screen store (they read Screen JSON directly from
		// a file), so this branch comes first, letting them work with just --registry even
		// without a data/registry.json.
		if (group === "screen" && action === "generate") {
			return await generateStory(rest[0], flags, dataDir);
		}

		if (group === "screen" && action === "context") {
			return await screenContext(rest[0], flags, dataDir);
		}

		if (group === "story" && action === "import") {
			return await importStoryFile(rest[0], flags, dataDir);
		}

		if (group === "screen") {
			// Store commands address a screen by id (or a file by path); reject a missing
			// one before touching the store, so the error names the argument rather than
			// surfacing as a downstream read failure.
			if (
				(action === "pull" ||
					action === "export" ||
					action === "validate" ||
					action === "push" ||
					action === "apply") &&
				rest[0] === undefined
			) {
				return missingArgument(
					`screen ${action}`,
					action === "push"
						? "screen push requires a <file.json> path."
						: `screen ${action} requires a <screenId>.`,
				);
			}
			if (action === "apply" && rest[1] === undefined) {
				return missingArgument(
					"screen apply",
					"screen apply requires an <operations.json> path.",
				);
			}
			const composer = await makeComposer(dataDir);
			switch (action) {
				case "list":
					print(await composer.screens.listScreens());
					return 0;
				case "pull":
				case "export":
					print(await composer.screens.getScreen(rest[0]));
					return 0;
				case "validate":
					print(await composer.screens.validate(rest[0]));
					return 0;
				case "push": {
					const screen = parseScreenDefinition(
						JSON.parse(await readFile(rest[0], "utf8")),
					);
					const exists = await composer.screens.getScreen(screen.id).then(
						() => true,
						() => false,
					);
					const result = exists
						? await composer.screens.updateScreen(
								screen.id,
								screen,
								screen.revision,
							)
						: await composer.screens.createScreen({
								id: screen.id,
								name: screen.name,
								root: screen.root,
								status: screen.status,
							});
					print(result);
					return 0;
				}
				case "apply": {
					const operations = parseScreenOperations(
						JSON.parse(await readFile(rest[1], "utf8")),
					);
					const current = await composer.screens.getScreen(rest[0]);
					print(
						await composer.screens.applyOperations(
							rest[0],
							operations,
							current.revision,
						),
					);
					return 0;
				}
			}
		}

		// Unreachable while COMMAND_FLAGS and the dispatch above stay in step; kept so a
		// drift between them still fails with the shared contract instead of hanging.
		return unknownCommand(command);
	} catch (error) {
		// The CLI's payloads come from files, so schema/JSON failures must not talk
		// about a "request".
		const { body } = toErrorResponse(error, { payloadSource: "file" });
		print(body);
		return 1;
	}
}

function usage(): string {
	return [
		"Yosegi CLI",
		"",
		"  registry build --source <glob> --tsconfig <path> [--source <glob> ...] [--project-root <dir>]",
		"                 [--index <path|url>] [--out <path>] [--storybook-url <url>] [--version <ref>] [--report <path>]",
		"                 [--metadata <path>] [--import-map <from=to,...>]",
		"      Build a registry from the types in the host's source. Adding --index tags",
		"      components that have a Story with a category and a recommendation flag (curation).",
		'      --metadata fills in props the types could not supply ({ "<id>": { "props": {...} } }).',
		"      Import specifiers are resolved through the tsconfig paths aliases, so the registry",
		'      reports the specifier the host writes ("~/components/button"). --import-map overrides',
		'      that for hosts whose aliases live elsewhere (e.g. "./app=~").',
		"      --report writes the exports that could not be extracted, plus the props worth",
		"      documenting, ranked so the top of the list is the one to write JSDoc on first.",
		"",
		"  registry build [--index <path|url>] [--out <path>] [--storybook-url <url>] [--version <ref>] [--metadata <path>]",
		"      Build a registry from Storybook's index.json alone (props then rely on explicit metadata).",
		"  registry metadata <componentId> [<componentId> ...] --tsconfig <path> [--project-root <dir>]",
		"                    [--source <glob> ...] [--out <path>]",
		"      For components whose props cannot be read from types, scaffold a --metadata template",
		"      from the host's cva variants. --source / --project-root / --tsconfig mean the same as",
		"      in registry build (globs resolve against --project-root, which defaults to the",
		"      directory holding the tsconfig). An id written as `<module path>#<name>` is resolved",
		"      through that path; a short id is looked up within the --source range.",
		"      Only variants are included, so check the source and add the remaining props.",
		"  registry status [--json]",
		"      Report when the registry was built, by which Yosegi/CLI, its recorded inputs,",
		"      and whether the host's current source still hashes to the stored version",
		"      (recomputed from the recorded inputs — current, or stale with a rebuild command).",
		"  component list [--category <name>] [--query <text> ...] [--json] [--quiet]",
		"      List the usable components, optionally filtered. --query can be repeated (or",
		"      comma-separated) to match any of several terms. The default output is a text",
		"      summary that includes prop types. --quiet drops the registry provenance header.",
		"  component inspect <componentId> [<componentId> ...] [--json] [--quiet]",
		"      Pin down one or more components' props and slots. Confirm props here; never",
		"      guess them. For two or more ids, the registry provenance header is printed once",
		"      above all of them (--quiet drops it); a single id's output is unchanged.",
		"  screen list",
		"  screen pull <screenId>",
		"  screen export <screenId>",
		"  screen validate <screenId>   # For screens saved in the screen store. A Screen JSON file is validated by screen generate",
		"  screen push <file.json>",
		"  screen apply <screenId> <operations.json>",
		"  screen generate <screen.json> --out <file.stories.tsx> [--title <title>] [--story-name <name>]",
		"                                [--import-map <from=to,...>] [--framework <pkg>] [--registry <file>]",
		"                                [--meta-template <file>]",
		"      --meta-template points at a host file that holds the boilerplate meta (tags /",
		"      parameters / JSDoc). A fragment or an existing Story both work; everything",
		"      except title is carried over.",
		"  screen context <screen.json> [--registry <file>] [--import-map <from=to,...>]",
		"                               [--route <path>] [--preferred-path <path>] [--out <file.json>]",
		"      Emit the context for turning a screen into an implementation (import statements,",
		"      used props, slot structure, and the bindings / events wiring tasks) as JSON.",
		"",
		"  story import <file.stories.tsx> [--registry <file>] [--import-map <from=to,...>]",
		"                                  [--story-name <name>] [--screen-id <id>] [--screen-name <name>]",
		"                                  [--out <screen.json>]",
		"      Read a Story back into Screen JSON. Anything that could not be interpreted",
		"      is reported in warnings.",
		"",
		"  mcp",
		"      Serve the MCP tools over stdio, and keep running until the client disconnects.",
		"      Register it with: claude mcp add yosegi -- npx yosegi mcp",
		"",
		"  common: --data-dir <dir>",
		"",
		"  --help / -h   Print this list and exit 0.",
		'  --version     Print { "version", "cliPath" } as JSON and exit 0.',
	].join("\n");
}
