import type {
	ComponentRegistry,
	EventDefinition,
	ScreenNode,
} from "@yosegi/core";
import { bindingRootIdentifier } from "@yosegi/core";
import {
	decodeIntent,
	INTENT_COMMENT_PREFIX,
	normalizeImportSpecifier,
	resolveComponentSpecifier,
	SYNTHETIC_HEADING_CLASS_NAME,
} from "@yosegi/core/emit";
import * as ts from "typescript";

// Story importer: reads `.stories.tsx` source and converts it back into a Screen Definition tree.
//
// This runs the upstream direction (Screen JSON -> Story) in reverse, and serves as the entry
// point to the downstream direction (Story -> implementation). When turning an assembled mock
// Story into a real page, being able to convert what's currently laid out on the screen back
// into a machine-readable form means the implementation context (import statements, props in
// use, wiring tasks) can be pulled straight from it.
//
// Parsing works from the source AST alone and never evaluates React, since this needs to run
// from the CLI, and running a Story would require the host's whole Storybook environment
// (bundler / CSS / provider). The tradeoff is that syntax whose shape is only determined by
// running it (map / conditionals / variable references) can't be read. Anything unreadable is
// recorded as "opaque" in warnings, and whatever could be read is still returned — nothing gets
// dropped wholesale.

// The primary target is a Story written by emitCsf, for which the round trip is exact.
// Hand-written or hand-edited Stories are accepted on a best-effort basis.

const CHILDREN_SLOT = "children";
// Inline elements that collapse into Text when their content is text-only. A relaxation to accept hand-written Stories.
const INLINE_TEXT_TAGS = new Set([
	"span",
	"p",
	"label",
	"strong",
	"em",
	"small",
	"b",
	"i",
]);
// Heading tags read back as the synthetic primitive Heading.
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
// A plain div is the synthetic primitive Box.
const BOX_TAG = "div";
// Extracts the comment body from a JSX expression container that holds nothing but a comment (`{/* ... */}`).
const JSX_COMMENT_PATTERN = /^\{\s*\/\*([\s\S]*?)\*\/\s*\}$/;
// A single entry (`onRowClick→navigate {"to":"/x"}`) written under `events:` in the legacy
// format (an intent comment assembled with delimiter characters).
const LEGACY_EVENT_PATTERN = /^(.+?)→([^\s]+)(?:\s+([\s\S]+))?$/;
const LEGACY_BINDING_SEPARATOR = "←";
const LEGACY_SECTION_SEPARATOR = " / ";
const LEGACY_BINDINGS_SECTION = "bindings:";
const LEGACY_EVENTS_SECTION = "events:";

export type StoryImportWarningCode =
	// Couldn't read meta.title statically.
	| "TITLE_NOT_STATIC"
	// No Story with a render was found.
	| "STORY_NOT_FOUND"
	// render doesn't directly return JSX (goes through a variable, a conditional, etc.).
	| "RENDER_NOT_STATIC"
	// Couldn't resolve the JSX tag name to a Registry component id.
	| "COMPONENT_NOT_RESOLVED"
	// Multiple candidates existed and none could be chosen.
	| "COMPONENT_AMBIGUOUS"
	// The export name matches, but the import path disagrees with the Registry.
	| "IMPORT_PATH_MISMATCH"
	// An expression (map / conditional / variable reference, etc.) can't be read statically.
	| "OPAQUE_EXPRESSION"
	// A prop's value can't be read statically.
	| "OPAQUE_PROP"
	// An uninterpretable element (e.g. a DOM tag with no corresponding synthetic primitive).
	| "OPAQUE_ELEMENT"
	// {...props} can't be expanded.
	| "SPREAD_ATTRIBUTE"
	// An intent comment had no single element to attach to (e.g. it preceded a
	// Fragment that expanded into several nodes), so the declaration was dropped.
	| "INTENT_NOT_APPLIED"
	// A top-level const whose initializer is not a JSON literal, so it could not
	// be read back as a fixture.
	| "OPAQUE_FIXTURE"
	// Multiple roots existed, so they were wrapped in a Box.
	| "MULTIPLE_ROOTS"
	// The file exports more Stories than the one that was imported (a variants
	// file, typically). Import reads one export per run; the others are named so
	// they are not dropped in silence.
	| "MULTIPLE_STORIES";

export type StoryImportWarning = {
	code: StoryImportWarningCode;
	message: string;
	// The corresponding ScreenNode's id, if one could be created.
	nodeId: string | null;
	// Position in the source (1-indexed).
	line: number | null;
};

export type ImportedBinding = {
	specifier: string;
	// "default" for `import X from`.
	exportName: string;
	localName: string;
	// The Registry component id this was matched to. null if it couldn't be resolved.
	componentId: string | null;
};

export type ImportedStory = {
	// meta.title. null if it couldn't be read.
	title: string | null;
	// The export name of the imported Story.
	storyName: string | null;
	// The reconstructed tree. null if the JSX couldn't be read.
	root: ScreenNode | null;
	// Top-level consts read back as the screen's fixtures, in source order. Empty
	// when the Story declares none.
	fixtures: Record<string, unknown>;
	imports: ImportedBinding[];
	warnings: StoryImportWarning[];
};

