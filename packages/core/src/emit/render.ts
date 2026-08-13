import { z } from "zod";
import type {
	ComponentManifest,
	PropDefinition,
} from "../domain/component-manifest.ts";
import type { EventDefinition } from "../domain/screen-definition.ts";
import {
	bindingRootIdentifier,
	eventDefinitionSchema,
	isEmittableBindingExpression,
	type ScreenNode,
} from "../domain/screen-definition.ts";
import {
	isSyntheticComponentId,
	isSyntheticManifest,
} from "../domain/synthetics.ts";
import { RESERVED_PROP_NAMES } from "../domain/validator.ts";

// Renders a Screen Definition tree into JSX source lines. This is the target-independent
// half of emit: it knows how a tree becomes JSX (props, slots, synthetic primitives,
// intent comments) but nothing about the document that surrounds the JSX. The CSF
// emitter (csf.ts) wraps these lines in a Story file; a future component target can
// wrap the same lines in a component file without re-implementing the rendering.

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
// Characters that can't be written as raw JSX text; when present, escape into an
// expression container instead. Newlines are included because JSX collapses raw
// text newlines into a single space, which would change the value on read-back.
// "&" is included because JSX decodes HTML entities in raw text and attribute
// values — "&amp;" would render as "&", silently changing the value.
const JSX_UNSAFE_TEXT_PATTERN = /[{}<>\r\n&]/;
// Characters that can't be left inside a double-quoted JSX attribute value.
const JSX_UNSAFE_ATTRIBUTE_PATTERN = /["\r\n&]/;
// Mocks have no handler implementation. The "do nothing" value placed on a required function prop.
const NOOP_HANDLER = "() => {}";

export type RenderContext = {
	manifests: Map<string, ComponentManifest>;
	// Component id -> the local name used in JSX.
	localNames: Map<string, string>;
	// Fixture names this file declares as consts. A binding whose head is one of
	// these references a value that exists, so it can be written into the JSX.
	fixtureNames: ReadonlySet<string>;
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

// The expression placed on a prop that's only declared via bindings / events.
//
// bindings / events are a declaration of "wire it up like this at implementation
// time" — they don't carry a value. Dropping a valueless prop from the output is
// harmless when it's optional, but when it's required the generated code fails
// tsc and breaks in Storybook too (the prop vanishes entirely, e.g. `<DataTable />`).
// For required props only, we place the smallest expression we can build from the
// declaration, just so the prop never disappears outright. The intent itself is
// carried by the TODO comment.
//
// A binding whose head names a fixture is the exception to "required only": the
// const exists in this very file, so the expression is written regardless of
// requiredness — the point of a fixture is that the mock actually shows the data
// while the binding stays the implementation intent.
function declaredPropExpression(
	node: ScreenNode,
	def: PropDefinition | undefined,
	propName: string,
	fixtureNames: ReadonlySet<string>,
): string | null {
	// Handlers have no implementation in a mock, so a required one is filled with a
	// no-op function. Nothing happening when it's triggered is correct behavior for
	// a mock, and it type-checks in a handler position too. A fixture is JSON, so
	// it can never satisfy a handler position — the fixture path is skipped.
	if (def?.kind === "function") {
		return def.required === true ? NOOP_HANDLER : null;
	}
	const expression = Object.hasOwn(node.bindings ?? {}, propName)
		? node.bindings?.[propName]
		: undefined;
	if (expression === undefined || !isEmittableBindingExpression(expression)) {
		return null;
	}
	const head = bindingRootIdentifier(expression);
	if (head !== null && fixtureNames.has(head)) {
		return expression;
	}
	if (def?.required !== true) {
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
		const expression = declaredPropExpression(
			node,
			manifest && Object.hasOwn(manifest.props, propName)
				? manifest.props[propName]
				: undefined,
			propName,
			context.fixtureNames,
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
export function renderRoot(root: ScreenNode, context: RenderContext): string[] {
	const comment = intentComment(root);
	const rendered = renderNode(root, context);
	if (!comment) {
		return asExpressionLines(rendered);
	}
	return renderFragment([comment, ...asChildLines(rendered, false)]);
}
