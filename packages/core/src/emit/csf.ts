import {
	type ComponentManifest,
	type ComponentRegistry,
	indexRegistry,
} from "../domain/component-manifest.ts";
import { applyOperationsToRoot } from "../domain/operation.ts";
import { expandRepeat } from "../domain/repeat.ts";
import {
	EMIT_RESERVED_IDENTIFIERS,
	isJsIdentifier,
	type ScreenNode,
	type ScreenVariant,
	walkNodes,
} from "../domain/screen-definition.ts";
import { isSyntheticManifest } from "../domain/synthetics.ts";
import {
	assertEmittableNames,
	renderFixtures,
	renderJsdoc,
} from "./document.ts";
import { type RenderContext, renderRoot } from "./render.ts";

// Converts a Screen Definition tree into Storybook CSF (Component Story Format)
// source. The output is a ".stories.tsx" file that can be dropped straight into
// the host's Storybook — Yosegi has no rendering environment of its own. This is
// pure string generation with no dependency on React.
//
// The JSX rendering itself lives in render.ts; this module owns the CSF document
// around it: the import plan, the fixture consts, the meta, and the Story exports.

const DEFAULT_STORY_NAME = "Default";
const DEFAULT_FRAMEWORK_PACKAGE = "@storybook/react";
// Extensions stripped from the import specifier, restoring the form the host's bundler resolves.
const IMPORT_EXTENSION_PATTERN = /\.(tsx|ts|jsx|js)$/;
// In a Registry without componentPath, the story file's path ends up in packageName.
const STORY_SUFFIX_PATTERN = /\.stories$/;
// Local names the emitted file itself declares: `const meta` and the Meta / StoryObj
// type imports. A host export with one of these names must take a suffixed alias, or
// the generated Story declares the same identifier twice and cannot compile. The
// list lives in the domain (screen-definition.ts) because the fixtures schema
// rejects the same names, and the two sides must not drift apart.
const EMIT_DECLARED_LOCAL_NAMES: readonly string[] = EMIT_RESERVED_IDENTIFIERS;

// Boilerplate the host requires on a Story's meta (`tags` / `parameters`, the JSDoc
// directly above meta, etc.). Yosegi doesn't interpret this — it just splices the
// source fragments it's given straight into the output. Assembling the contents
// itself would leave room to fill in "information that doesn't exist," like a Figma
// URL that isn't real. Extracting the fragments is the job of the code that reads
// the host's files (parseMetaTemplate on the server).
export type MetaTemplate = {
	// Import statements to append after the generated ones. Ones that match exactly are not added.
	imports?: string[];
	// JSDoc placed directly above `const meta` (the full `/** ... */` text).
	jsdoc?: string;
	// Source fragments for properties to add to the meta object (e.g. `tags: ["autodocs"]`).
	// Don't include title — Yosegi writes that itself.
	properties?: string[];
};

export type EmitCsfOptions = {
	// meta.title. Determines the entry's placement in the Storybook sidebar.
	title: string;
	// The Story's export name. Defaults to "Default".
	storyName?: string;
	// Import source for the Meta / StoryObj types. Defaults to "@storybook/react".
	frameworkPackage?: string;
	// Converts the Registry's packageName to the host's import specifier. Defaults to the identity function.
	resolveImport?: (packageName: string) => string;
	// Meta boilerplate for the host's conventions.
	meta?: MetaTemplate;
	// Mock data emitted as top-level `const <name> = <JSON>;` declarations between
	// the imports and meta, in insertion order. Bindings reference the names as
	// written, so component imports yield the name instead (they get a suffixed
	// alias) — a fixture const can never be renamed.
	fixtures?: Record<string, unknown>;
	// Screen states emitted as additional `export const <name>: Story` blocks
	// after the base Story, each rendered from the base tree with the variant's
	// operations applied. Imports, fixtures, and meta are shared — the file stays
	// one Story module with several states of the same screen.
	variants?: ScreenVariant[];
};

// Converts a "./app=~,./packages/x=@y"-style spec into a prefix-replacement function.
export function buildImportMapResolver(
	spec: string,
): (packageName: string) => string {
	const rules = spec
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => {
			const separator = entry.indexOf("=");
			if (separator === -1) {
				throw new Error(
					`Invalid import map entry "${entry}". Expected "<from>=<to>".`,
				);
			}
			return {
				from: entry.slice(0, separator).trim(),
				to: entry.slice(separator + 1).trim(),
			};
		})
		// For containment relationships like "./app" vs "./app/ui", let the more specific one win.
		.sort((a, b) => b.from.length - a.from.length);

	// A bare startsWith would let "./app" swallow "./application/x" and rewrite it to
	// "~lication/x", so a rule only matches on a whole path segment: an exact match,
	// or a prefix followed by "/". A rule already ending in "/" carries its own boundary.
	const matches = (packageName: string, from: string): boolean =>
		from.endsWith("/")
			? packageName.startsWith(from)
			: packageName === from || packageName.startsWith(`${from}/`);

	return (packageName) => {
		const rule = rules.find((r) => matches(packageName, r.from));
		return rule
			? `${rule.to}${packageName.slice(rule.from.length)}`
			: packageName;
	};
}