export type ImportStoryOptions = {
	source: string;
	// For diagnostic messages only. Not used to resolve the AST.
	fileName?: string;
	registry: ComponentRegistry;
	// Converts a Registry packageName into the host's import specifier (same direction and same
	// setting as emit). The converted value is what gets matched against the Story's import statements.
	resolveImport?: (packageName: string) => string;
	// The export name of the Story to import. Defaults to the first export with a render, if unspecified.
	storyName?: string;
};

type ImportContext = {
	sourceFile: ts.SourceFile;
	// Local name -> import binding. Used to look up a component id from a JSX tag name.
	importsByLocalName: Map<string, ImportedBinding>;
	warnings: StoryImportWarning[];
	// Builds node ids using a counter per component id.
	counters: Map<string, number>;
	// Fixtures already collected from the file's top-level consts. An attribute
	// expression whose head names one of these reads back as a binding rather than
	// an opaque prop.
	fixtures: Record<string, unknown>;
};

// ---- Static evaluation ----

type Evaluated = { ok: true; value: unknown } | { ok: false };

const FAILED: Evaluated = { ok: false };

// Folds literals only. Identifiers, function calls, and template interpolations are treated as unreadable values.
function evaluate(expression: ts.Expression): Evaluated {
	if (ts.isStringLiteral(expression)) {
		return { ok: true, value: expression.text };
	}
	if (ts.isNoSubstitutionTemplateLiteral(expression)) {
		return { ok: true, value: expression.text };
	}
	if (ts.isNumericLiteral(expression)) {
		return { ok: true, value: Number(expression.text) };
	}
	if (expression.kind === ts.SyntaxKind.TrueKeyword) {
		return { ok: true, value: true };
	}
	if (expression.kind === ts.SyntaxKind.FalseKeyword) {
		return { ok: true, value: false };
	}
	if (expression.kind === ts.SyntaxKind.NullKeyword) {
		return { ok: true, value: null };
	}
	if (
		ts.isPrefixUnaryExpression(expression) &&
		expression.operator === ts.SyntaxKind.MinusToken
	) {
		const operand = evaluate(expression.operand);
		return operand.ok && typeof operand.value === "number"
			? { ok: true, value: -operand.value }
			: FAILED;
	}
	if (ts.isParenthesizedExpression(expression)) {
		return evaluate(expression.expression);
	}
	if (ts.isArrayLiteralExpression(expression)) {
		const values: unknown[] = [];
		for (const element of expression.elements) {
			const evaluated = evaluate(element);
			if (!evaluated.ok) {
				return FAILED;
			}
			values.push(evaluated.value);
		}
		return { ok: true, value: values };
	}
	if (ts.isObjectLiteralExpression(expression)) {
		const value: Record<string, unknown> = {};
		for (const property of expression.properties) {
			if (!ts.isPropertyAssignment(property)) {
				return FAILED;
			}
			const key = propertyName(property.name);
			const evaluated = evaluate(property.initializer);
			if (key === null || !evaluated.ok) {
				return FAILED;
			}
			value[key] = evaluated.value;
		}
		return { ok: true, value };
	}
	return FAILED;
}

function propertyName(name: ts.PropertyName): string | null {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
		return name.text;
	}
	return null;
}

// ---- Import parsing and Registry matching ----

function collectImports(sourceFile: ts.SourceFile): ImportedBinding[] {
	const bindings: ImportedBinding[] = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !statement.importClause) {
			continue;
		}
		// `import type { Meta }` isn't a building block.
		if (statement.importClause.isTypeOnly) {
			continue;
		}
		if (!ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const specifier = statement.moduleSpecifier.text;
		const clause = statement.importClause;
		if (clause.name) {
			bindings.push({
				specifier,
				exportName: "default",
				localName: clause.name.text,
				componentId: null,
			});
		}
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) {
				if (element.isTypeOnly) {
					continue;
				}
				bindings.push({
					specifier,
					exportName: (element.propertyName ?? element.name).text,
					localName: element.name.text,
					componentId: null,
				});
			}
		}
	}
	return bindings;
}

function pathSegments(specifier: string): string[] {
	return normalizeImportSpecifier(specifier)
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== ".");
}

// The number of path segments that match from the end. Matches specifiers whose beginnings
// diverge — like an alias (`~/components/...`) versus a project-relative path
// (`./app/components/...`) — by how much they overlap at the tail.
function suffixScore(a: string[], b: string[]): number {
	let matched = 0;
	while (
		matched < a.length &&
		matched < b.length &&
		a[a.length - 1 - matched] === b[b.length - 1 - matched]
	) {
		matched += 1;
	}
	return matched;
}

type Resolution =
	| { kind: "resolved"; componentId: string; pathMismatch: boolean }
	| { kind: "not-found" }
	| { kind: "ambiguous"; candidates: string[] };

