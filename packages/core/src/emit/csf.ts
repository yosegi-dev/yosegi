import { z } from "zod";
import {
	type ComponentManifest,
	type ComponentRegistry,
	indexRegistry,
	type PropDefinition,
} from "../domain/component-manifest.ts";
import type { EventDefinition } from "../domain/screen-definition.ts";
import {
	eventDefinitionSchema,
	isEmittableBindingExpression,
	type ScreenNode,
	walkNodes,
} from "../domain/screen-definition.ts";
import {
	isSyntheticComponentId,
	isSyntheticManifest,
} from "../domain/synthetics.ts";
import { RESERVED_PROP_NAMES } from "../domain/validator.ts";

// Converts a Screen Definition tree into Storybook CSF (Component Story Format)
// source. The output is a ".stories.tsx" file that can be dropped straight into
// the host's Storybook — Yosegi has no rendering environment of its own. This is
// pure string generation with no dependency on React.

const DEFAULT_STORY_NAME = "Default";
const DEFAULT_FRAMEWORK_PACKAGE = "@storybook/react";
// The className emitted by the synthetic Heading primitive. Ordered the way
// Tailwind recommends (the order lints like useSortedClasses expect). Exported
// so the reader of a Story can also use it to detect "is this an h1 Yosegi wrote".
export const SYNTHETIC_HEADING_CLASS_NAME = "font-bold text-2xl tracking-tight";
// Marker for the comment that carries bindings / events forward. Shared with the reader.
export const INTENT_COMMENT_PREFIX = "TODO(yosegi):";
// Name of the JSX children slot. Every other Slot is passed as an attribute.
const CHILDREN_SLOT = "children";
// Props that are never emitted as JSX attributes. children is a Slot; key/ref are
// reserved by React. The set lives in the validator (which rejects values written
// under these names as RESERVED_PROP) so the two sides can't drift apart.
const RESERVED_PROPS = RESERVED_PROP_NAMES;
// Extensions stripped from the import specifier, restoring the form the host's bundler resolves.
const IMPORT_EXTENSION_PATTERN = /\.(tsx|ts|jsx|js)$/;
// In a Registry without componentPath, the story file's path ends up in packageName.
const STORY_SUFFIX_PATTERN = /\.stories$/;
// Characters that can't be written as raw JSX text; when present, escape into an
// expression container instead. Newlines are included because JSX collapses raw
// text newlines into a single space, which would change the value on read-back.
const JSX_UNSAFE_TEXT_PATTERN = /[{}<>\r\n]/;
// Characters that can't be left inside a double-quoted JSX attribute value.
const JSX_UNSAFE_ATTRIBUTE_PATTERN = /["\r\n]/;
// A form that can be written as-is in an identifier position (a Story's export name, an import's local name).
const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Mocks have no handler implementation. The "do nothing" value placed on a required function prop.
const NOOP_HANDLER = "() => {}";

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

	return (packageName) => {
		const rule = rules.find((r) => packageName.startsWith(r.from));
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

type RenderContext = {
	manifests: Map<string, ComponentManifest>;
	// Component id -> the local name used in JSX.
	localNames: Map<string, string>;
};

function indent(line: string): string {
	return `\t${line}`;
}

// An id that's neither in the Registry nor a synthetic primitive can't be
// generated. Callers are expected to run validateScreen beforehand, but this
// fails explicitly here too as a second safety net.
function requireRenderable(
	node: ScreenNode,
	manifests: Map<string, ComponentManifest>,
): ComponentManifest | null {
	const manifest = manifests.get(node.component) ?? null;
	if (!manifest && !isSyntheticComponentId(node.component)) {
		throw new Error(
			`Component "${node.component}" (node "${node.id}") is not registered.`,
		);
	}
	return manifest;
}

function isSynthetic(
	node: ScreenNode,
	manifest: ComponentManifest | null,
): boolean {
	return manifest
		? isSyntheticManifest(manifest)
		: isSyntheticComponentId(node.component);
}

// Walks the tree to decide import statements and local names. Local-name collisions are resolved with a "Name2" suffix.
//
// Unregistered ids are silently skipped here. Deciding whether generation is
// impossible is left to the rendering side (requireRenderable), so callers like the
// implementation context — which want the rest returned even when some ids are
// unregistered — can still go through.
export function planImports(
	root: ScreenNode,
	registry: ComponentRegistry,
	resolveImport?: (packageName: string) => string,
): ImportPlan {
	const manifests = indexRegistry(registry);
	const specifiers = new Map<string, ImportBinding[]>();
	const localNames = new Map<string, string>();
	const usedLocalNames = new Set<string>();

	for (const node of walkNodes(root)) {
		const manifest = manifests.get(node.component) ?? null;
		if (!manifest || isSynthetic(node, manifest)) {
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
		if (!JS_IDENTIFIER_PATTERN.test(exportName)) {
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
		let localName = exportName;
		for (let suffix = 2; usedLocalNames.has(localName); suffix += 1) {
			localName = `${exportName}${suffix}`;
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

// Reduces a string to a JSX attribute value. When it contains double quotes or
// newlines, escape into an expression container + JSON literal so the literal can't
// be closed early. Attributes written by synthetic primitives (Box's className,
// etc.) always go through this function too.
function stringAttribute(name: string, value: string): string {
	return JSX_UNSAFE_ATTRIBUTE_PATTERN.test(value)
		? `${name}={${JSON.stringify(value)}}`
		: `${name}="${value}"`;
}

function serializeProp(name: string, value: unknown): string | null {
	if (typeof value === "string") {
		return stringAttribute(name, value);
	}
	if (typeof value === "number") {
		return `${name}={${value}}`;
	}
	if (typeof value === "boolean") {
		return value ? name : `${name}={false}`;
	}
	if (value === null || typeof value === "object") {
		return `${name}={${JSON.stringify(value)}}`;
	}
	// function / undefined / symbol can't be reduced to Story source, so they aren't emitted.
	return null;
}

// The expression placed on a required prop that's only declared via bindings / events.
//
// bindings / events are a declaration of "wire it up like this at implementation
// time" — they don't carry a value. Dropping a valueless prop from the output is
// harmless when it's optional, but when it's required the generated code fails
// tsc and breaks in Storybook too (the prop vanishes entirely, e.g. `<DataTable />`).
// For required props only, we place the smallest expression we can build from the
// declaration, just so the prop never disappears outright. The intent itself is
// carried by the TODO comment.
function requiredPropExpression(
	node: ScreenNode,
	def: PropDefinition | undefined,
	propName: string,
): string | null {
	if (def?.required !== true) {
		return null;
	}
	// Handlers have no implementation in a mock, so fill with a no-op function. Nothing
	// happening when it's triggered is correct behavior for a mock, and it type-checks
	// in a handler position too.
	if (def.kind === "function") {
		return NOOP_HANDLER;
	}
	const expression = Object.hasOwn(node.bindings ?? {}, propName)
		? node.bindings?.[propName]
		: undefined;
	if (expression === undefined || !isEmittableBindingExpression(expression)) {
		return null;
	}
	// The identifier doesn't exist inside the Story, so this Story won't pass type
	// checking. There's no way to fill a required prop with no data in a mock, and
	// failing loudly by naming "this prop is needed" is easier to fix than dropping it
	// and breaking silently. The validator warns about the same thing before generation.
	return expression;
}

function stringProp(node: ScreenNode, name: string): string {
	const value = node.props[name];
	return typeof value === "string" ? value : "";
}

// Written as-is when it's safe as raw text, otherwise escaped into an expression
// container. forceContainer exists to keep adjacent text nodes from fusing into one
// on read-back.
function renderText(text: string, forceContainer = false): string {
	if (
		forceContainer ||
		text === "" ||
		JSX_UNSAFE_TEXT_PATTERN.test(text) ||
		text !== text.trim()
	) {
		return `{${JSON.stringify(text)}}`;
	}
	return text;
}

// The contents of the comment that carries bindings / events / when / each forward.
export type NodeIntent = {
	bindings: Record<string, string>;
	events: Record<string, EventDefinition>;
	// Conditional-display / repetition declaration. null on nodes that don't have one.
	when: string | null;
	each: string | null;
};

const intentPayloadSchema = z.object({
	bindings: z.record(z.string(), z.string()).optional(),
	events: z.record(z.string(), eventDefinitionSchema).optional(),
	when: z.string().optional(),
	each: z.string().optional(),
});

// The shape written out. Items that aren't present drop the key entirely, so this uses optional rather than null.
export type NodeIntentPayload = z.infer<typeof intentPayloadSchema>;

// Writes the intent down as JSON. A format built around chosen delimiter characters
// breaks on read-back the moment the same character (`/`, `,`, `←`, etc.) shows up
// on the expression or argument side. With JSON, quotes close the string boundary,
// so any value can be restored as-is. `*/` alone would terminate the comment, so it's
// escaped to `*\/` (in JSON, `\/` is equivalent to `/`, so the reader just needs to
// call JSON.parse).
export function encodeIntent(intent: NodeIntentPayload): string {
	return JSON.stringify(intent).replaceAll("*/", "*\\/");
}

// The inverse of encodeIntent. Anything with the wrong shape becomes null (callers treat that as "not an intent").
export function decodeIntent(encoded: string): NodeIntent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(encoded);
	} catch {
		return null;
	}
	const result = intentPayloadSchema.safeParse(parsed);
	if (!result.success) {
		return null;
	}
	return {
		bindings: result.data.bindings ?? {},
		events: result.data.events ?? {},
		when: result.data.when ?? null,
		each: result.data.each ?? null,
	};
}

// bindings / events / when / each are declarative intent with no implementation
// code behind them. Left as a TODO comment so implementers can pick them up.
//
// when / each are conditional and repetition declarations that have no matching
// JSX in a mock (repetition is expressed by laying out however many nodes you want
// shown). They still get put in the comment — if the declaration disappeared from
// the generated output, it would be lost both when the Story is read back and when
// it's handed off to implementation.
function intentComment(node: ScreenNode): string | null {
	const intent: NodeIntentPayload = {};
	if (Object.keys(node.bindings ?? {}).length > 0) {
		intent.bindings = node.bindings;
	}
	if (Object.keys(node.events ?? {}).length > 0) {
		intent.events = node.events;
	}
	if (node.when !== undefined) {
		intent.when = node.when;
	}
	if (node.each !== undefined) {
		intent.each = node.each;
	}
	if (Object.keys(intent).length === 0) {
		return null;
	}
	return `{/* ${INTENT_COMMENT_PREFIX} ${encodeIntent(intent)} */}`;
}

// If even one attribute spans multiple lines, stack everything vertically (avoid mixing single-line and stacked forms).
function renderTag(
	tagName: string,
	attributes: string[][],
	childrenLines: string[],
): string[] {
	const selfClosing = childrenLines.length === 0;
	const lines: string[] = [];
	if (attributes.length === 0) {
		lines.push(selfClosing ? `<${tagName} />` : `<${tagName}>`);
	} else if (attributes.every((attribute) => attribute.length === 1)) {
		const inline = attributes.map((attribute) => attribute[0]).join(" ");
		lines.push(
			selfClosing ? `<${tagName} ${inline} />` : `<${tagName} ${inline}>`,
		);
	} else {
		lines.push(`<${tagName}`);
		for (const attribute of attributes) {
			lines.push(...attribute.map(indent));
		}
		lines.push(selfClosing ? "/>" : ">");
	}
	if (!selfClosing) {
		// If the opening tag is one line and the child is a single line of text, collapse
		// onto one line, matching JSX a person would write. Element children (starting with
		// "<") are never collapsed.
		const isTextOnlyChild =
			childrenLines.length === 1 && !childrenLines[0].startsWith("<");
		if (lines.length === 1 && isTextOnlyChild) {
			return [`${lines[0]}${childrenLines[0]}</${tagName}>`];
		}
		lines.push(...childrenLines.map(indent));
		lines.push(`</${tagName}>`);
	}
	return lines;
}

function renderFragment(lines: string[]): string[] {
	return ["<>", ...lines.map(indent), "</>"];
}

// The rendering result. The type distinguishes a JSX element from raw text that can
// only be placed in a children position. In positions that require an "expression"
// — an attribute value, a render return value — text isn't valid syntax on its own
// and must always be wrapped, so this keeps callers from mixing the two up.
type RenderedNode =
	| { kind: "element"; lines: string[] }
	| { kind: "text"; text: string };

// Lines to place in a children position.
function asChildLines(
	rendered: RenderedNode,
	forceContainer: boolean,
): string[] {
	return rendered.kind === "text"
		? [renderText(rendered.text, forceContainer)]
		: rendered.lines;
}

// Lines to place in a position that requires an expression. Text alone isn't an expression, so it's wrapped in a Fragment.
function asExpressionLines(rendered: RenderedNode): string[] {
	return rendered.kind === "text"
		? [`<>${renderText(rendered.text)}</>`]
		: rendered.lines;
}

function isTextNode(node: ScreenNode | undefined): boolean {
	return node?.component === "Text";
}

// The form used as JSX children (intent comment + element).
function renderChild(
	node: ScreenNode,
	context: RenderContext,
	forceTextContainer = false,
): string[] {
	const comment = intentComment(node);
	const lines = asChildLines(renderNode(node, context), forceTextContainer);
	return comment ? [comment, ...lines] : lines;
}

// Renders a sequence of child elements. Adjacent raw text would fuse into one text
// node on read-back, so only spots where text nodes are adjacent get an expression
// container to preserve the boundary.
function renderChildren(
	children: ScreenNode[],
	context: RenderContext,
): string[] {
	return children.flatMap((child, index) =>
		renderChild(
			child,
			context,
			isTextNode(child) &&
				(isTextNode(children[index - 1]) || isTextNode(children[index + 1])),
		),
	);
}

// A named Slot becomes an attribute value. An expression container can hold only
// one expression, so when there are multiple children or an intent comment is
// attached, wrap them in a Fragment.
function renderSlotAttribute(
	slotName: string,
	children: ScreenNode[],
	context: RenderContext,
): string[] {
	const needsFragment =
		children.length > 1 || intentComment(children[0]) !== null;
	const value = needsFragment
		? renderFragment(renderChildren(children, context))
		: asExpressionLines(renderNode(children[0], context));
	if (value.length === 1) {
		return [`${slotName}={${value[0]}}`];
	}
	return [`${slotName}={`, ...value.map(indent), "}"];
}

function renderSynthetic(
	node: ScreenNode,
	context: RenderContext,
): RenderedNode {
	switch (node.component) {
		case "Text":
			return { kind: "text", text: stringProp(node, "text") };
		case "Heading":
			return {
				kind: "element",
				lines: [
					`<h1 ${stringAttribute("className", SYNTHETIC_HEADING_CLASS_NAME)}>${renderText(stringProp(node, "text"))}</h1>`,
				],
			};
		case "Box": {
			const className = stringProp(node, "className");
			const attributes =
				className === "" ? [] : [[stringAttribute("className", className)]];
			const children = renderChildren(node.slots[CHILDREN_SLOT] ?? [], context);
			return { kind: "element", lines: renderTag("div", attributes, children) };
		}
		default:
			throw new Error(
				`Component "${node.component}" (node "${node.id}") is marked synthetic but has no renderer.`,
			);
	}
}

function renderNode(node: ScreenNode, context: RenderContext): RenderedNode {
	const manifest = requireRenderable(node, context.manifests);
	if (isSynthetic(node, manifest)) {
		return renderSynthetic(node, context);
	}
	const localName = context.localNames.get(node.component);
	if (!localName) {
		throw new Error(
			`Component "${node.component}" (node "${node.id}") has no import binding.`,
		);
	}

	const attributes: string[][] = [];
	for (const [propName, value] of Object.entries(node.props)) {
		if (RESERVED_PROPS.has(propName)) {
			continue;
		}
		const attribute = serializeProp(propName, value);
		if (attribute) {
			attributes.push([attribute]);
		}
	}
	// A prop that appears only in bindings / events without ever carrying a value. Only required ones get filled in.
	const declaredPropNames = new Set([
		...Object.keys(node.bindings ?? {}),
		...Object.keys(node.events ?? {}),
	]);
	for (const propName of declaredPropNames) {
		if (RESERVED_PROPS.has(propName) || Object.hasOwn(node.props, propName)) {
			continue;
		}
		// Guarded with hasOwn: a plain bracket lookup keyed by a screen-supplied name
		// walks the prototype chain, so a prop named "toString" would look defined.
		const expression = requiredPropExpression(
			node,
			manifest && Object.hasOwn(manifest.props, propName)
				? manifest.props[propName]
				: undefined,
			propName,
		);
		if (expression !== null) {
			attributes.push([`${propName}={${expression}}`]);
		}
	}
	for (const [slotName, children] of Object.entries(node.slots)) {
		if (slotName === CHILDREN_SLOT || children.length === 0) {
			continue;
		}
		attributes.push(renderSlotAttribute(slotName, children, context));
	}

	const childrenLines = renderChildren(
		node.slots[CHILDREN_SLOT] ?? [],
		context,
	);
	return {
		kind: "element",
		lines: renderTag(localName, attributes, childrenLines),
	};
}

// An intent comment can't be prefixed onto the root (it would put two expressions
// side by side in the expression container), so only when there's a comment do we
// wrap in a Fragment to avoid losing the information.
function renderRoot(root: ScreenNode, context: RenderContext): string[] {
	const comment = intentComment(root);
	const rendered = renderNode(root, context);
	if (!comment) {
		return asExpressionLines(rendered);
	}
	return renderFragment([comment, ...asChildLines(rendered, false)]);
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
	const plan = planImports(root, registry, options.resolveImport);
	const context: RenderContext = { manifests, localNames: plan.localNames };
	// The Story name becomes the export's identifier. Since arbitrary strings can
	// arrive from the CLI / MCP, only accept a form that's writable as an identifier
	// (otherwise arbitrary code could get mixed into the generated output).
	const storyName = options.storyName ?? DEFAULT_STORY_NAME;
	if (!JS_IDENTIFIER_PATTERN.test(storyName)) {
		throw new Error(
			`Story name "${storyName}" is not a valid JavaScript identifier. Use letters, digits, "_" or "$", and do not start with a digit.`,
		);
	}

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
		`export const ${storyName}: StoryObj = {`,
		"\trender: () => (",
		...renderRoot(root, context).map((line) => `\t\t${line}`),
		"\t),",
		"};",
	);
	return `${lines.join("\n")}\n`;
}
