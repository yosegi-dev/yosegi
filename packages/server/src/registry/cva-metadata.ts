import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PropDefinition } from "@yosegi/core";
import type { ComposerMetadata } from "@yosegi/core/registry";
import * as ts from "typescript";
import { listSourceFiles, toModulePath } from "./source-registry.ts";

// Builds the scaffold passed to `registry build --metadata` from the host's cva
// (class-variance-authority) variants definitions.
//
// Parts whose props type is a union member, or that are exported after being cast like
// `const Text = Forwarded as TextComponent`, can't have their props traced by type
// extraction (source-registry.ts). Those have to be filled in by hand via `--metadata`,
// but what actually gets written there is just a copy of the host's cva variants object.
// This automates that copying.
//
// We don't add new extraction paths here. What this produces is only a draft for
// `--metadata`; the Registry core (type-based extraction) stays untouched. Props that
// never appear in variants (e.g. `as`, `bold`) won't be included, so a human (or agent)
// is expected to review and fill those in.
//
// No type resolution is performed — only the AST is read. cva's config object is almost
// always written as a literal, so there's no benefit to resolving tsconfig and building a
// full Program just for this.

const CVA_MODULE = "class-variance-authority";
const CVA_EXPORT = "cva";
const VARIANTS_KEY = "variants";
const DEFAULT_VARIANTS_KEY = "defaultVariants";
// Extensions tried when resolving a source file from an id's module path.
const SOURCE_EXTENSIONS = [".tsx", ".ts"];
// Upper bound on following a chain of `const A = B`. Guards against getting stuck on a circular reference.
const ALIAS_DEPTH_LIMIT = 8;
// If a variant's keys are exactly this set, treat it as a boolean prop (cva's StringToBoolean equivalent).
const BOOLEAN_KEYS = new Set(["true", "false"]);
// Separator used in ids (`<module path>#<exportName>`).
const ID_SEPARATOR = "#";

export type CvaMetadataOptions = {
	// Base directory for globs. Also the base for component id module paths.
	// Has the same meaning as registry build's --project-root — it's not relative to cwd.
	projectRoot: string;
	// Component ids to build a scaffold for.
	componentIds: string[];
	// Globs relative to projectRoot. Same semantics as registry build's --source, and
	// expansion is shared via listSourceFiles. When an id has no module path (short ids
	// coming from `--index` alone), this is what's searched by export name; when the id
	// does have a module path, this serves as a fallback search target.
	sources?: string[];
};

export type CvaMetadataResult = {
	// Ready to pass directly to `registry build --metadata <file>`.
	metadata: Record<string, ComposerMetadata>;
	// Reasons entries couldn't be included in the scaffold, and the source location to read instead.
	notes: string[];
};

// `<module path>#<exportName>`. An id without a `#` (standalone `--index` mode) is treated as just the export name.
function parseComponentId(id: string): {
	modulePath: string | null;
	exportName: string;
} {
	const separator = id.lastIndexOf(ID_SEPARATOR);
	if (separator === -1) {
		return { modulePath: null, exportName: id };
	}
	return {
		modulePath: id.slice(0, separator),
		exportName: id.slice(separator + 1),
	};
}

// A Registry id is a module path with the extension stripped, so try each candidate in turn.
function resolveModuleFile(
	projectRoot: string,
	modulePath: string,
): string | null {
	const base = join(projectRoot, modulePath);
	const candidates = [
		...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
		...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readSourceFile(path: string): ts.SourceFile {
	return ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
}

function describeLocation(node: ts.Node, sourceFile: ts.SourceFile): string {
	const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
	return `${sourceFile.fileName}:${line + 1}`;
}

// Local names cva may be bound to. Follows aliased imports (`import { cva as tv }`) too.
// `cva` stays a candidate even when no import is found (there may be a local definition or a wrapper-based declaration).
function collectCvaNames(sourceFile: ts.SourceFile): Set<string> {
	const names = new Set<string>([CVA_EXPORT]);
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			statement.moduleSpecifier.text !== CVA_MODULE
		) {
			continue;
		}
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) {
			continue;
		}
		for (const specifier of bindings.elements) {
			if ((specifier.propertyName ?? specifier.name).text === CVA_EXPORT) {
				names.add(specifier.name.text);
			}
		}
	}
	return names;
}

// A property name's literal value. Computed properties (`[key]:`) can't be read, so returns null.
function literalKey(name: ts.PropertyName): string | number | null {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
		return name.text;
	}
	if (ts.isNumericLiteral(name)) {
		return Number(name.text);
	}
	return null;
}