// Looks up a Registry component id from an import statement (specifier + export name).
function resolveComponentId(
	binding: ImportedBinding,
	registry: ComponentRegistry,
	resolveImport: ((packageName: string) => string) | undefined,
): Resolution {
	// A default export's Manifest has its declared name (`ContentCard`) as exportName, but the
	// name seen from the module side is "default". That's what gets matched against the import statement.
	const candidates = registry.components.filter(
		(component) =>
			(component.import.kind === "default"
				? "default"
				: component.import.exportName) === binding.exportName,
	);
	if (candidates.length === 0) {
		return { kind: "not-found" };
	}
	const target = pathSegments(binding.specifier);
	const scored = candidates.map((component) => ({
		component,
		score: suffixScore(
			pathSegments(resolveComponentSpecifier(component, resolveImport)),
			target,
		),
	}));
	const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
	const winners = scored.filter((entry) => entry.score === best);
	if (winners.length > 1) {
		return {
			kind: "ambiguous",
			candidates: winners.map((entry) => entry.component.id),
		};
	}
	return {
		kind: "resolved",
		componentId: winners[0].component.id,
		// No path segments overlap at all = the ledger may be stale, or this may point to something else entirely.
		pathMismatch: best === 0,
	};
}

// ---- Reconstructing intent comments (bindings / events) ----

type Intent = {
	bindings: Record<string, string>;
	events: Record<string, EventDefinition>;
	when: string | null;
	each: string | null;
};

// Reads a section of `prop←expression` entries. When an expression contains a comma (`f(a, b)`),
// it would otherwise get split at the separator, so any fragment without a `←` is reattached to the previous entry.
function parseLegacyBindings(section: string): Record<string, string> {
	const bindings: Record<string, string> = {};
	const entries: string[] = [];
	for (const chunk of section.split(", ")) {
		if (chunk.includes(LEGACY_BINDING_SEPARATOR) || entries.length === 0) {
			entries.push(chunk);
			continue;
		}
		entries[entries.length - 1] = `${entries.at(-1)}, ${chunk}`;
	}
	for (const entry of entries) {
		const separator = entry.indexOf(LEGACY_BINDING_SEPARATOR);
		if (separator === -1) {
			continue;
		}
		const prop = entry.slice(0, separator).trim();
		const expression = entry.slice(separator + 1).trim();
		if (prop.length > 0 && expression.length > 0) {
			bindings[prop] = expression;
		}
	}
	return bindings;
}

