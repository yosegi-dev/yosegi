import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import {
	type ComponentManifest,
	type ComponentRegistry,
	componentManifestSchema,
	mergeSyntheticComponents,
	type PropDefinition,
	type SlotDefinition,
} from "@yosegi/core";
import type { ComposerMetadata, StorybookIndex } from "@yosegi/core/registry";
import type {
	ComponentDoc,
	PropItem,
	PropItemType,
} from "react-docgen-typescript";
import * as ts from "typescript";
import { type DocCoverageStats, summarizeDocCoverage } from "./doc-coverage.ts";
import { loadDocgen } from "./docgen.ts";
import {
	buildModuleSpecifierResolver,
	type ModuleSpecifierResolver,
} from "./module-specifier.ts";
import {
	type HostDeclarationRef,
	hostDeclarationRefs,
	resolveCallSignatures,
	resolvePropShape,
} from "./prop-shape.ts";

// Registry generation that puts a part's ground truth in the host's TypeScript types.
//
// Reads the source directly and determines props / slots / import from the types. This
// makes enum validation possible, gets parts with no Story of their own (e.g.
// AlertTitle) into the Manifest too, and means the import target is never guessed.
// Storybook's index.json is used alongside it only as a curation signal for "which parts have a Story".
//
// react-docgen-typescript is used for type extraction. It's the same implementation
// Storybook itself uses to build argTypes, so what the Manifest contains rarely diverges from how things look in the host's own Storybook.

// Extensions scanned. .d.ts has no implementation, so it's dropped on the exclude side.
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
// Stories and tests aren't parts themselves, so they're always excluded.
const SOURCE_EXCLUDES = [
	"**/node_modules/**",
	"**/*.stories.*",
	"**/*.test.*",
	"**/*.spec.*",
	"**/*.d.ts",
];

// Upper bound on how many distinct outside-source files --report lists. Keeps a host
// with many loose non-glob files (rather than the usual one or two) from ballooning the report.
const DEFAULT_OUTSIDE_SOURCES_LIMIT = 50;

// An export carrying this JSDoc tag is never included in the Manifest.
const INTERNAL_TAG = "yosegi-internal";
// A JSDoc tag name is parsed as an identifier, so `@yosegi-internal` splits into
// tagName="yosegi" / comment="-internal". Both forms are accepted.
const INTERNAL_TAG_HEAD = "yosegi";
const INTERNAL_TAG_TAIL = "-internal";

// Types treated as a Slot (a place to put child elements). Only counted as a Slot when
// the entire type text matches this. A partial match would turn even an object type that merely has a ReactNode member into a Slot.
const NODE_TYPE_PATTERN =
	/^(React\.)?(ReactNode|ReactElement|ReactChild|JSX\.Element)(<[\s\S]*>)?$/;
// How a function type is detected. Any type text containing an arrow is treated as a function.
const FUNCTION_TYPE_PATTERN = /=>/;
// Union members representing optional / nullable. Checked after being collapsed out of the type text.
const NULLISH_UNION_PATTERN = /\s*\|\s*(undefined|null)\b/g;
// react-docgen-typescript wraps a function type's raw text in parentheses.
const WRAPPING_PARENS_PATTERN = /^\(([\s\S]*)\)$/;
const STRING_LITERAL_PATTERN = /^"([\s\S]*)"$/;
const NUMBER_LITERAL_PATTERN = /^-?\d+(\.\d+)?$/;
// Members appearing in a union that represent "no value". Collapsed into nullable/optional rather than kept as options.
const NULLISH_MEMBERS = new Set(["null", "undefined"]);
// Extensions stripped from an import specifier.
const EXTENSION_PATTERN = /\.(tsx|ts)$/;
// Where React's own type definitions live (HTML attributes, ARIA attributes, DOM events).
const REACT_TYPINGS_PATTERN = /node_modules\/@types\/react(-dom)?\//;

const CHILDREN_SLOT = "children";
const CLASS_NAME_PROP = "className";
// Many parts accept className / children, but not all of them. A part that closes off
// its own props (e.g. `interface Props { date: Date }`) or that just returns a Fragment
// doesn't. If the Manifest added these two unconditionally, inspect would report
// props/slots that don't actually exist, and a Story written trusting that would fail
// the host's type check. So they're only included when they actually appear in the type.
//
// Both are, in the type system, declared via @types/react (HTMLAttributes /
// DOMAttributes), so they're carved out as an exception from the isReactDeclaredProp
// filter that otherwise drops React-originated props. The only thing excluded here is
// the "is this React-originated" judgment — the fact that it appeared in that part's props type is unaffected.
const KEPT_REACT_PROPS = new Set<string>([CLASS_NAME_PROP, CHILDREN_SLOT]);

export type BuildSourceRegistryOptions = {
	// Base directory for globs. Also the base for the relative paths in id and import.packageName.
	projectRoot: string;
	// Globs relative to projectRoot (same notation as TypeScript's include).
	sources: string[];
	// tsconfig used for type resolution. Required, since the host's paths / jsx settings are used as-is.
	tsconfigPath: string;
	// index.json for cross-referencing Stories. curation is omitted when this isn't given.
	index?: StorybookIndex;
	// Storybook's public URL. Used to build the deep link in references.storybook.
	storybookBaseUrl?: string;
	// An explicit version (e.g. a git ref). Falls back to a content hash when omitted.
	version?: string;
	// Component id -> explicit metadata. Used to hand-fill props that couldn't be read from the type.
	metadata?: Record<string, ComposerMetadata>;
	// Rule overriding the specifier resolved from tsconfig's paths (the CLI's
	// --import-map). An escape hatch for hosts that set up aliases somewhere other than
	// tsconfig (e.g. a bundler's resolve.alias).
	importMap?: (packageName: string) => string;
};

// Aggregates used to measure extraction quality. Makes what's missed when applied to a host visible.
type ExtractionStats = {
	files: number;
	// Number of capitalized named exports that were judged to be components.
	componentCandidates: number;
	// Number of components whose props could be read from the type all the way through.
	extractedComponents: number;
	// Number of components for which react-docgen-typescript could not read props.
	// Ones whose props were filled in via --metadata are excluded from this count.
	propsUnreadable: number;
	skippedInternal: number;
	// Number of components with one or more props.
	withProps: number;
	withEnumProps: number;
	withNodeSlots: number;
	// Number of props whose one-level-deep shape could only be read as `any`. A handful is
	// normal (a genuinely untyped prop); a spike alongside withNodeSlots: 0 is the
	// signature of React's typings not resolving (see reactTypesResolved).
	anyShapedProps: number;
	withStory: number;
	// Number of components --metadata was applied to.
	metadataApplied: number;
	elapsedMs: number;
};

// Extraction stats with props' documentation coverage added in. Coverage is measured
// from the finished set of Manifests, so it isn't counted inside the extraction loop (doc-coverage.ts owns that definition).
export type SourceRegistryStats = ExtractionStats & DocCoverageStats;