function literalValue(
	expression: ts.Expression,
): string | number | boolean | null {
	if (ts.isStringLiteral(expression)) {
		return expression.text;
	}
	if (ts.isNumericLiteral(expression)) {
		return Number(expression.text);
	}
	if (expression.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (expression.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	return null;
}

type CvaConfig = {
	// The variants object. Null when cva's second argument is absent.
	variants: ts.ObjectLiteralExpression | null;
	defaults: Map<string, string | number | boolean>;
	// The declaration itself (used for displaying a hint's location).
	declaration: ts.VariableDeclaration;
};

function readDefaultVariants(
	config: ts.ObjectLiteralExpression,
): Map<string, string | number | boolean> {
	const defaults = new Map<string, string | number | boolean>();
	const property = config.properties.find(
		(entry): entry is ts.PropertyAssignment =>
			ts.isPropertyAssignment(entry) &&
			literalKey(entry.name) === DEFAULT_VARIANTS_KEY,
	);
	if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
		return defaults;
	}
	for (const entry of property.initializer.properties) {
		if (!ts.isPropertyAssignment(entry)) {
			continue;
		}
		const key = literalKey(entry.name);
		const value = literalValue(entry.initializer);
		if (typeof key === "string" && value !== null) {
			defaults.set(key, value);
		}
	}
	return defaults;
}

// Collects every `const xxxVariants = cva(...)`.
function collectCvaConfigs(sourceFile: ts.SourceFile): Map<string, CvaConfig> {
	const cvaNames = collectCvaNames(sourceFile);
	const configs = new Map<string, CvaConfig>();
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			const initializer = declaration.initializer;
			if (
				!initializer ||
				!ts.isCallExpression(initializer) ||
				!ts.isIdentifier(initializer.expression) ||
				!cvaNames.has(initializer.expression.text) ||
				!ts.isIdentifier(declaration.name)
			) {
				continue;
			}
			const config = initializer.arguments[1];
			const object =
				config && ts.isObjectLiteralExpression(config) ? config : null;
			const variantsProperty = object?.properties.find(
				(entry): entry is ts.PropertyAssignment =>
					ts.isPropertyAssignment(entry) &&
					literalKey(entry.name) === VARIANTS_KEY,
			);
			const variants =
				variantsProperty &&
				ts.isObjectLiteralExpression(variantsProperty.initializer)
					? variantsProperty.initializer
					: null;
			configs.set(declaration.name.text, {
				variants,
				defaults: object ? readDefaultVariants(object) : new Map(),
				declaration,
			});
		}
	}
	return configs;
}

type VariantProps = {
	props: Record<string, PropDefinition>;
	// Variant names that couldn't be read statically (spreads, computed properties, variable references).
	opaque: string[];
};

// Reduces a variants object down to PropDefinitions.
//
// cva's VariantProps are all optional and nullable, so nullable is always set. When a
// variant's value set is exactly `true` / `false`, cva collapses it into a boolean type,
// so we emit boolean instead of enum in that case too.
function toVariantProps(
	variants: ts.ObjectLiteralExpression,
	defaults: Map<string, string | number | boolean>,
): VariantProps {
	const props: Record<string, PropDefinition> = {};
	const opaque: string[] = [];
	for (const entry of variants.properties) {
		if (!ts.isPropertyAssignment(entry)) {
			opaque.push(entry.name ? entry.name.getText() : "(unnamed)");
			continue;
		}
		const variantName = literalKey(entry.name);
		if (typeof variantName !== "string") {
			opaque.push(entry.name.getText());
			continue;
		}
		if (!ts.isObjectLiteralExpression(entry.initializer)) {
			opaque.push(variantName);
			continue;
		}
		const options: (string | number)[] = [];
		let readable = true;
		for (const option of entry.initializer.properties) {
			const key = ts.isPropertyAssignment(option)
				? literalKey(option.name)
				: null;
			if (key === null) {
				readable = false;
				break;
			}
			options.push(key);
		}
		if (!readable || options.length === 0) {
			opaque.push(variantName);
			continue;
		}
		const defaultValue = defaults.get(variantName);
		if (options.every((option) => BOOLEAN_KEYS.has(String(option)))) {
			props[variantName] = {
				kind: "boolean",
				nullable: true,
				defaultValue,
			};
			continue;
		}
		props[variantName] = {
			kind: "enum",
			nullable: true,
			options,
			defaultValue,
		};
	}
	return { props, opaque };
}

// Follows `export { Text }` back to the local name. Direct exports (`export const Text`) pass through unchanged.
function resolveLocalName(
	sourceFile: ts.SourceFile,
	exportName: string,
): string {
	for (const statement of sourceFile.statements) {
		if (
			!ts.isExportDeclaration(statement) ||
			statement.moduleSpecifier ||
			!statement.exportClause ||
			!ts.isNamedExports(statement.exportClause)
		) {
			continue;
		}
		for (const specifier of statement.exportClause.elements) {
			if (specifier.name.text === exportName) {
				return (specifier.propertyName ?? specifier.name).text;
			}
		}
	}
	return exportName;
}