function parseEventArguments(raw: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

// Reads a section of `onRowClick→navigate {"to":"/x"}` entries. Since the argument JSON contains
// commas, any fragment without a `→` is reattached to the previous entry.
function parseLegacyEvents(section: string): Record<string, EventDefinition> {
	const events: Record<string, EventDefinition> = {};
	const entries: string[] = [];
	for (const chunk of section.split(", ")) {
		if (chunk.includes("→") || entries.length === 0) {
			entries.push(chunk);
			continue;
		}
		entries[entries.length - 1] = `${entries.at(-1)}, ${chunk}`;
	}
	for (const entry of entries) {
		const matched = LEGACY_EVENT_PATTERN.exec(entry.trim());
		if (!matched) {
			// The legacy format without an action (name only). The declaration is lost, so unknown is used as a placeholder.
			const name = entry.trim();
			if (name.length > 0) {
				events[name] = { action: "unknown" };
			}
			continue;
		}
		const [, name, action, rawArguments] = matched;
		const args = rawArguments ? parseEventArguments(rawArguments) : null;
		events[name.trim()] = args ? { action, arguments: args } : { action };
	}
	return events;
}

// The legacy format assembled with delimiter characters (`bindings: a←x / events: onClick→go {...}`).
// The emit side moved to JSON because it broke whenever an expression itself contained a
// delimiter character, but the read side keeps accepting the old format so already-generated Stories can still be read back.
function parseLegacyIntent(rest: string): Intent {
	// The legacy format has no when / each (the emitter at the time didn't write them).
	const intent: Intent = { bindings: {}, events: {}, when: null, each: null };
	for (const section of rest.split(LEGACY_SECTION_SEPARATOR)) {
		const trimmed = section.trim();
		if (trimmed.startsWith(LEGACY_BINDINGS_SECTION)) {
			Object.assign(
				intent.bindings,
				parseLegacyBindings(
					trimmed.slice(LEGACY_BINDINGS_SECTION.length).trim(),
				),
			);
			continue;
		}
		if (trimmed.startsWith(LEGACY_EVENTS_SECTION)) {
			Object.assign(
				intent.events,
				parseLegacyEvents(trimmed.slice(LEGACY_EVENTS_SECTION.length).trim()),
			);
		}
	}
	return intent;
}

// Converts `{/* TODO(yosegi): {"bindings":{...},"events":{...}} */}` back into an Intent.
export function parseIntentComment(comment: string): Intent | null {
	const body = comment.trim();
	if (!body.startsWith(INTENT_COMMENT_PREFIX)) {
		return null;
	}
	const rest = body.slice(INTENT_COMMENT_PREFIX.length).trim();
	// The current format is a single JSON object. Anything else is read as the legacy format.
	return rest.startsWith("{") ? decodeIntent(rest) : parseLegacyIntent(rest);
}

function applyIntent(node: ScreenNode, intent: Intent): void {
	if (Object.keys(intent.bindings).length > 0) {
		node.bindings = { ...intent.bindings, ...node.bindings };
	}
	if (Object.keys(intent.events).length > 0) {
		node.events = { ...intent.events, ...node.events };
	}
	if (intent.when !== null) {
		node.when = intent.when;
	}
	if (intent.each !== null) {
		node.each = intent.each;
	}
}

// ---- JSX -> ScreenNode ----

function lineOf(context: ImportContext, node: ts.Node): number {
	return (
		context.sourceFile.getLineAndCharacterOfPosition(
			node.getStart(context.sourceFile),
		).line + 1
	);
}

function warn(
	context: ImportContext,
	code: StoryImportWarningCode,
	message: string,
	node: ts.Node | null,
	nodeId: string | null = null,
): void {
	context.warnings.push({
		code,
		message,
		nodeId,
		line: node ? lineOf(context, node) : null,
	});
}

// Builds a readable node id from a component id. `app/components/button#Button` -> `button-1`.
function nextNodeId(context: ImportContext, componentId: string): string {
	const exportName = componentId.split("#").at(-1) ?? componentId;
	const slug =
		exportName
			.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "node";
	const count = (context.counters.get(slug) ?? 0) + 1;
	context.counters.set(slug, count);
	return `${slug}-${count}`;
}

function makeNode(
	context: ImportContext,
	component: string,
	props: Record<string, unknown> = {},
	slots: Record<string, ScreenNode[]> = {},
): ScreenNode {
	return { id: nextNodeId(context, component), component, props, slots };
}

// Collapses text to match JSX text node semantics: drops leading/trailing blank lines, strips
// leading/trailing indentation per line, and joins with a single space.
function normalizeJsxText(raw: string): string {
	const lines = raw.split("\n");
	const trimmed = lines
		.map((line, index) =>
			index === 0 ? line.replace(/\s+$/, "") : line.trim(),
		)
		.filter((line, index) => !(index > 0 && line.length === 0));
	return trimmed.join(" ").trim();
}

function textNode(context: ImportContext, text: string): ScreenNode {
	return makeNode(context, "Text", { text });
}

// An attribute's value. One containing JSX is a Slot, one that reads statically
// is a prop, one referencing a fixture is a binding, and anything else is opaque.
type Attribute =
	| { kind: "prop"; name: string; value: unknown }
	| { kind: "slot"; name: string; children: ScreenNode[] }
	| { kind: "binding"; name: string; expression: string }
	| { kind: "opaque" };

function readAttribute(
	context: ImportContext,
	attribute: ts.JsxAttribute,
	// Bindings only exist on component elements. On an intrinsic tag the same
	// shape still falls through to OPAQUE_PROP, so nothing is dropped in silence.
	allowBindings: boolean,
): Attribute {
	const name = ts.isIdentifier(attribute.name)
		? attribute.name.text
		: attribute.name.getText(context.sourceFile);
	// A valueless attribute like `bold` is true.
	if (!attribute.initializer) {
		return { kind: "prop", name, value: true };
	}
	if (ts.isStringLiteral(attribute.initializer)) {
		return { kind: "prop", name, value: attribute.initializer.text };
	}
	if (!ts.isJsxExpression(attribute.initializer)) {
		warn(
			context,
			"OPAQUE_PROP",
			`Could not read the value of prop "${name}" statically: ${attribute.initializer.getText(context.sourceFile)}`,
			attribute,
		);
		return { kind: "opaque" };
	}
	const expression = attribute.initializer.expression;
	// `attr={}` has no value. React just passes undefined too, so it's dropped as a prop.
	if (!expression) {
		return { kind: "opaque" };
	}
	// If the attribute value is JSX, it's a named Slot — the inverse of emit writing a named Slot as an attribute.
	if (
		ts.isJsxElement(expression) ||
		ts.isJsxSelfClosingElement(expression) ||
		ts.isJsxFragment(expression)
	) {
		return { kind: "slot", name, children: convertJsx(context, expression) };
	}
	const evaluated = evaluate(expression);
	if (!evaluated.ok) {
		// The inverse of emit writing a fixture-backed binding as `prop={expression}`:
		// when the expression's head names a fixture this file declares, the value is
		// known to exist, so it reads back as the binding rather than an opaque prop.
		if (allowBindings) {
			const text = expression.getText(context.sourceFile);
			const head = bindingRootIdentifier(text);
			if (head !== null && Object.hasOwn(context.fixtures, head)) {
				return { kind: "binding", name, expression: text };
			}
		}
		warn(
			context,
			"OPAQUE_PROP",
			`Could not read the value of prop "${name}" statically: ${expression.getText(context.sourceFile)}`,
			attribute,
		);
		return { kind: "opaque" };
	}
	return { kind: "prop", name, value: evaluated.value };
}

type ElementParts = {
	tagName: string;
	props: Record<string, unknown>;
	slots: Record<string, ScreenNode[]>;
	bindings: Record<string, string>;
	children: ScreenNode[];
};

function readElement(
	context: ImportContext,
	element: ts.JsxElement | ts.JsxSelfClosingElement,
): ElementParts {
	const opening = ts.isJsxElement(element) ? element.openingElement : element;
	const tagName = opening.tagName.getText(context.sourceFile);
	const props: Record<string, unknown> = {};
	const slots: Record<string, ScreenNode[]> = {};
	const bindings: Record<string, string> = {};
	// A tag starting with a lowercase letter is a DOM element.
	const isComponent = !/^[a-z]/.test(tagName);
	for (const attribute of opening.attributes.properties) {
		if (ts.isJsxSpreadAttribute(attribute)) {
			warn(
				context,
				"SPREAD_ATTRIBUTE",
				`Spread attributes cannot be expanded: ${attribute.getText(context.sourceFile)}`,
				attribute,
			);
			continue;
		}
		const read = readAttribute(context, attribute, isComponent);
		if (read.kind === "prop") {
			props[read.name] = read.value;
		} else if (read.kind === "slot") {
			slots[read.name] = read.children;
		} else if (read.kind === "binding") {
			bindings[read.name] = read.expression;
		}
	}
	const children = ts.isJsxElement(element)
		? convertChildren(context, element.children)
		: [];
	return {
		tagName,
		props,
		slots,
		bindings,
		children,
	};
}

// Converts a DOM element back into a synthetic primitive. emit only ever writes div (Box) and
// h1 (Heading), but to accept hand-written Stories too, this also handles collapsing inline elements' text.
function convertIntrinsic(
	context: ImportContext,
	element: ts.JsxElement | ts.JsxSelfClosingElement,
	parts: ElementParts,
): ScreenNode[] {
	const className = parts.props.className;
	const boxProps = typeof className === "string" ? { className } : {};

	if (parts.tagName === BOX_TAG) {
		return [
			makeNode(
				context,
				"Box",
				boxProps,
				parts.children.length > 0 ? { children: parts.children } : {},
			),
		];
	}

	const onlyText =
		parts.children.length === 1 && parts.children[0].component === "Text"
			? String(parts.children[0].props.text ?? "")
			: null;

	if (HEADING_TAGS.has(parts.tagName) && onlyText !== null) {
		// For anything other than an h1 Yosegi itself wrote, the className ends up dropped, so this leaves a note about it.
		if (className !== undefined && className !== SYNTHETIC_HEADING_CLASS_NAME) {
			warn(
				context,
				"OPAQUE_ELEMENT",
				`Imported <${parts.tagName}> back as Heading, but its className cannot be preserved: ${String(className)}`,
				element,
			);
		}
		return [makeNode(context, "Heading", { text: onlyText })];
	}

	if (INLINE_TEXT_TAGS.has(parts.tagName) && onlyText !== null) {
		return [textNode(context, onlyText)];
	}

	// A tag with no corresponding synthetic primitive. The structure and className are kept as a
	// Box, with a warning that the tag name is lost.
	warn(
		context,
		"OPAQUE_ELEMENT",
		`No synthetic primitive corresponds to <${parts.tagName}>, so it was imported back as Box`,
		element,
	);
	return [
		makeNode(
			context,
			"Box",
			boxProps,
			parts.children.length > 0 ? { children: parts.children } : {},
		),
	];
}

function convertComponent(
	context: ImportContext,
	element: ts.JsxElement | ts.JsxSelfClosingElement,
	parts: ElementParts,
): ScreenNode[] {
	const binding = context.importsByLocalName.get(parts.tagName);
	// Even when the lookup fails, a node is still created using the local name as-is. Returning it
	// with the structure preserved lets the later validate step surface COMPONENT_NOT_FOUND with
	// candidates so it can be fixed.
	const component = binding?.componentId ?? parts.tagName;
	if (!binding?.componentId) {
		warn(
			context,
			"COMPONENT_NOT_RESOLVED",
			`Could not resolve <${parts.tagName}> to a component id in the registry`,
			element,
		);
	}

	const slots: Record<string, ScreenNode[]> = { ...parts.slots };
	if (parts.children.length > 0) {
		slots[CHILDREN_SLOT] = parts.children;
	}
	const node = makeNode(context, component, parts.props, slots);
	if (Object.keys(parts.bindings).length > 0) {
		node.bindings = parts.bindings;
	}
	return [node];
}

// Converts a sequence of JSX children into a ScreenNode array. An intent comment is applied to the element right after it.
function convertChildren(
	context: ImportContext,
	children: readonly ts.JsxChild[],
): ScreenNode[] {
	const nodes: ScreenNode[] = [];
	let pendingIntent: Intent | null = null;

	for (const child of children) {
		// An expression container that holds nothing but a comment is a note carried over to the element right after it.
		if (ts.isJsxExpression(child) && child.expression === undefined) {
			pendingIntent = readJsxComment(context, child) ?? pendingIntent;
			continue;
		}
		const converted = convertJsx(context, child, pendingIntent);
		if (converted.length > 0) {
			pendingIntent = null;
		}
		nodes.push(...converted);
	}
	return nodes;
}

// Reads intent from an expression container that holds nothing but a comment. null if it isn't a Yosegi comment.
function readJsxComment(
	context: ImportContext,
	expression: ts.JsxExpression,
): Intent | null {
	const matched = JSX_COMMENT_PATTERN.exec(
		expression.getText(context.sourceFile).trim(),
	);
	return matched ? parseIntentComment(matched[1]) : null;
}

function convertExpression(
	context: ImportContext,
	child: ts.JsxExpression,
): ScreenNode[] {
	const expression = child.expression;
	if (!expression) {
		// An expression container that holds nothing but a comment. The caller (convertChildren) picks it up as intent.
		return [];
	}
	if (
		ts.isJsxElement(expression) ||
		ts.isJsxSelfClosingElement(expression) ||
		ts.isJsxFragment(expression)
	) {
		return convertJsx(context, expression);
	}
	const evaluated = evaluate(expression);
	if (
		evaluated.ok &&
		(typeof evaluated.value === "string" || typeof evaluated.value === "number")
	) {
		return [textNode(context, String(evaluated.value))];
	}
	warn(
		context,
		"OPAQUE_EXPRESSION",
		`Could not read the expression statically: ${expression.getText(context.sourceFile)}`,
		child,
	);
	return [];
}

// The conversion body, without intent handling. Split out so convertJsx can attach a
// pending intent uniformly to whatever a node — element, Fragment, text, expression —
// reconstructed into.
function convertJsxNodes(context: ImportContext, child: ts.Node): ScreenNode[] {
	if (ts.isJsxFragment(child)) {
		return convertChildren(context, child.children);
	}
	if (ts.isJsxExpression(child)) {
		return convertExpression(context, child);
	}
	if (ts.isJsxText(child)) {
		const text = normalizeJsxText(child.text);
		return text.length > 0 ? [textNode(context, text)] : [];
	}
	if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) {
		return [];
	}

	const parts = readElement(context, child);
	// A tag starting with a lowercase letter is a DOM element.
	return /^[a-z]/.test(parts.tagName)
		? convertIntrinsic(context, child, parts)
		: convertComponent(context, child, parts);
}