// A candidate export that couldn't be turned into a Manifest entry. Used to investigate the cause.
export type MissedExport = {
	id: string;
	// props-unreadable: it is a component, but react-docgen-typescript couldn't read its
	// props, so only the className / children determinable from the type made it into the Manifest.
	// unnamed-default: an unnamed default export (`export default () => ...`). It has no
	// callable name, so it can't become either an id or a JSX tag name, and can't be
	// included. Naming it would let it be included.
	reason: "props-unreadable" | "internal" | "unnamed-default";
};

// A host file, referenced by one or more components' props, that --source's globs don't
// cover. Without this, a prop typed through a module like src/icons/ that the glob
// missed has no entry and no pointer in the Registry at all — an agent implementing
// against it has nothing to go on but a fabricated stand-in.
export type OutsideSourceRef = {
	// Module path relative to projectRoot, same normalized form as a component id's left half.
	file: string;
	// Component ids whose props reference a type declared in this file.
	referencedBy: string[];
	// Type names referenced from this file.
	types: string[];
};

export type OutsideSourcesReport = {
	// Total distinct files referenced, before the limit below is applied.
	totalCount: number;
	// Number of files dropped by the limit. Absent when 0.
	omitted?: number;
	files: OutsideSourceRef[];
};

export type SourceRegistryResult = {
	registry: ComponentRegistry;
	stats: SourceRegistryStats;
	missed: MissedExport[];
	// Entries written in --metadata that matched no component id at all. A likely typo in the id.
	unusedMetadataIds: string[];
	outsideSources: OutsideSourcesReport;
	// Whether React's type definitions resolve from the host's tsconfig. When they don't
	// (pnpm's strict node_modules, or a host that only gets @types/react transitively),
	// nothing errors: the checker types every ReactNode as `any`, so slot detection finds
	// nothing and ReactNode props collapse to `json` / `shape: any`, while every other
	// stat stays healthy-looking. True when there was nothing to check (no files matched).
	reactTypesResolved: boolean;
};

function contentHash(components: ComponentManifest[]): string {
	return createHash("sha256")
		.update(JSON.stringify(components))
		.digest("hex")
		.slice(0, 12);
}