// Normalizes a Registry packageName into import-specifier form (strips the extension
// and any .stories suffix). The reader normalizes with the same function to match up values.
export function normalizeImportSpecifier(raw: string): string {
	return raw
		.replace(IMPORT_EXTENSION_PATTERN, "")
		.replace(STORY_SUFFIX_PATTERN, "");
}

// Reduces a single Manifest to an import statement's specifier. The conversion is
// centralized here so the reader (inspect, implementation context) and the writer
// (CSF generation) always emit the same line.
//
// A `--import-map`, when passed, wins. The import map's rules are written against
// the Registry's raw path (packageName), so applying it to a specifier already
// resolved from tsconfig would double-convert it. Without one, the host specifier
// carried on the Registry is used.
export function resolveComponentSpecifier(
	manifest: ComponentManifest,
	resolveImport?: (packageName: string) => string,
): string {
	const raw = resolveImport
		? resolveImport(manifest.import.packageName)
		: (manifest.import.specifier ?? manifest.import.packageName);
	return normalizeImportSpecifier(raw);
}

export type ImportBinding = {
	exportName: string;
	localName: string;
	// Whether this import binds a default export (`import X from "..."`). Unspecified means named.
	kind?: "named" | "default";
};

// The import statement for a single specifier. When default and named bindings coexist, they're combined into one statement.
export function renderImportStatement(
	specifier: string,
	bindings: ImportBinding[],
): string {
	const defaultBinding = bindings.find((binding) => binding.kind === "default");
	const named = bindings
		.filter((binding) => binding.kind !== "default")
		.slice()
		.sort((a, b) => a.exportName.localeCompare(b.exportName))
		.map((binding) =>
			binding.exportName === binding.localName
				? binding.exportName
				: `${binding.exportName} as ${binding.localName}`,
		);
	const clause = [
		defaultBinding?.localName,
		named.length > 0 ? `{ ${named.join(", ")} }` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join(", ");
	// specifier can come from outside via --import-map. Always write it as a JSON
	// literal so it can never escape the string literal.
	return `import ${clause} from ${JSON.stringify(specifier)};`;
}

// The import plan the tree needs. Shared between CSF generation and the
// implementation context so "the import statements that appear in the Story" and
// "the import statements copied into the implementation" never diverge.
export type ImportPlan = {
	// import specifier -> the bindings imported from it (deduplicated per specifier).
	specifiers: Map<string, ImportBinding[]>;
	// Component id -> the local name used in JSX.
	localNames: Map<string, string>;
};

// Walks the tree to decide import statements and local names. Local-name collisions are resolved with a "Name2" suffix.
//
// Unregistered ids are silently skipped here. Deciding whether generation is
// impossible is left to the rendering side (requireRenderable), so callers like the
// implementation context — which want the rest returned even when some ids are
// unregistered — can still go through.
//
// Accepts several roots because a Story with variants is one file: every tree —
// the base and each variant's — shares the same import statements and local
// names, so one plan has to cover all of them. Passing the base first keeps the
// local names identical to a variant-free emit.
export function planImports(
	roots: ScreenNode | readonly ScreenNode[],
	registry: ComponentRegistry,
	resolveImport?: (packageName: string) => string,
	// Extra identifiers the surrounding file declares (e.g. the Story's export name).
	reservedLocalNames: Iterable<string> = [],
): ImportPlan {
	const manifests = indexRegistry(registry);
	const specifiers = new Map<string, ImportBinding[]>();
	const localNames = new Map<string, string>();
	const usedLocalNames = new Set<string>([
		...EMIT_DECLARED_LOCAL_NAMES,
		...reservedLocalNames,
	]);
	const rootList: readonly ScreenNode[] = Array.isArray(roots)
		? roots
		: [roots as ScreenNode];

	for (const node of rootList.flatMap((root) => walkNodes(root))) {
		const manifest = manifests.get(node.component) ?? null;
		if (!manifest || isSyntheticManifest(manifest)) {
			continue;
		}
		if (localNames.has(node.component)) {
			continue;
		}
		const specifier = resolveComponentSpecifier(manifest, resolveImport);
		const exportName = manifest.import.exportName;
		// The export name appears in an identifier position both in the import statement
		// and as the JSX tag name. Since a Registry can also be built from a remote
		// index.json, we verify here that it's actually writable as one.
		if (!isJsIdentifier(exportName)) {
			throw new Error(
				`Component "${manifest.id}" has export name "${exportName}", which is not a valid JavaScript identifier.`,
			);
		}
		const kind = manifest.import.kind === "default" ? "default" : "named";
		const bindings = specifiers.get(specifier) ?? [];
		const existing = bindings.find(
			(b) => b.exportName === exportName && b.kind === kind,
		);
		if (existing) {
			localNames.set(node.component, existing.localName);
			continue;
		}
		// A JSX tag starting with a lowercase letter is read as an HTML intrinsic
		// element rather than the imported component, so a lowercase export gets a
		// capitalized alias for its tag position.
		const base = /^[a-z]/.test(exportName)
			? `${exportName.charAt(0).toUpperCase()}${exportName.slice(1)}`
			: exportName;
		let localName = base;
		for (let suffix = 2; usedLocalNames.has(localName); suffix += 1) {
			localName = `${base}${suffix}`;
		}
		usedLocalNames.add(localName);
		bindings.push({ exportName, localName, kind });
		specifiers.set(specifier, bindings);
		localNames.set(node.component, localName);
	}

	return { specifiers, localNames };
}

// Reduces the plan to a list of import statements, sorted ascending by both
// specifier and member. Leaving them in tree traversal order would trip the host's
// import-ordering lint (Biome's organizeImports and the like) every time. Grouping
// rules differ per host, so we don't aim for an exact match — final formatting is
// left to the host's formatter.
export function renderImportStatements(plan: ImportPlan): string[] {
	return [...plan.specifiers]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([specifier, bindings]) => renderImportStatement(specifier, bindings));
}