type Declarations = Map<string, ts.Node>;

function collectTopLevelDeclarations(sourceFile: ts.SourceFile): Declarations {
	const declarations: Declarations = new Map();
	for (const statement of sourceFile.statements) {
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					declarations.set(declaration.name.text, declaration);
				}
			}
			continue;
		}
		if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement)) &&
			statement.name
		) {
			declarations.set(statement.name.text, statement);
		}
	}
	return declarations;
}

// Strips aliasing like `const Text = ForwardedText as TextComponent` and follows through to the underlying declaration.
function resolveDeclaration(
	declarations: Declarations,
	name: string,
): ts.Node | null {
	let current = declarations.get(name) ?? null;
	for (let depth = 0; current && depth < ALIAS_DEPTH_LIMIT; depth += 1) {
		if (!ts.isVariableDeclaration(current) || !current.initializer) {
			return current;
		}
		let initializer: ts.Expression = current.initializer;
		while (
			ts.isAsExpression(initializer) ||
			ts.isParenthesizedExpression(initializer) ||
			ts.isTypeAssertionExpression(initializer)
		) {
			initializer = initializer.expression;
		}
		if (!ts.isIdentifier(initializer)) {
			return current;
		}
		const next = declarations.get(initializer.text);
		if (!next || next === current) {
			return current;
		}
		current = next;
	}
	return current;
}

function collectIdentifierNames(node: ts.Node): Set<string> {
	const names = new Set<string>();
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current)) {
			names.add(current.text);
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return names;
}

// `Text` -> `textVariants`. Used as the last resort, relying on the host's naming convention.
function conventionalVariantName(exportName: string): string {
	return `${exportName.charAt(0).toLowerCase()}${exportName.slice(1)}Variants`;
}

type Association = {
	config: CvaConfig | null;
	note: string | null;
};

// Links a component's export to its cva declaration.
//
// Which variants the implementation actually calls is the most reliable clue, so we
// search among the identifiers appearing inside the declaration. Only when that search
// finds multiple matches or none do we fall back to the naming convention
// (`textVariants`) and to "there's only one cva in the file".
function associateCva(
	sourceFile: ts.SourceFile,
	exportName: string,
	configs: Map<string, CvaConfig>,
): Association {
	if (configs.size === 0) {
		return {
			config: null,
			note: `${sourceFile.fileName}: found no cva call. The component may simply not use variants.`,
		};
	}
	const localName = resolveLocalName(sourceFile, exportName);
	const declarations = collectTopLevelDeclarations(sourceFile);
	const declaration = resolveDeclaration(declarations, localName);
	if (!declaration) {
		return {
			config: null,
			note: `${sourceFile.fileName}: found no declaration for the export "${exportName}". Check that the file is the right one.`,
		};
	}

	const referenced = collectIdentifierNames(declaration);
	const matched = [...configs.keys()].filter((name) => referenced.has(name));
	if (matched.length === 1) {
		return { config: configs.get(matched[0]) ?? null, note: null };
	}

	const conventional = configs.get(conventionalVariantName(localName));
	if (matched.length > 1) {
		if (conventional) {
			return { config: conventional, note: null };
		}
		return {
			config: null,
			note: `${describeLocation(declaration, sourceFile)}: "${exportName}" references more than one cva (${matched.join(", ")}). Read the source to decide which variants are this component\u0027s props, then write them by hand.`,
		};
	}
	if (conventional) {
		return { config: conventional, note: null };
	}
	if (configs.size === 1) {
		const only = [...configs.values()][0];
		return { config: only, note: null };
	}
	return {
		config: null,
		note: `${describeLocation(declaration, sourceFile)}: could not trace a reference from the declaration of "${exportName}" to any cva (${[...configs.keys()].join(", ")}). Read the declaration to confirm which variants it uses.`,
	};
}

// The props scaffold for a single component.
function buildPropsForExport(
	sourceFile: ts.SourceFile,
	exportName: string,
): { props: Record<string, PropDefinition>; notes: string[] } {
	const configs = collectCvaConfigs(sourceFile);
	const { config, note } = associateCva(sourceFile, exportName, configs);
	if (!config) {
		return { props: {}, notes: note ? [note] : [] };
	}
	if (!config.variants) {
		return {
			props: {},
			notes: [
				`${describeLocation(config.declaration, sourceFile)}: the cva call has no variants. Read the source and write the props by hand.`,
			],
		};
	}
	const { props, opaque } = toVariantProps(config.variants, config.defaults);
	const notes =
		opaque.length > 0
			? [
					`${describeLocation(config.declaration, sourceFile)}: these variants could not be read statically and are missing from the template: ${opaque.join(", ")}`,
				]
			: [];
	return { props, notes };
}