// Reads tsconfig and pulls out the host's type-resolution settings (paths / jsx / lib).
//
// The tsconfig path is fixed to absolute before being passed to TypeScript.
// Passing a relative path as parseJsonConfigFileContent's basePath breaks include glob
// resolution and fails with "No inputs were found" (hit when `--tsconfig
// ./host/tsconfig.json` is written from outside the host).
function readCompilerOptions(rawTsconfigPath: string): {
	options: ts.CompilerOptions;
	// Base directory paths substitutions are resolved against: baseUrl if set, otherwise tsconfig's own location.
	basePath: string;
} {
	const tsconfigPath = resolve(rawTsconfigPath);
	const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (error) {
		throw new Error(
			`Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
		);
	}
	const parsed = ts.parseJsonConfigFileContent(
		config,
		ts.sys,
		dirname(tsconfigPath),
		{},
		tsconfigPath,
	);
	if (parsed.errors.length > 0) {
		throw new Error(
			`Failed to parse ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, " ")}`,
		);
	}
	// Since only the type information matters here, emit is always suppressed.
	return {
		options: { ...parsed.options, noEmit: true, declaration: false },
		basePath: parsed.options.baseUrl ?? dirname(tsconfigPath),
	};
}

// Storybook's tag marking a component as deprecated, same as the --index route reads.
const DEPRECATED_TAG = "deprecated";

// Whether the JSDoc carries @deprecated. Checked on both the export symbol and the
// resolved declaration, because a re-export (`export { X } from "./x"`) keeps the
// JSDoc on the underlying declaration only.
function hasDeprecatedTag(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	return symbol
		.getJsDocTags(checker)
		.some((tag) => tag.name === DEPRECATED_TAG);
}

// Extensions that carry type information. With allowJs on, "react" can resolve to the
// package's own index.js, which gives the checker no ReactNode either.
const TYPE_BEARING_EXTENSION_PATTERN = /\.(d\.[mc]?ts|[mc]?ts|tsx)$/;

// Whether importing "react" reaches its type definitions, checked once with the same
// resolution the program itself uses (so paths mappings and typeRoots are honored).
// Resolution failing is exactly the state that silently flattens ReactNode to `any`, so
// this is what lets the CLI warn instead of reporting a degraded build as success.
function reactTypesResolve(
	containingFile: string,
	compilerOptions: ts.CompilerOptions,
): boolean {
	const { resolvedModule } = ts.resolveModuleName(
		"react",
		containingFile,
		compilerOptions,
		ts.sys,
	);
	return (
		resolvedModule !== undefined &&
		TYPE_BEARING_EXTENSION_PATTERN.test(resolvedModule.resolvedFileName)
	);
}

// Whether @yosegi-internal is attached to the JSDoc.
function hasInternalTag(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	return symbol.getJsDocTags(checker).some((tag) => {
		if (tag.name === INTERNAL_TAG) {
			return true;
		}
		if (tag.name !== INTERNAL_TAG_HEAD) {
			return false;
		}
		const text = (tag.text ?? []).map((part) => part.text).join("");
		return text.trimStart().startsWith(INTERNAL_TAG_TAIL);
	});
}

// If the return type is a React element, that export is treated as a component (even if its props can't be read).
const ELEMENT_RETURN_PATTERN =
	/\b(ReactElement|ReactNode|JSX\.Element|Element)\b/;

// What to overwrite with, on the component-specific declaration side, for props whose names collide with inherited HTML attributes.
type PropOverride = {
	type: PropItemType;
	description: string;
};

// The export name of `export default`. Since it isn't an identifier, it can't be used
// as-is for either an id or a JSX tag name.
const DEFAULT_EXPORT = "default";

type ExportedSymbol = {
	// The name used for the id and the JSX tag name. For a default export, this borrows
	// the declaration's name. Null when an unnamed default export has no name to determine.
	name: string | null;
	// The displayName react-docgen-typescript attaches (= the export name on the
	// module). For a default export this becomes "default", so it's kept separate from name.
	docName: string;
	// Whether this is a default export. Needed to write the import statement correctly.
	isDefault: boolean;
	internal: boolean;
	// Whether the JSDoc carries @deprecated. Feeds constraints.deprecated, the same
	// signal the --index route derives from Storybook's "deprecated" tag.
	deprecated: boolean;
	// Whether calling this value returns a React element. Used to decide whether an
	// export react-docgen-typescript couldn't read gets rescued as "a component whose
	// type just couldn't be extracted" or discarded as a plain type/constant.
	componentLike: boolean;
	// The underlying symbol used to re-read colliding props (re-exports are already resolved).
	symbol: ts.Symbol;
	// Whether the props type is a union. When it is, the required judgment can't be trusted (see dropsRequired below).
	unionProps: boolean;
};

// Normalizes a union member to the same notation react-docgen-typescript uses (`"lg"` / `12` / a type name).
function unionMemberText(type: ts.Type, checker: ts.TypeChecker): string {
	if (type.isStringLiteral()) {
		return `"${type.value}"`;
	}
	if (type.isNumberLiteral()) {
		return String(type.value);
	}
	return checker.typeToString(type);
}

// Reduces a ts.Type down to the same shape as react-docgen-typescript's PropItemType.
// Matches the output shape produced when shouldExtractValuesFromUnion /
// shouldRemoveUndefinedFromOptional are enabled, so downstream (toPropDefinition) can handle both without telling them apart.
function toPropItemType(type: ts.Type, checker: ts.TypeChecker): PropItemType {
	const text = checker.typeToString(type).replace(" | undefined", "");
	if (!type.isUnion()) {
		return { name: text };
	}
	return {
		name: "enum",
		raw: text,
		value: type.types
			.map((member) => ({ value: unionMemberText(member, checker) }))
			.filter((entry) => entry.value !== "undefined"),
	};
}

// The name attached to a default export. For `export default function ContentCard()`,
// this is the declaration's name; for `export default ContentCard`, it's the name after
// alias resolution. An unnamed default export (`export default () => ...`) has no name, so this returns null.
function resolveDefaultExportName(symbol: ts.Symbol): string | null {
	const resolvedName = symbol.getName();
	if (resolvedName !== DEFAULT_EXPORT) {
		return resolvedName;
	}
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (
		declaration &&
		(ts.isFunctionDeclaration(declaration) ||
			ts.isClassDeclaration(declaration)) &&
		declaration.name
	) {
		return declaration.name.text;
	}
	return null;
}

// Judges whether something is a React component from its call signature's return type.
function isComponentLike(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	// A type alias or interface has no value, so it can never be a component.
	if (!declaration || !symbol.valueDeclaration) {
		return false;
	}
	const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
	return type
		.getCallSignatures()
		.some((signature) =>
			ELEMENT_RETURN_PATTERN.test(
				checker.typeToString(signature.getReturnType()),
			),
		);
}

// Whether the props type is a union.
//
// For a type that switches props by branch, like `LinkTile | ButtonTile`,
// react-docgen-typescript's required judgment doesn't line up with the actual type. A
// property present in only one branch can come down as required=true (→ a false
// MISSING_REQUIRED_PROP even though it isn't actually required), or the reverse can
// happen — a genuinely required property drops to optional. Which way it goes depends on how the props type happens to be composed.
//
// The Manifest errs on the side of "don't mark something required unless we can say so
// confidently". Dropping required leaves a gap in validation (false negatives), but it
// avoids the false positive of incorrectly rejecting a valid screen.
// See "required judgment" in docs/registry.md for details.
function hasUnionProps(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration || !symbol.valueDeclaration) {
		return false;
	}
	const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
	return type.getCallSignatures().some((signature) => {
		const propsParam = signature.getParameters()[0];
		if (!propsParam) {
			return false;
		}
		return checker
			.getTypeOfSymbolAtLocation(
				propsParam,
				propsParam.valueDeclaration ?? declaration,
			)
			.isUnion();
	});
}

// Collects prop names, among a props type's members, that have at least one declaration outside React.
//
// Composing a type like `React.HTMLAttributes<T> & VariantProps<typeof variants> & { as: ... }`
// makes cva's `color` variant collide by name with HTMLAttributes' (deprecated) `color`
// attribute. In that case react-docgen-typescript picks the React side's declaration,
// collapsing `"primary" | "danger"` down to `string` and also reporting the declaration
// source as React (= it gets dropped by propFilter).
//
// The synthetic symbol TypeChecker builds for an intersection type carries the
// declarations from both colliding sides. Even for a mapped type like `VariantProps`,
// its declaration points not to cva but to the host's file that defines variants. So
// "has at least one declaration outside React" is enough to tell them apart. Props that
// merely wrap a React attribute in a utility type, like `Omit<InputHTMLAttributes<T>, "size">`,
// still have their declaration in @types/react, so they don't end up in this set.
function collectHostContributedProps(propsType: ts.Type): Set<string> {
	const names = new Set<string>();
	for (const prop of propsType.getProperties()) {
		const declaredOutsideReact = (prop.getDeclarations() ?? []).some(
			(declaration) =>
				!REACT_TYPINGS_PATTERN.test(declaration.getSourceFile().fileName),
		);
		if (declaredOutsideReact) {
			names.add(prop.getName());
		}
	}
	return names;
}

// The type of a call signature's first argument (= props). A part with overloads returns one entry per signature.
type PropsType = {
	type: ts.Type;
	// The reference node passed to getTypeOfSymbolAtLocation.
	location: ts.Declaration;
};

function collectPropsTypes(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
): PropsType[] {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration) {
		return [];
	}
	const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
	const propsTypes: PropsType[] = [];
	for (const signature of type.getCallSignatures()) {
		const propsParam = signature.getParameters()[0];
		if (!propsParam) {
			continue;
		}
		const location = propsParam.valueDeclaration ?? declaration;
		propsTypes.push({
			type: checker.getTypeOfSymbolAtLocation(propsParam, location),
			location,
		});
	}
	return propsTypes;
}

// A component's prop types that are declared in the host's own source but outside the
// files --source's globs actually cover. Only the first signature is examined, same as
// withPropShapes / readKeptReactProps — a part with overloads that vary this isn't common
// enough to justify a second lookup pass here.
function collectOutsideSourceRefs(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	covered: Set<string>,
): HostDeclarationRef[] {
	const propsType = collectPropsTypes(symbol, checker)[0];
	if (!propsType) {
		return [];
	}
	const refs: HostDeclarationRef[] = [];
	for (const property of propsType.type.getProperties()) {
		const type = checker.getTypeOfSymbolAtLocation(
			property,
			propsType.location,
		);
		for (const ref of hostDeclarationRefs(type, checker)) {
			if (!covered.has(ref.file)) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

// Re-reads colliding props from the TypeChecker. The TypeChecker correctly resolves
// intersection types and returns `"primary" | "danger"`, letting the component-specific declaration take priority.
//
// The re-read is scoped to names because resolving a prop's type affects the order
// TypeScript generates literal types in, which would otherwise shift the enum options order of unrelated components too.
function resolvePropOverrides(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	// The names of props for which react-docgen-typescript took the type from React's own declaration.
	reactDeclared: Set<string>,
): Map<string, PropOverride> {
	const overrides = new Map<string, PropOverride>();
	for (const { type: propsType, location } of collectPropsTypes(
		symbol,
		checker,
	)) {
		// A colliding prop = one whose type came from React's declaration but that also has a host-side declaration.
		for (const name of collectHostContributedProps(propsType)) {
			const prop = reactDeclared.has(name)
				? propsType.getProperty(name)
				: undefined;
			if (!prop || overrides.has(name)) {
				continue;
			}
			overrides.set(name, {
				type: toPropItemType(
					checker.getTypeOfSymbolAtLocation(prop, location),
					checker,
				),
				description: ts.displayPartsToString(
					prop.getDocumentationComment(checker),
				),
			});
		}
	}
	return overrides;
}

// The names of props for which react-docgen-typescript took the type from React's own declaration.
function reactDeclaredPropNames(doc: ComponentDoc): Set<string> {
	const names = new Set<string>();
	for (const prop of Object.values(doc.props)) {
		if (isReactDeclaredProp(prop)) {
			names.add(prop.name);
		}
	}
	return names;
}

// Listing of named exports per file. Used both to cross-check against displayName and
// pin down the export name, and to count exports that were found in the types but never made it into a Manifest.
function collectExports(
	program: ts.Program,
	files: string[],
): Map<string, ExportedSymbol[]> {
	const checker = program.getTypeChecker();
	const byFile = new Map<string, ExportedSymbol[]>();
	for (const file of files) {
		const sourceFile = program.getSourceFile(file);
		if (!sourceFile) {
			continue;
		}
		const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
		if (!moduleSymbol) {
			byFile.set(file, []);
			continue;
		}
		const exported: ExportedSymbol[] = [];
		for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
			// A re-export like `export { X } from "./y"` is an alias, so it's followed through to the underlying symbol.
			const resolved =
				symbol.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(symbol)
					: symbol;
			const docName = symbol.getName();
			const isDefault = docName === DEFAULT_EXPORT;
			// A default export is not an unusual way to write a "usable part" (a
			// page-level composition example is almost always written this way). The
			// only case where a name can't be determined is an unnamed default export.
			exported.push({
				name: isDefault ? resolveDefaultExportName(resolved) : docName,
				docName,
				isDefault,
				internal: hasInternalTag(symbol, checker),
				deprecated:
					hasDeprecatedTag(symbol, checker) ||
					hasDeprecatedTag(resolved, checker),
				componentLike: isComponentLike(resolved, checker),
				symbol: resolved,
				unionProps: hasUnionProps(resolved, checker),
			});
		}
		// When `export function Foo` and `export default Foo` coexist, the same name
		// produces two entries, and the downstream id-lookup Map would silently drop one
		// via last-write-wins. The named export is kept in that case.
		const named = new Set(
			exported
				.filter((entry) => !entry.isDefault)
				.map((entry) => entry.name)
				.filter((name): name is string => name !== null),
		);
		byFile.set(
			file,
			exported.filter(
				(entry) =>
					!entry.isDefault || entry.name === null || !named.has(entry.name),
			),
		);
	}
	return byFile;
}

// Turns a union's value representation (`"lg"` / `12` / `true`) back into a Registry options value.
// A non-literal element (e.g. a type name) can't be treated as an enum member, so this returns null for it.
function toOptionValue(raw: string): string | number | boolean | null {
	const asString = STRING_LITERAL_PATTERN.exec(raw);
	if (asString) {
		return asString[1];
	}
	if (raw === "true") {
		return true;
	}
	if (raw === "false") {
		return false;
	}
	if (NUMBER_LITERAL_PATTERN.test(raw)) {
		return Number(raw);
	}
	return null;
}

type UnionInfo = {
	options: (string | number | boolean)[];
	nullable: boolean;
	// Whether this includes a non-literal member (if it does, it can't be treated as an enum).
	opaque: boolean;
};

function readUnion(prop: PropItem): UnionInfo {
	const members = Array.isArray(prop.type.value)
		? prop.type.value.map((entry: { value?: unknown }) => String(entry.value))
		: [];
	const options: (string | number | boolean)[] = [];
	let nullable = false;
	let opaque = false;
	for (const member of members) {
		if (NULLISH_MEMBERS.has(member)) {
			nullable = nullable || member === "null";
			continue;
		}
		const value = toOptionValue(member);
		if (value === null) {
			opaque = true;
			continue;
		}
		options.push(value);
	}
	return { options, nullable, opaque };
}

// react-docgen-typescript's defaultValue is either { value: unknown } or null.
function readDefaultValue(prop: PropItem): unknown {
	const raw: unknown = prop.defaultValue;
	if (raw && typeof raw === "object" && "value" in raw) {
		return (raw as { value: unknown }).value;
	}
	return undefined;
}

// The type text used for classification. raw if present (this preserves the union's
// original shape), otherwise the type name. null / undefined are stripped since they're
// handled separately as nullable, and a function type's outer parentheses are removed too.
function effectiveTypeText(prop: PropItem): string {
	const raw = (prop.type.raw ?? prop.type.name).replace(
		NULLISH_UNION_PATTERN,
		"",
	);
	return (WRAPPING_PARENS_PATTERN.exec(raw)?.[1] ?? raw).trim();
}

type TypeCategory = "node" | "function" | "string" | "number" | "boolean";

// Decides how a type is handled in the Registry, from its type text. Returns null (= goes to json) when it can't be classified.
function classifyTypeText(text: string): TypeCategory | null {
	if (NODE_TYPE_PATTERN.test(text)) {
		return "node";
	}
	if (FUNCTION_TYPE_PATTERN.test(text)) {
		return "function";
	}
	if (text === "string" || text === "number" || text === "boolean") {
		return text;
	}
	return null;
}

// A prop that takes a ReactNode is "a place to put child elements", not "a value", so it's routed to Slot.
function isNodeType(prop: PropItem): boolean {
	return classifyTypeText(effectiveTypeText(prop)) === "node";
}

// Reduces a PropItem down to the Registry's PropDefinition. Anything that doesn't fit a
// shape the agent can write a value for (string / number / boolean / enum) is rounded down to json, with editable=false.
//
// Because shouldExtractValuesFromUnion is enabled, every optional prop comes down as
// `name: "enum"` (even `string | undefined` is treated as a union). So the name alone
// isn't enough to tell them apart — a prop is only treated as an enum when its literal
// enumeration could actually be extracted; otherwise it's classified from the raw type text.
export function toPropDefinition(prop: PropItem): PropDefinition {
	const base = {
		description: prop.description.trim() || undefined,
		required: prop.required || undefined,
	};
	const text = effectiveTypeText(prop);
	const { options, nullable, opaque } = readUnion(prop);
	const nullableFlag = nullable || undefined;

	if (!opaque && options.length > 0) {
		// `boolean` becomes the union `true | false` at the checker level, so it comes down as an enum here.
		if (text === "boolean") {
			return {
				...base,
				kind: "boolean",
				nullable: nullableFlag,
				defaultValue: readDefaultValue(prop),
			};
		}
		return {
			...base,
			kind: "enum",
			options,
			nullable: nullableFlag,
			defaultValue: readDefaultValue(prop),
		};
	}

	const category = classifyTypeText(text);
	// nullable is still preserved even for kinds whose value shape can't be declared.
	// Whether null can be written in Screen JSON is information the Registry should still answer for these props too.
	if (category === "node") {
		return {
			...base,
			kind: "reactNode",
			nullable: nullableFlag,
			editable: false,
		};
	}
	if (category === "function") {
		return {
			...base,
			kind: "function",
			nullable: nullableFlag,
			editable: false,
		};
	}
	if (category === null) {
		return { ...base, kind: "json", nullable: nullableFlag, editable: false };
	}
	return {
		...base,
		kind: category,
		nullable: nullableFlag,
		defaultValue: readDefaultValue(prop),
	};
}

function toSlotDefinition(prop: PropItem): SlotDefinition {
	return {
		description: prop.description.trim() || undefined,
		required: prop.required || undefined,
	};
}

// Props for which react-docgen-typescript reported the declaration source as React's
// own type definitions (HTML attributes, ARIA attributes, DOM events). Around 280 of
// these tag along per component and would bury the host's actual API, so they're
// dropped. That's as far as this filtering goes — props of a third-party component the
// host merely wraps thinly (like Radix) are kept, since those are "that part's own
// API". A prop whose declaration source can't be pinpointed, like cva's VariantProps,
// carries no parent, so it's kept as well.
function isReactDeclaredProp(prop: PropItem): boolean {
	const parent = prop.parent?.fileName;
	return parent !== undefined && REACT_TYPINGS_PATTERN.test(parent);
}

// The names of React's per-element HTML attribute interfaces that name a concrete tag
// implicitly (ButtonHTMLAttributes -> button), for the ones where stripping
// "HTMLAttributes" and lowercasing wouldn't give the right word (Anchor -> a, Img -> img).
// Used to name the element in the pass-through note; a mixin not listed here still counts
// toward "has pass-through", it just can't be attributed to one specific tag.
const TAG_FROM_ATTRIBUTE_INTERFACE: Readonly<Record<string, string>> = {
	ButtonHTMLAttributes: "button",
	InputHTMLAttributes: "input",
	AnchorHTMLAttributes: "a",
	TextareaHTMLAttributes: "textarea",
	SelectHTMLAttributes: "select",
	FormHTMLAttributes: "form",
	LabelHTMLAttributes: "label",
	ImgHTMLAttributes: "img",
	LiHTMLAttributes: "li",
	OlHTMLAttributes: "ol",
	TableHTMLAttributes: "table",
	TdHTMLAttributes: "td",
	ThHTMLAttributes: "th",
	OptionHTMLAttributes: "option",
};

// Interface names that mark a prop as one of React's own DOM-attribute mixins but don't
// name one specific tag on their own: HTMLAttributes / DOMAttributes / AriaAttributes /
// RefAttributes apply to any element, and ComponentProps(WithoutRef|WithRef) take
// whatever element or component they're parameterized with (e.g. a Radix primitive,
// which itself resolves back to one of these same interfaces for its own DOM attributes).
const UNTAGGED_ATTRIBUTE_INTERFACES = new Set([
	"HTMLAttributes",
	"DOMAttributes",
	"AriaAttributes",
	"SVGAttributes",
	"RefAttributes",
	"ComponentProps",
	"ComponentPropsWithoutRef",
	"ComponentPropsWithRef",
]);

const ATTRIBUTE_INTERFACE_NAMES = new Set([
	...UNTAGGED_ATTRIBUTE_INTERFACES,
	...Object.keys(TAG_FROM_ATTRIBUTE_INTERFACE),
]);

// Mirrors react-docgen-typescript's own getParentType (lib/parser.js): a prop can only be
// declared in one place, and that declaration's enclosing interface/type-alias name is
// what identifies which DOM-attribute mixin (if any) it came from. Read directly off the
// TypeChecker's symbol rather than through react-docgen-typescript's Parser, because that
// Parser memoizes PropItem.parent in a cache keyed by `${declaringFile}_${propName}` alone
// (lib/parser.js, Parser.prototype.getPropsInfo) — it doesn't include the interface name.
// Sibling interfaces that share a member name (TdHTMLAttributes / ThHTMLAttributes both
// declare `colSpan`, InputHTMLAttributes / TextareaHTMLAttributes both declare `disabled`,
// …) collide on that key, so whichever component's prop resolves first in a batched parse
// "wins" the cache entry and every later component sharing that member name silently
// inherits the wrong parent. Resolving straight from each property symbol's own
// declarations sidesteps that shared cache entirely.
function getPropDeclaringTypeName(prop: ts.Symbol): string | undefined {
	const declarations = prop.getDeclarations();
	if (!declarations || declarations.length === 0) {
		return undefined;
	}
	const parent = declarations[0].parent;
	if (
		!parent ||
		!(ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent))
	) {
		return undefined;
	}
	return parent.name.text;
}

// The DOM-attribute mixin interface/type-alias names folded into a component's props
// type, resolved independently per component (see getPropDeclaringTypeName) instead of
// through react-docgen-typescript's shared-cache output.
function detectPassthroughMixins(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
): Set<string> {
	const mixinNames = new Set<string>();
	for (const { type: propsType } of collectPropsTypes(symbol, checker)) {
		for (const prop of propsType.getProperties()) {
			const name = getPropDeclaringTypeName(prop);
			if (name && ATTRIBUTE_INTERFACE_NAMES.has(name)) {
				mixinNames.add(name);
			}
		}
	}
	return mixinNames;
}

// The one-line note inspect shows after a component's props block when its props type
// folds in one of React's DOM-attribute mixins (via `extends`, an intersection, or a
// thinly-wrapped third-party primitive like Radix's). Covers exactly the props that
// isReactDeclaredProp-based filtering already drops from the Manifest — enumerating them
// individually was measured to add up to hundreds of entries of noise for a Radix
// wrapper, so only their existence (and the concrete element, when one interface pins it
// down) is surfaced instead. Returns undefined, rather than a guess, when no recognized
// mixin was found, and never names a tag it can't independently verify (see
// detectPassthroughMixins).
function detectPassthrough(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
): string | undefined {
	const mixinNames = detectPassthroughMixins(symbol, checker);
	if (mixinNames.size === 0) {
		return undefined;
	}
	const tag = [...mixinNames]
		.map((name) => TAG_FROM_ATTRIBUTE_INTERFACE[name])
		.find((candidate): candidate is string => candidate !== undefined);
	const subject = tag ? `${tag} ` : "";
	return `${subject}DOM props (onClick, aria-*, …) pass through`;
}

type SplitProps = {
	props: ComponentManifest["props"];
	slots: ComponentManifest["slots"];
	hasEnum: boolean;
	hasNodeSlot: boolean;
};

// Replaces a colliding prop's type/description with what was re-read from the TypeChecker.
function applyOverride(prop: PropItem, override: PropOverride): PropItem {
	return {
		...prop,
		type: override.type,
		description: override.description || prop.description,
	};
}

type ExtractOptions = {
	overrides: Map<string, PropOverride>;
	// Whether required should be distrusted (true when the props type is a union).
	dropsRequired: boolean;
};

// A prop that takes a ReactNode is "a place to put child elements", not "a value", so
// it's routed to Slot. This is what drives automatic discovery of named Slots.
function splitPropsAndSlots(
	doc: ComponentDoc,
	{ overrides, dropsRequired }: ExtractOptions,
): SplitProps {
	const props: ComponentManifest["props"] = {};
	const slots: ComponentManifest["slots"] = {};
	let hasEnum = false;
	let hasNodeSlot = false;
	for (const declared of Object.values(doc.props)) {
		// React-originated props are dropped. The exceptions are props whose name
		// collided and whose host-side declaration got hidden behind React's (these are
		// listed in overrides), and className / children, which are needed for composition.
		if (
			isReactDeclaredProp(declared) &&
			!overrides.has(declared.name) &&
			!KEPT_REACT_PROPS.has(declared.name)
		) {
			continue;
		}
		const override = overrides.get(declared.name);
		const withOverride = override
			? applyOverride(declared, override)
			: declared;
		const prop = dropsRequired
			? { ...withOverride, required: false }
			: withOverride;
		if (isNodeType(prop)) {
			slots[prop.name] = toSlotDefinition(prop);
			if (prop.name !== CHILDREN_SLOT) {
				hasNodeSlot = true;
			}
			continue;
		}
		const definition = toPropDefinition(prop);
		props[prop.name] = definition;
		hasEnum = hasEnum || definition.kind === "enum";
	}
	return { props, slots, hasEnum, hasNodeSlot };
}

// Reduces a ts.Symbol down to the same shape as react-docgen-typescript's PropItem, so
// that the Slot-vs-Prop and kind judgments run through the same path as props that came from rdt.
function toPropItem(
	name: string,
	member: ts.Symbol,
	checker: ts.TypeChecker,
	location: ts.Declaration,
): PropItem {
	return {
		name,
		required: (member.flags & ts.SymbolFlags.Optional) === 0,
		type: toPropItemType(
			checker.getTypeOfSymbolAtLocation(member, location),
			checker,
		),
		description: ts.displayPartsToString(
			member.getDocumentationComment(checker),
		),
		defaultValue: null,
	};
}

// For a part whose props react-docgen-typescript couldn't read, picks className /
// children back up via the TypeChecker alone. Even when the full props type can't be
// read, whether these two are accepted can still be determined from the call
// signature's props type. Since "genuinely accepts it but isn't in the Manifest so it
// can't be written" bites hardest exactly for parts that can't be read, whatever can be determined is picked up.
//
// A part whose props type can't be obtained at all (e.g. a factory that erases the
// argument type) returns nothing. Since there's no way to judge whether it's accepted,
// this errs toward not fabricating a value rather than assuming it exists.
function readKeptReactProps(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	dropsRequired: boolean,
): SplitProps {
	const props: ComponentManifest["props"] = {};
	const slots: ComponentManifest["slots"] = {};
	// For a part whose overloads change what's accepted, only what appears in the first signature is used.
	const propsTypes = collectPropsTypes(symbol, checker);
	const propsType = propsTypes[0];
	if (!propsType) {
		return { props, slots, hasEnum: false, hasNodeSlot: false };
	}
	const read = (name: string): PropItem | null => {
		const member = propsType.type.getProperty(name);
		if (!member) {
			return null;
		}
		const item = toPropItem(name, member, checker, propsType.location);
		return dropsRequired ? { ...item, required: false } : item;
	};

	const className = read(CLASS_NAME_PROP);
	if (className) {
		props[CLASS_NAME_PROP] = toPropDefinition(className);
	}
	// children is itself the place for JSX child elements, so it's placed in Slot even
	// when its type text doesn't look like ReactNode. There are declarations, like
	// react-hook-form's FormProvider (`ReactNode | ReactNode[]`), whose type text
	// doesn't match the pattern classified as Slot. Listing it as a value prop instead
	// would turn it into "a required prop the agent can't write".
	const children = read(CHILDREN_SLOT);
	if (children) {
		slots[CHILDREN_SLOT] = toSlotDefinition(children);
	}
	// hasEnum / hasNodeSlot measure "how much of the API could be read from the type",
	// so the className / children picked up here aren't counted (children was already excluded before this).
	return { props, slots, hasEnum: false, hasNodeSlot: false };
}

// Adds what can be read from the type to props whose value can't otherwise be written:
// a call signature for functions, the type's one-level-deep shape for everything else.
//
// json isn't "a box whose value can't be written" — it's "a type rdt couldn't classify",
// and the agent still has to write that value at implementation time. Listing only its
// name leaves it unwritable, so whatever shape can be determined is passed along.
// The same goes for function — a name alone isn't enough to write a call. A function
// whose type text has no `=>` (e.g. `Dispatch<SetStateAction<Date>>`) has its kind fall
// through to json, so the json branch also tries a call signature first.
// Props overwritten via explicit metadata are left untouched (the hand-written definition is treated as authoritative).
function withPropShapes(
	props: ComponentManifest["props"],
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	explicit: Set<string>,
): ComponentManifest["props"] {
	const opaque = Object.entries(props).filter(
		([name, def]) =>
			(def.kind === "json" || def.kind === "function") && !explicit.has(name),
	);
	if (opaque.length === 0) {
		return props;
	}
	// For a part with overloads, only the first signature's accepted shape is examined (same as readKeptReactProps).
	const propsType = collectPropsTypes(symbol, checker)[0];
	if (!propsType) {
		return props;
	}
	const next = { ...props };
	for (const [name, def] of opaque) {
		const member = propsType.type.getProperty(name);
		if (!member) {
			continue;
		}
		const type = checker.getTypeOfSymbolAtLocation(member, propsType.location);
		const signatures = resolveCallSignatures(type, checker, propsType.location);
		if (signatures) {
			next[name] = { ...def, signatures };
			continue;
		}
		if (def.kind !== "json") {
			continue;
		}
		const shape = resolvePropShape(type, checker, propsType.location);
		if (shape) {
			next[name] = { ...def, shape };
		}
	}
	return next;
}

type StoryCuration = {
	title: string;
	displayName: string;
	category: string;
	storyId: string;
	storyCount: number;
	// The Story file (Storybook's importPath). Kept separately even when keyed by
	// componentPath, since the usage example itself is written in the Story file.
	storyFile: string;
	// Individual Story names, in index.json's original order.
	storyNames: string[];
	// Whether any of the component's Stories carries the "deprecated" tag — the same
	// aggregation the --index route applies.
	deprecated: boolean;
};

// Collapses index.json's entries down to one per "implementation file". If componentPath
// is set, that's the implementation file; otherwise the Story file itself is the key.
function collectStoryCuration(
	index: StorybookIndex,
): Map<string, StoryCuration> {
	const byPath = new Map<string, StoryCuration>();
	for (const entry of Object.values(index.entries)) {
		if (entry.type !== "story") {
			continue;
		}
		const key = normalizeModulePath(entry.componentPath ?? entry.importPath);
		const deprecated = (entry.tags ?? []).includes(DEPRECATED_TAG);
		const existing = byPath.get(key);
		if (existing) {
			existing.storyCount += 1;
			existing.storyNames.push(entry.name);
			existing.deprecated ||= deprecated;
			continue;
		}
		const segments = entry.title.split("/").filter(Boolean);
		byPath.set(key, {
			title: entry.title,
			displayName: segments.at(-1) ?? entry.title,
			category: segments.length > 1 ? segments[0] : "uncategorized",
			storyId: entry.id,
			storyCount: 1,
			storyFile: entry.importPath,
			storyNames: [entry.name],
			deprecated,
		});
	}
	return byPath;
}

// Maps "./app/components/alert.tsx" and "app/components/alert" onto the same key.
function normalizeModulePath(path: string): string {
	return path.replace(/^\.\//, "").replace(EXTENSION_PATTERN, "");
}

// The category for a part with no Story. Uses its containing directory as-is.
function directoryCategory(modulePath: string): string {
	const directory = dirname(modulePath);
	return directory === "." ? "uncategorized" : directory;
}

// Matches the form Storybook's componentPath uses ("./app/components/alert.tsx"). The
// CSF emitter strips the extension on its side, so leaving it as-is here works fine as an import specifier.
function toPackageName(projectRoot: string, filePath: string): string {
	return `./${relative(projectRoot, filePath).split("\\").join("/")}`;
}

// Expands `--source`'s globs into actual files. Relative to projectRoot (never cwd),
// with Stories and tests always excluded. Every command that accepts `--source` goes
// through this, so the same flag always means the same thing.
export function listSourceFiles(
	projectRoot: string,
	sources: string[],
): string[] {
	return ts.sys.readDirectory(
		resolve(projectRoot),
		SOURCE_EXTENSIONS,
		SOURCE_EXCLUDES,
		sources,
	);
}

// The module path relative to projectRoot (no extension). Same form as the first half of a Registry id.
export function toModulePath(projectRoot: string, filePath: string): string {
	return normalizeModulePath(toPackageName(projectRoot, filePath));
}

// The specifier the host would write in an import statement. An explicit --import-map
// entry takes top priority, followed by tsconfig's paths. If neither resolves it, this
// is left unset (downstream falls back to using packageName directly as the specifier).
function hostSpecifier(
	packageName: string,
	filePath: string,
	resolveSpecifier: ModuleSpecifierResolver,
	importMap: ((packageName: string) => string) | undefined,
): string | undefined {
	const mapped = importMap?.(packageName);
	if (mapped !== undefined && mapped !== packageName) {
		return mapped;
	}
	return resolveSpecifier(filePath) ?? undefined;
}

export function buildRegistryFromSource(
	options: BuildSourceRegistryOptions,
): SourceRegistryResult {
	const startedAt = Date.now();
	const projectRoot = resolve(options.projectRoot);
	const files = listSourceFiles(projectRoot, options.sources);
	const { options: compilerOptions, basePath } = readCompilerOptions(
		options.tsconfigPath,
	);
	// If the host has aliases set up via tsconfig's paths, the Manifest's import line is written in that form.
	const resolveSpecifier = buildModuleSpecifierResolver({
		paths: compilerOptions.paths,
		basePath,
	});
	const program = ts.createProgram(files, compilerOptions);
	const checker = program.getTypeChecker();
	const exportsByFile = collectExports(program, files);

	const docs = loadDocgen()
		.withCompilerOptions(compilerOptions, {
			shouldExtractLiteralValuesFromEnum: true,
			shouldExtractValuesFromUnion: true,
			shouldRemoveUndefinedFromOptional: true,
			// children should be picked up exactly as its type says, so it isn't dropped based on whether a doc comment is present.
			skipChildrenPropWithoutDoc: false,
			// The id uses the export name, not displayName. displayName isn't trusted, since
			// it can be given a different name than the actual export, e.g. `Text.displayName = "Text"`.
			componentNameResolver: (exp) => exp.getName(),
		})
		.parseWithProgramProvider(files, () => program);

	const curationByPath = options.index
		? collectStoryCuration(options.index)
		: new Map<string, StoryCuration>();
	const baseUrl = options.storybookBaseUrl?.replace(/\/$/, "");

	const docsByFile = new Map<string, ComponentDoc[]>();
	for (const doc of docs) {
		const bucket = docsByFile.get(doc.filePath);
		if (bucket) {
			bucket.push(doc);
			continue;
		}
		docsByFile.set(doc.filePath, [doc]);
	}

	// Files actually covered by --source, for collectOutsideSourceRefs to check against.
	// The checker resolves declarations across every file TypeScript pulls in through
	// imports, not just these root files, which is exactly what makes a reference to an
	// uncovered file detectable in the first place.
	const coveredFiles = new Set(files);
	const outsideSourceRefs = new Map<
		string,
		{ types: Set<string>; referencedBy: Set<string> }
	>();

	const components: ComponentManifest[] = [];
	const missed: MissedExport[] = [];
	const metadata = options.metadata ?? {};
	// Tracks which ids were actually applied, so entries that matched none can be
	// returned as a warning. Silently ignoring them would hide a "thought it was applied but wasn't" state.
	const usedMetadataIds = new Set<string>();
	const stats: ExtractionStats = {
		files: files.length,
		componentCandidates: 0,
		extractedComponents: 0,
		propsUnreadable: 0,
		skippedInternal: 0,
		withProps: 0,
		withEnumProps: 0,
		withNodeSlots: 0,
		anyShapedProps: 0,
		withStory: 0,
		metadataApplied: 0,
		elapsedMs: 0,
	};

	for (const file of files) {
		const packageName = toPackageName(projectRoot, file);
		const specifier = hostSpecifier(
			packageName,
			file,
			resolveSpecifier,
			options.importMap,
		);
		const modulePath = normalizeModulePath(packageName);
		const curation = curationByPath.get(modulePath);
		const documented = new Map(
			(docsByFile.get(file) ?? []).map((doc) => [doc.displayName, doc]),
		);
		// A Storybook "deprecated" tag identifies a file, not an export. With several
		// component exports in one module the tag cannot say which one it means, so it
		// only applies to an unambiguous export: the module's sole component export, or
		// the one whose name matches the Story title's display name.
		const componentExportNames = (exportsByFile.get(file) ?? [])
			.filter(
				(e) =>
					e.name !== null &&
					/^[A-Z]/.test(e.name) &&
					!e.internal &&
					(documented.has(e.docName) || e.componentLike),
			)
			.map((e) => e.name);

		for (const exported of exportsByFile.get(file) ?? []) {
			const doc = documented.get(exported.docName);
			// An unnamed default export. Since the host can just name it to have it
			// included, this is reported rather than silently dropped.
			if (exported.name === null) {
				if (doc || exported.componentLike) {
					stats.componentCandidates += 1;
					missed.push({
						id: `${modulePath}#${DEFAULT_EXPORT}`,
						reason: "unnamed-default",
					});
				}
				continue;
			}
			// Types, constants, and hooks are not parts. Component candidates are limited to exports starting with a capital letter.
			if (!/^[A-Z]/.test(exported.name)) {
				continue;
			}
			// A type alias or constant is not a part. Only values that return a React element are counted as candidates.
			if (!doc && !exported.componentLike) {
				continue;
			}
			stats.componentCandidates += 1;
			const id = `${modulePath}#${exported.name}`;
			if (exported.internal) {
				stats.skippedInternal += 1;
				missed.push({ id, reason: "internal" });
				continue;
			}

			for (const ref of collectOutsideSourceRefs(
				exported.symbol,
				checker,
				coveredFiles,
			)) {
				const refKey = toModulePath(projectRoot, ref.file);
				const bucket = outsideSourceRefs.get(refKey) ?? {
					types: new Set(),
					referencedBy: new Set(),
				};
				bucket.types.add(ref.name);
				bucket.referencedBy.add(id);
				outsideSourceRefs.set(refKey, bucket);
			}

			// Even a component whose props couldn't be read still gets its existence
			// recorded in the Manifest. Knowing just the id and the import is enough to
			// "use that part", and having empty props isn't a regression — it's the same
			// state as a Registry built from index.json alone.
			const extracted = doc
				? splitPropsAndSlots(doc, {
						// Only the colliding props are re-read from the type, since rdt returns React's own type for them.
						overrides: resolvePropOverrides(
							exported.symbol,
							checker,
							reactDeclaredPropNames(doc),
						),
						dropsRequired: exported.unionProps,
					})
				: readKeptReactProps(exported.symbol, checker, exported.unionProps);
			// For a part whose props can't be read due to a union type or an `as` cast,
			// --metadata lets it be hand-filled. Explicit metadata takes priority over
			// what could be extracted from the type (if the value written to fill it in
			// lost to an incomplete type-derived definition, there'd be no point in filling it in at all).
			const explicit = metadata[id];
			if (explicit) {
				usedMetadataIds.add(id);
				stats.metadataApplied += 1;
			}
			const props = withPropShapes(
				{ ...extracted.props, ...explicit?.props },
				exported.symbol,
				checker,
				new Set(Object.keys(explicit?.props ?? {})),
			);
			const slots = { ...extracted.slots, ...explicit?.slots };
			const hasEnum =
				extracted.hasEnum ||
				Object.values(explicit?.props ?? {}).some((p) => p.kind === "enum");
			const hasNodeSlot =
				extracted.hasNodeSlot ||
				Object.values(explicit?.props ?? {}).some(
					(p) => p.kind === "reactNode",
				);
			if (doc) {
				stats.extractedComponents += 1;
			} else if (explicit?.props) {
				// When already filled in via metadata, it's not treated as "unreadable" and isn't listed in --report either.
			} else {
				stats.propsUnreadable += 1;
				missed.push({ id, reason: "props-unreadable" });
			}
			for (const definition of Object.values(props)) {
				if (definition.kind === "json" && definition.shape?.type === "any") {
					stats.anyShapedProps += 1;
				}
			}
			if (Object.keys(props).length > 0) {
				stats.withProps += 1;
			}
			if (hasEnum) {
				stats.withEnumProps += 1;
			}
			if (hasNodeSlot) {
				stats.withNodeSlots += 1;
			}
			if (curation) {
				stats.withStory += 1;
			}
			// deprecated comes from the host itself — a JSDoc @deprecated on the export
			// or a "deprecated" Story tag. Explicit metadata wins, mirroring how
			// buildRegistryFromStorybook resolves the same field.
			const storyDeprecated =
				curation?.deprecated === true &&
				(componentExportNames.length === 1 ||
					curation.displayName === exported.name);
			const deprecated =
				explicit?.constraints?.deprecated ??
				(exported.deprecated || storyDeprecated || undefined);

			components.push(
				componentManifestSchema.parse({
					id,
					name: exported.name,
					description:
						explicit?.description ?? (doc?.description.trim() || undefined),
					// The category comes from the Story's title; a Story-less part falls back to its containing directory.
					category:
						explicit?.category ??
						curation?.category ??
						directoryCategory(modulePath),
					import: explicit?.import ?? {
						packageName,
						exportName: exported.name,
						// named is the default, so it isn't written out (avoids inflating the Manifest's diff unnecessarily).
						kind: exported.isDefault ? "default" : undefined,
						specifier,
					},
					props,
					slots,
					constraints:
						deprecated === undefined
							? explicit?.constraints
							: { ...explicit?.constraints, deprecated },
					usage: explicit?.usage,
					// Whether props could be read all the way through from the type. Used to decide whether inspect shows a caveat.
					propsFromTypes: Boolean(doc) || Boolean(explicit?.props),
					// Only computed when doc is present, matching propsFromTypes: a component
					// whose props react-docgen-typescript couldn't read at all (a union type,
					// an `as` cast) is exactly the case readKeptReactProps falls back for, and
					// guessing at a mixin there would contradict "no note when unsure".
					passthrough: doc
						? detectPassthrough(exported.symbol, checker)
						: undefined,
					curation: curation
						? {
								recommended: true,
								storyTitle: curation.title,
								storyCount: curation.storyCount,
								storyFile: curation.storyFile,
								storyNames: curation.storyNames,
							}
						: { recommended: false },
					references:
						explicit?.references ??
						(baseUrl && curation
							? { storybook: `${baseUrl}/?path=/story/${curation.storyId}` }
							: undefined),
				}),
			);
		}
	}

	const merged = mergeSyntheticComponents(components);
	merged.sort((a, b) => a.id.localeCompare(b.id));
	stats.elapsedMs = Date.now() - startedAt;

	const unusedMetadataIds = Object.keys(metadata)
		.filter((id) => !usedMetadataIds.has(id))
		.sort();

	const outsideSourceEntries = [...outsideSourceRefs.entries()]
		.map(([file, { types, referencedBy }]) => ({
			file,
			referencedBy: [...referencedBy].sort(),
			types: [...types].sort(),
		}))
		.sort((a, b) => a.file.localeCompare(b.file));
	const outsideSourcesOmitted = Math.max(
		outsideSourceEntries.length - DEFAULT_OUTSIDE_SOURCES_LIMIT,
		0,
	);
	const outsideSources: OutsideSourcesReport = {
		totalCount: outsideSourceEntries.length,
		...(outsideSourcesOmitted > 0 ? { omitted: outsideSourcesOmitted } : {}),
		files: outsideSourceEntries.slice(0, DEFAULT_OUTSIDE_SOURCES_LIMIT),
	};

	return {
		registry: {
			version: options.version ?? `src:${contentHash(merged)}`,
			components: merged,
		},
		stats: { ...stats, ...summarizeDocCoverage(merged) },
		missed,
		unusedMetadataIds,
		outsideSources,
		// Resolution is directory-independent within one host, so the first matched file
		// stands in for all of them. With no files there is nothing to resolve from (and
		// the files: 0 warning already covers that state).
		reactTypesResolved:
			files.length === 0 || reactTypesResolve(files[0], compilerOptions),
	};
}