// Converts a single JSX node into a ScreenNode array (a Fragment expands into zero or more).
// A non-JSX node yields an empty array (the caller treats it as "couldn't be reconstructed").
function convertJsx(
	context: ImportContext,
	child: ts.Node,
	intent: Intent | null = null,
): ScreenNode[] {
	const nodes = convertJsxNodes(context, child);
	if (intent === null || nodes.length === 0) {
		return nodes;
	}
	// The comment sat directly before this node, so with exactly one reconstructed
	// element the intent's target is unambiguous — this also covers a Fragment or raw
	// text that collapsed into a single node. With several nodes there is no way to
	// pick one, and the file-top contract says nothing gets dropped in silence.
	if (nodes.length === 1) {
		applyIntent(nodes[0], intent);
		return nodes;
	}
	warn(
		context,
		"INTENT_NOT_APPLIED",
		`An intent comment preceded ${nodes.length} sibling nodes, so its bindings/events could not be attached to any of them`,
		child,
		nodes[0].id,
	);
	return nodes;
}

// ---- Extracting the Story ----

function objectProperty(
	object: ts.ObjectLiteralExpression,
	name: string,
): ts.Expression | null {
	for (const property of object.properties) {
		if (
			ts.isPropertyAssignment(property) &&
			propertyName(property.name) === name
		) {
			return property.initializer;
		}
	}
	return null;
}