function indent(line: string): string {
	return `\t${line}`;
}

// Reduces meta template properties into the body of the meta object. A fragment can
// span multiple lines (e.g. `parameters: { ... }`), so each line gets indented one
// level and a trailing comma is appended.
function renderMetaProperties(properties: string[]): string[] {
	return properties.flatMap((property) => {
		const lines = property.split("\n").map(indent);
		lines[lines.length - 1] = `${lines[lines.length - 1]},`;
		return lines;
	});
}

export function emitCsf(
	root: ScreenNode,
	registry: ComponentRegistry,
	options: EmitCsfOptions,
): string {
	const manifests = indexRegistry(registry);
	const storyName = options.storyName ?? DEFAULT_STORY_NAME;
	const fixtures = options.fixtures ?? {};
	const variants = options.variants ?? [];
	assertEmittableNames({
		exportName: storyName,
		exportKind: "Story",
		fixtures,
		variants,
		reservedIdentifiers: EMIT_DECLARED_LOCAL_NAMES,
	});
	// repeat expands here — after validation, before import planning — so the
	// Screen JSON keeps its single node while the Story shows the copies. A
	// variant's operations apply to the unexpanded base first: they target the
	// Screen JSON's node ids, which expansion rewrites.
	const expandedRoot = expandRepeat(root);
	const variantRoots = variants.map((variant) =>
		expandRepeat(applyOperationsToRoot(root, variant.operations)),
	);
	// The Story export names (base and variants) and the fixture consts are
	// identifiers this file declares, so a component import must not take the
	// same local name.
	const plan = planImports(
		[expandedRoot, ...variantRoots],
		registry,
		options.resolveImport,
		[
			storyName,
			...variants.map((variant) => variant.name),
			...Object.keys(fixtures),
		],
	);
	const context: RenderContext = {
		manifests,
		localNames: plan.localNames,
		fixtureNames: new Set(Object.keys(fixtures)),
	};

	const generatedImports = [
		`import type { Meta, StoryObj } from ${JSON.stringify(options.frameworkPackage ?? DEFAULT_FRAMEWORK_PACKAGE)};`,
		...renderImportStatements(plan),
	];
	const lines: string[] = [
		...generatedImports,
		// If a template-side import duplicates a generated one, it would sit there until
		// the host's lint flags it. Exact matches are dropped right here.
		...(options.meta?.imports ?? []).filter(
			(statement) => !generatedImports.includes(statement),
		),
	];
	const fixtureLines = renderFixtures(fixtures);
	if (fixtureLines.length > 0) {
		lines.push("");
		lines.push(...fixtureLines);
	}
	lines.push("");
	if (options.meta?.jsdoc) {
		lines.push(...options.meta.jsdoc.split("\n"));
	}
	lines.push(
		"const meta: Meta = {",
		`\ttitle: ${JSON.stringify(options.title)},`,
		...renderMetaProperties(options.meta?.properties ?? []),
		"};",
		"",
		"export default meta;",
		"",
		...renderStoryExport(storyName, expandedRoot, context),
	);
	variants.forEach((variant, index) => {
		lines.push("");
		if (variant.description !== undefined) {
			// The variant's description as a JSDoc directly above its export, where
			// Storybook's autodocs pick it up.
			lines.push(...renderJsdoc(variant.description));
		}
		lines.push(
			...renderStoryExport(variant.name, variantRoots[index], context),
		);
	});
	return `${lines.join("\n")}\n`;
}

// One `export const <name>: StoryObj` block. The base Story and every variant
// go through the same function so their shape can't drift.
function renderStoryExport(
	name: string,
	root: ScreenNode,
	context: RenderContext,
): string[] {
	return [
		`export const ${name}: StoryObj = {`,
		"\trender: () => (",
		...renderRoot(root, context).map((line) => `\t\t${line}`),
		"\t),",
		"};",
	];
}