// The names a file exposes. Used to find the owning file, among those expanded via
// --source, when an id carries no module path.
function collectExportNames(sourceFile: ts.SourceFile): Set<string> {
	const names = new Set<string>();
	for (const statement of sourceFile.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			statement.exportClause &&
			ts.isNamedExports(statement.exportClause)
		) {
			for (const specifier of statement.exportClause.elements) {
				names.add(specifier.name.text);
			}
			continue;
		}
		const exported = ts
			.getModifiers(statement as ts.HasModifiers)
			?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
		if (!exported) {
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					names.add(declaration.name.text);
				}
			}
			continue;
		}
		if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement)) &&
			statement.name
		) {
			names.add(statement.name.text);
		}
	}
	return names;
}

type SourceLookup = {
	path: string | null;
	note: string | null;
};

// Determines the source file from a component id.
//
// If the id has a `<module path>#<exportName>` form, the module path is the primary
// clue. Short ids from standalone `--index` mode (e.g. `Button`) have no path, so we
// search by export name among the files expanded via --source. Both paths are relative
// to projectRoot, never to cwd.
function lookupSourceFile(
	id: string,
	projectRoot: string,
	files: string[],
	readCached: (path: string) => ts.SourceFile,
): SourceLookup {
	const { modulePath, exportName } = parseComponentId(id);
	if (modulePath) {
		const direct = resolveModuleFile(projectRoot, modulePath);
		if (direct) {
			return { path: direct, note: null };
		}
		// Also search among what the glob matched, if any (a fallback for cases where the extension or index.tsx guess was wrong).
		const matched = files.find(
			(file) => toModulePath(projectRoot, file) === modulePath,
		);
		if (matched) {
			return { path: matched, note: null };
		}
		return {
			path: null,
			note: `${id}: neither ${join(projectRoot, modulePath)}.tsx nor .ts exists. Check that --project-root (or the directory of --tsconfig) matches the base the id was written against.`,
		};
	}

	if (files.length === 0) {
		return {
			path: null,
			note: `${id}: the id carries no module path. Narrow the source range with --source <glob>.`,
		};
	}
	const owners = files.filter((file) =>
		collectExportNames(readCached(file)).has(exportName),
	);
	if (owners.length === 1) {
		return { path: owners[0], note: null };
	}
	if (owners.length === 0) {
		return {
			path: null,
			note: `${id}: none of the ${files.length} files matched by --source exports "${exportName}".`,
		};
	}
	return {
		path: null,
		note: `${id}: several files export "${exportName}" (${owners
			.map((file) => toModulePath(projectRoot, file))
			.join(", ")}). Use the full id form (<module path>#${exportName}).`,
	};
}

export function buildCvaMetadata(
	options: CvaMetadataOptions,
): CvaMetadataResult {
	const projectRoot = resolve(options.projectRoot);
	const sources = options.sources ?? [];
	// Glob expansion goes through the same implementation as registry build (relative to projectRoot, Stories and tests excluded).
	const files = sources.length > 0 ? listSourceFiles(projectRoot, sources) : [];
	const sourceFiles = new Map<string, ts.SourceFile>();
	const readCached = (path: string): ts.SourceFile => {
		const cached = sourceFiles.get(path);
		if (cached) {
			return cached;
		}
		const parsed = readSourceFile(path);
		sourceFiles.set(path, parsed);
		return parsed;
	};

	const metadata: Record<string, ComposerMetadata> = {};
	const notes: string[] = [];
	// The command still proceeds with zero matches, but the export-name lookup path then
	// fails silently for every id. As with registry build, surface a likely misconfiguration up front.
	if (sources.length > 0 && files.length === 0) {
		notes.push(
			`--source matched no files (--project-root: ${projectRoot}). Globs are relative to that directory.`,
		);
	}

	for (const id of options.componentIds) {
		const { exportName } = parseComponentId(id);
		const { path, note } = lookupSourceFile(id, projectRoot, files, readCached);
		if (!path) {
			metadata[id] = { props: {} };
			if (note) {
				notes.push(note);
			}
			continue;
		}
		const extracted = buildPropsForExport(readCached(path), exportName);
		metadata[id] = { props: extracted.props };
		notes.push(...extracted.notes.map((entry) => `${id}: ${entry}`));
	}

	return { metadata, notes };
}