// Looks at both `const meta: Meta = { title: "..." }` and `export default { title: ... }`.
function findMetaObject(
	sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | null {
	const objects = new Map<string, ts.ObjectLiteralExpression>();
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (
				ts.isIdentifier(declaration.name) &&
				declaration.initializer &&
				ts.isObjectLiteralExpression(declaration.initializer)
			) {
				objects.set(declaration.name.text, declaration.initializer);
			}
		}
	}
	for (const statement of sourceFile.statements) {
		if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
			continue;
		}
		if (ts.isObjectLiteralExpression(statement.expression)) {
			return statement.expression;
		}
		if (ts.isIdentifier(statement.expression)) {
			return objects.get(statement.expression.text) ?? null;
		}
	}
	return objects.get("meta") ?? null;
}

// ---- Fixtures (top-level consts) ----

// Method names that mutate their receiver in place. A call like
// `customers.push(...)` after `const customers = []` means the initializer is
// not the value the Story actually rendered with.
const MUTATING_METHOD_NAMES: ReadonlySet<string> = new Set([
	"push",
	"pop",
	"shift",
	"unshift",
	"splice",
	"sort",
	"reverse",
	"fill",
	"copyWithin",
]);

// The identifier a property / element access chain hangs off
// (`customers.items[0].name` -> "customers"). null when the chain does not
// bottom out in a plain identifier.
function rootIdentifierOfChain(expression: ts.Expression): string | null {
	let current: ts.Expression = expression;
	while (
		ts.isPropertyAccessExpression(current) ||
		ts.isElementAccessExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isParenthesizedExpression(current)
	) {
		current = current.expression;
	}
	return ts.isIdentifier(current) ? current.text : null;
}

// Best-effort scan for identifiers whose value is mutated after
// initialization. Snapshotting the initializer of such a const would re-emit a
// value the Story never rendered with, so those names are excluded from the
// fixtures. Detected: assignments (plain and compound) to a property or
// element of the identifier, `++` / `--`, `delete`, the known in-place array
// methods, and `Object.assign` with the identifier as target. Full mutation detection is
// statically impossible — a mutation through an alias
// (`const rows = customers; rows.push(...)`) or inside a helper the value is
// passed to still slips through — which matches the read-back contract:
// best-effort, with the host's review of the Story as the final check.
// Shadowing is not tracked either; a local variable sharing a fixture's name
// counts against it, which errs on the side of importing less.
function collectMutatedIdentifiers(sourceFile: ts.SourceFile): Set<string> {
	const mutated = new Set<string>();
	const add = (root: string | null): void => {
		if (root !== null) {
			mutated.add(root);
		}
	};
	const visit = (node: ts.Node): void => {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
			(ts.isPropertyAccessExpression(node.left) ||
				ts.isElementAccessExpression(node.left))
		) {
			add(rootIdentifierOfChain(node.left));
		} else if (ts.isDeleteExpression(node)) {
			add(rootIdentifierOfChain(node.expression));
		} else if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
			(node.operator === ts.SyntaxKind.PlusPlusToken ||
				node.operator === ts.SyntaxKind.MinusMinusToken)
		) {
			// `customers.count++` mutates just like `customers.count += 1`. A bare
			// `customers++` on a const is a runtime error, but flagging it too is
			// harmless — it only errs toward importing less.
			add(rootIdentifierOfChain(node.operand));
		} else if (ts.isCallExpression(node)) {
			const callee = node.expression;
			if (ts.isPropertyAccessExpression(callee)) {
				if (MUTATING_METHOD_NAMES.has(callee.name.text)) {
					add(rootIdentifierOfChain(callee.expression));
				} else if (
					callee.name.text === "assign" &&
					ts.isIdentifier(callee.expression) &&
					callee.expression.text === "Object"
				) {
					const target = node.arguments[0];
					if (target !== undefined) {
						add(rootIdentifierOfChain(target));
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return mutated;
}

// Reads top-level, non-exported variable declarations back as fixtures. emit
// writes them between the imports and meta, but the position is not enforced on
// read-back — a const's value does not depend on where it sits, and hand-edited
// Stories reorder freely. The meta object's own declaration is excluded by node
// identity, which also covers an export-default-referenced name that isn't
// called "meta".
function collectFixtures(
	context: ImportContext,
	meta: ts.ObjectLiteralExpression | null,
): Record<string, unknown> {
	const fixtures: Record<string, unknown> = {};
	const mutatedIdentifiers = collectMutatedIdentifiers(context.sourceFile);
	for (const statement of context.sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		// Story exports (and anything else exported) are not fixtures.
		const exported = statement.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		);
		if (exported) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (declaration.initializer === meta) {
				continue;
			}
			if (!ts.isIdentifier(declaration.name)) {
				warn(
					context,
					"OPAQUE_FIXTURE",
					`A destructuring declaration cannot be read as a fixture: ${declaration.getText(context.sourceFile)}`,
					declaration,
				);
				continue;
			}
			const name = declaration.name.text;
			// emit writes fixtures as consts, and a `let` / `var` declares intent to
			// reassign — a mutable top-level is Story machinery, not screen mock
			// data, so it is skipped rather than snapshotted at its initial value.
			if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
				const keyword =
					(statement.declarationList.flags & ts.NodeFlags.Let) === 0
						? "var"
						: "let";
				warn(
					context,
					"OPAQUE_FIXTURE",
					`Top-level "${name}" is declared with "${keyword}", so it was not imported as a fixture (only const declarations are)`,
					declaration,
				);
				continue;
			}
			const initializer = declaration.initializer;
			if (!initializer) {
				warn(
					context,
					"OPAQUE_FIXTURE",
					`Top-level "${name}" has no initializer, so it was not imported as a fixture`,
					declaration,
				);
				continue;
			}
			// A const whose value the module then mutates (`customers.push(...)`)
			// would be snapshotted at its initializer — a value the Story never
			// rendered with — so it is skipped instead.
			if (mutatedIdentifiers.has(name)) {
				warn(
					context,
					"OPAQUE_FIXTURE",
					`Top-level "${name}" is mutated after initialization, so it was not imported as a fixture (its initializer is not the rendered value)`,
					declaration,
				);
				continue;
			}
			const evaluated = evaluate(initializer);
			if (!evaluated.ok) {
				// The file-top contract: nothing gets dropped in silence. A helper const
				// (a function, a computed value) lands here on hand-written Stories.
				warn(
					context,
					"OPAQUE_FIXTURE",
					`Top-level "${name}" is not a JSON literal, so it was not imported as a fixture: ${initializer.getText(context.sourceFile)}`,
					declaration,
				);
				continue;
			}
			fixtures[name] = evaluated.value;
		}
	}
	return fixtures;
}

type StoryCandidate = {
	name: string;
	object: ts.ObjectLiteralExpression;
};

// Enumerates `export const Default: StoryObj = { ... }` declarations.
function findStories(sourceFile: ts.SourceFile): StoryCandidate[] {
	const stories: StoryCandidate[] = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		const exported = statement.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		);
		if (!exported) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (
				ts.isIdentifier(declaration.name) &&
				declaration.initializer &&
				ts.isObjectLiteralExpression(declaration.initializer)
			) {
				stories.push({
					name: declaration.name.text,
					object: declaration.initializer,
				});
			}
		}
	}
	return stories;
}

// Extracts JSX from a render's body. Accepts both `() => (<X />)` and `() => { return <X />; }`.
function renderBody(render: ts.Expression): ts.Expression | null {
	if (!ts.isArrowFunction(render) && !ts.isFunctionExpression(render)) {
		return null;
	}
	const body = render.body;
	if (!ts.isBlock(body)) {
		return body;
	}
	const statements = body.statements.filter(
		(statement) => !ts.isEmptyStatement(statement),
	);
	const last = statements.at(-1);
	if (statements.length !== 1 || !last || !ts.isReturnStatement(last)) {
		return null;
	}
	return last.expression ?? null;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
	return ts.isParenthesizedExpression(expression)
		? unwrapParentheses(expression.expression)
		: expression;
}

function selectStory(
	stories: StoryCandidate[],
	storyName: string | undefined,
): StoryCandidate | null {
	if (storyName !== undefined) {
		return stories.find((story) => story.name === storyName) ?? null;
	}
	return (
		stories.find((story) => objectProperty(story.object, "render") !== null) ??
		null
	);
}

// ---- Entry point ----

export function importStory(options: ImportStoryOptions): ImportedStory {
	const fileName = options.fileName ?? "story.stories.tsx";
	const sourceFile = ts.createSourceFile(
		fileName,
		options.source,
		ts.ScriptTarget.Latest,
		// Sets up parent links since getText / position info is used.
		true,
		ts.ScriptKind.TSX,
	);
	const warnings: StoryImportWarning[] = [];

	const bindings = collectImports(sourceFile);
	for (const binding of bindings) {
		const resolution = resolveComponentId(
			binding,
			options.registry,
			options.resolveImport,
		);
		if (resolution.kind === "resolved") {
			binding.componentId = resolution.componentId;
			if (resolution.pathMismatch) {
				warnings.push({
					code: "IMPORT_PATH_MISMATCH",
					message: `Resolved ${binding.localName} to ${resolution.componentId}, but its import specifier "${binding.specifier}" does not match the path in the registry`,
					nodeId: null,
					line: null,
				});
			}
			continue;
		}
		if (resolution.kind === "ambiguous") {
			warnings.push({
				code: "COMPONENT_AMBIGUOUS",
				message: `${binding.localName} ("${binding.specifier}") has more than one candidate: ${resolution.candidates.join(", ")}`,
				nodeId: null,
				line: null,
			});
		}
	}

	const context: ImportContext = {
		sourceFile,
		importsByLocalName: new Map(
			bindings.map((binding) => [binding.localName, binding]),
		),
		warnings,
		counters: new Map(),
		fixtures: {},
	};

	const meta = findMetaObject(sourceFile);
	const titleExpression = meta ? objectProperty(meta, "title") : null;
	let title: string | null = null;
	if (titleExpression) {
		const evaluated = evaluate(titleExpression);
		if (evaluated.ok && typeof evaluated.value === "string") {
			title = evaluated.value;
		} else {
			warn(
				context,
				"TITLE_NOT_STATIC",
				"Could not read meta.title statically",
				titleExpression,
			);
		}
	}

	// Collected before the JSX is converted, so attribute expressions can be
	// matched against the fixture names.
	const fixtures = collectFixtures(context, meta);
	context.fixtures = fixtures;

	const stories = findStories(sourceFile);
	const story = selectStory(stories, options.storyName);
	if (!story) {
		warn(
			context,
			"STORY_NOT_FOUND",
			options.storyName
				? `Story "${options.storyName}" was not found (candidates: ${stories.map((s) => s.name).join(", ") || "none"})`
				: "No Story with a render function was found",
			null,
		);
		return {
			title,
			storyName: null,
			root: null,
			fixtures,
			imports: bindings,
			warnings,
		};
	}

	// A file emitted with variants exports several Stories; only the selected one
	// is read back, and the diff cannot be reconstructed into `variants` (the
	// import sees applied trees, not operations). Naming the skipped exports
	// keeps the read-back contract — nothing gets dropped in silence.
	const otherStories = stories.filter(
		(candidate) =>
			candidate !== story &&
			objectProperty(candidate.object, "render") !== null,
	);
	if (otherStories.length > 0) {
		warn(
			context,
			"MULTIPLE_STORIES",
			`Imported Story "${story.name}" only; the file also exports ${otherStories
				.map((candidate) => `"${candidate.name}"`)
				.join(", ")}. Re-run with --story-name to read another export.`,
			otherStories[0].object,
		);
	}

	const render = objectProperty(story.object, "render");
	if (!render) {
		warn(
			context,
			"RENDER_NOT_STATIC",
			`Story "${story.name}" has no render (a Story with only args carries no structure)`,
			story.object,
		);
		return {
			title,
			storyName: story.name,
			root: null,
			fixtures,
			imports: bindings,
			warnings,
		};
	}

	const body = renderBody(render);
	if (!body) {
		warn(
			context,
			"RENDER_NOT_STATIC",
			`Could not extract JSX from the render of Story "${story.name}"`,
			render,
		);
		return {
			title,
			storyName: story.name,
			root: null,
			fixtures,
			imports: bindings,
			warnings,
		};
	}

	const nodes = convertJsx(context, unwrapParentheses(body));
	if (nodes.length === 0) {
		warn(
			context,
			"RENDER_NOT_STATIC",
			`Could not reconstruct any element from the render of Story "${story.name}"`,
			body,
		);
		return {
			title,
			storyName: story.name,
			root: null,
			fixtures,
			imports: bindings,
			warnings,
		};
	}

	// When there are multiple roots (siblings directly under a Fragment), they're bundled into a
	// Box. No className is added since the original Story doesn't have one.
	let root = nodes[0];
	if (nodes.length > 1) {
		root = makeNode(context, "Box", {}, { children: nodes });
		warn(
			context,
			"MULTIPLE_ROOTS",
			`Wrapped ${nodes.length} root elements in a Box`,
			body,
			root.id,
		);
	}

	return {
		title,
		storyName: story.name,
		root,
		fixtures,
		imports: bindings,
		warnings,
	};
}
