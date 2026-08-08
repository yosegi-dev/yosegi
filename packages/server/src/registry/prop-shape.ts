import type { PropField, PropShape } from "@yosegi/core";
import * as ts from "typescript";

// Reads the "shape one level deep" of a prop that was rounded down to json, from its TypeScript type.
//
// react-docgen-typescript rounds any type that doesn't fit string / number / boolean /
// enum down to json, so all that's left in the Manifest is a name and not-editable.
// It's the agent that has to write that value at implementation time, so without a
// field name, type, whether it's required, and any JSDoc the host wrote, that prop ends
// up in an "we know it exists but can't write it" state.
//
// Expansion goes only one level deep. Nested objects stop at "object". Turning the
// Manifest into a copy of the type definition would make inspect impossible to read
// through, and if a deeper shape is actually needed, opening the host's source is faster anyway.

// Upper bound on how many fields are listed. Beyond this, only the remaining count is
// shown. Keeps even a third-party wrapper with 100+ props, like a chart component, from
// breaking a single inspect screen's width.
const FIELD_LIMIT = 12;
// Upper bound on a field description's length. JSDoc can span multiple lines, so it's collapsed to one line before being truncated.
const DESCRIPTION_LIMIT = 120;
// Upper bound on the length at which a structural type text (e.g. `"a" | "b"`) is used as-is.
// Beyond this it's rounded down to a category word (object / union / function).
const TYPE_TEXT_LIMIT = 40;
// Upper bound on the length a type name can have and still be adopted. A long name is
// still shown as-is (the agent can use it as a key to look up the type definition, and
// rounding it down to "object" would destroy that clue), but generated-code type names
// can grow without bound, so a cap is still needed as a safety net.
const TYPE_NAME_LIMIT = 80;
// The shape a type name must have to be adopted as a name. `SelectionState` and
// `RowModel<TRow>` are names; an anonymous object type (`{ a: string; }`) or a union is not.
const TYPE_NAME_PATTERN = /^[A-Za-z_$][\w$]*(<[\w$,.\s<>[\]|]*>)?$/;
// The undefined member left behind in a type's text. Since "can be omitted" is already
// expressed by the optional flag, it's dropped from the type text (`| null` is kept, since it's a writable value).
const UNDEFINED_UNION_PATTERN = /\s*\|\s*undefined\b|^undefined\s*\|\s*/g;
// Types declared in node_modules (including TypeScript's lib.*.d.ts).
const EXTERNAL_DECLARATION_PATTERN = /[\\/]node_modules[\\/]/;
// Recursion limit when building an array element's name. Guards against a self-reference like `type T = T[]` never terminating.
const MAX_ARRAY_DEPTH = 3;
// Upper bound on how many union members are listed. Protects a single inspect screen, for the same reason as fields.
const MEMBER_LIMIT = 20;
// Delimiter used to extract a package name. Everything after the last node_modules is that package's contents.
const NODE_MODULES_SEGMENT = "/node_modules/";
// TypeScript's standard library declaration files. They live under node_modules/typescript,
// but since they're not a package you install and look up, they aren't reported as a package name.
const TS_LIB_FILE_PATTERN = /^lib\..*\.d\.ts$/;

// Drops null / undefined from a union. Returns the union unchanged if the remainder
// doesn't resolve to exactly one type — the type alone can't tell us which branch to
// write, so picking one here would be a lie.
function stripNullish(type: ts.Type): ts.Type {
	if (!type.isUnion()) {
		return type;
	}
	const members = type.types.filter(
		(member) =>
			(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
	);
	return members.length === 1 ? members[0] : type;
}

// The element type, if this is an array. isArrayType checks both Array and
// ReadonlyArray, so `Foo[]` / `Array<Foo>` / `readonly Foo[]` are all treated the same.
// Tuples have a different type per element, so they're not collapsed into a single element type.
function elementType(type: ts.Type, checker: ts.TypeChecker): ts.Type | null {
	if (!checker.isArrayType(type)) {
		return null;
	}
	return checker.getTypeArguments(type as ts.TypeReference)[0] ?? null;
}

// Whether a type's text is usable as a name. An anonymous object type or a union is not.
function asTypeName(text: string): string | null {
	if (text.length > TYPE_NAME_LIMIT || !TYPE_NAME_PATTERN.test(text)) {
		return null;
	}
	return text;
}

// The name attached to a type. Picks up alias names (`type Foo = ...`) as well as interface / class declaration names.
function typeName(type: ts.Type, checker: ts.TypeChecker): string | null {
	return asTypeName(checker.typeToString(type));
}

// Drops the undefined member from a union. When the remainder doesn't resolve to a
// single type, the type is left as-is and dropped on the text side instead (UNDEFINED_UNION_PATTERN).
function stripUndefined(type: ts.Type): ts.Type {
	if (!type.isUnion()) {
		return type;
	}
	const members = type.types.filter(
		(member) => (member.flags & ts.TypeFlags.Undefined) === 0,
	);
	return members.length === 1 ? members[0] : type;
}

// Where a type is declared. If an alias (`type Foo = ...`) is attached, that takes priority.
function declarationsOf(type: ts.Type): ts.Declaration[] {
	return (type.aliasSymbol ?? type.getSymbol())?.getDeclarations() ?? [];
}

// Whether a type's declaration lives in the host's source.
//
// Third-party types (TanStack's Table, Radix's Props, etc.) get only their name shown
// and are never expanded. What we actually want to surface here is JSDoc the host
// wrote, and third-party types are often instance/config interfaces with a huge number
// of fields, where a 12-field cap barely means anything. As long as the name is known,
// the agent can look up that package's type definition itself.
//
// This only looks at the type's own (alias-first) declaration, not what a host alias
// might resolve to underneath — hostDeclarationRefs relies on exactly that: "is there a
// host file to point the reader at", which is true even when that file re-exports a
// third-party shape. The field-expansion decision needs a stricter question ("does this
// bottom out in a third-party shape at all") and asks it separately via isExpandable.
function isHostDeclared(type: ts.Type): boolean {
	const declarations = declarationsOf(type);
	return (
		declarations.length > 0 &&
		declarations.every(
			(declaration) =>
				!EXTERNAL_DECLARATION_PATTERN.test(
					declaration.getSourceFile().fileName,
				),
		)
	);
}

// Extracts the npm package name from a declaration file's path. `@scope/name` is two segments.
// When dependencies are nested (`a/node_modules/b/...`), what actually matters is the
// innermost one, so this is based on the last node_modules segment.
function packageOfDeclarationFile(fileName: string): string | null {
	const path = fileName.replace(/\\/g, "/");
	const at = path.lastIndexOf(NODE_MODULES_SEGMENT);
	if (at === -1) {
		return null;
	}
	const segments = path.slice(at + NODE_MODULES_SEGMENT.length).split("/");
	if (TS_LIB_FILE_PATTERN.test(segments[segments.length - 1])) {
		return null;
	}
	const name = segments[0].startsWith("@")
		? segments.slice(0, 2).join("/")
		: segments[0];
	return name || null;
}

// React's own attribute mixins (HTMLAttributes, RefAttributes, ...) are intersected into
// nearly every wrapper's props via helpers like ComponentProps. They are never the package
// the reader wants pointed at, so they're excluded when resolving through to the real owner.
const REACT_ATTRIBUTE_PACKAGE = "@types/react";

// The packages a set of declarations resolve to, one entry per distinct package.
function packagesOf(declarations: readonly ts.Declaration[]): Set<string> {
	const names = new Set<string>();
	for (const declaration of declarations) {
		const name = packageOfDeclarationFile(declaration.getSourceFile().fileName);
		if (name) {
			names.add(name);
		}
	}
	return names;
}

// The declarations of a type's underlying symbol, ignoring any host alias. For an
// intersection (what ComponentProps<typeof X> resolves to), every member's declarations
// are gathered so a re-exported external type can be traced back past the host alias.
function underlyingDeclarations(type: ts.Type): ts.Declaration[] {
	const members = type.isIntersection() ? type.types : [type];
	return members.flatMap(
		(member) => member.getSymbol()?.getDeclarations() ?? [],
	);
}

// Whether a type, looked at past any host alias, still bottoms out in node_modules.
//
// A host alias can do more than name an object type: `type X = ThirdPartyType` re-exports
// one outright, and `type X = HostExtras & ThirdPartyType` (the shape
// `ComponentProps<typeof X>`-style helpers produce) mixes host-only fields into one. In
// both cases isHostDeclared alone sees only the alias's own declaration and reports
// "host", because that's a different, narrower question. Reusing underlyingDeclarations
// (same helper declaringPackage uses to trace a re-export back to its package) answers
// this one instead: does any constituent, alias set aside, come from node_modules.
//
// For an intersection this is deliberately conservative: a single external constituent
// marks the whole type external, even though other constituents are host-declared.
// Expanding just the host-declared constituent's fields and leaving the external one out
// would keep more information, but readFields reads an intersection's fields via a flat
// getProperties() call with no per-constituent origin to key off, so splitting them
// isn't free. Being conservative here avoids leaking the third-party constituent's
// members, at the cost of also not showing the host-only ones. A purely host-declared
// intersection (no external constituent) is unaffected and still expands in full.
function hasExternalConstituent(type: ts.Type): boolean {
	return underlyingDeclarations(type).some((declaration) =>
		EXTERNAL_DECLARATION_PATTERN.test(declaration.getSourceFile().fileName),
	);
}

// Whether a json prop's type should have its fields expanded. Host-declared is
// necessary but not sufficient: a host alias can still resolve, once looked past, into a
// third-party shape (isHostDeclared doesn't see that; hasExternalConstituent does).
function isExpandable(type: ts.Type): boolean {
	return isHostDeclared(type) && !hasExternalConstituent(type);
}

// The name of the package a type is declared in. Even for a third-party type that isn't
// expanded, we can still say "look it up here". A type whose declarations are scattered
// across multiple packages doesn't resolve to one, so nothing is reported in that case
// (with no way to tell which one to look up, writing either would be a lie).
//
// The direct pass follows a host alias (`type Foo = ...`) first, which is what an author
// reads. When that yields no package — a type re-exported from a dependency, such as
// `type DialogProps = React.ComponentProps<typeof RadixDialog.Root>` — the underlying
// declarations are consulted instead, so the dependency is still reported. React's own
// attribute mixins are dropped from that set: they ride along on every wrapper and are
// never the owner worth pointing at. This only affects the reported package name; the
// type's display name and any expanded fields are decided elsewhere and untouched.
function declaringPackage(type: ts.Type): string | null {
	const direct = packagesOf(declarationsOf(type));
	if (direct.size === 1) {
		return [...direct][0];
	}
	if (direct.size > 1) {
		return null;
	}
	const underlying = packagesOf(underlyingDeclarations(type));
	underlying.delete(REACT_ATTRIBUTE_PACKAGE);
	return underlying.size === 1 ? [...underlying][0] : null;
}

// Whether this is a structural object type with no name — one that has no call
// signature but does have fields. Callers are expected to confirm typeName is null before using this.
//
// Intersection types are excluded here (they don't carry the Object flag). An
// intersection type that can be written compactly, like `A & B`, has a type text that's
// more informative than "object", so it's not rounded down here — it falls through to
// shortTypeText's length check instead. Whether to expand its fields is a decision made on the readFields side.
function isStructuralObject(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.Object) === 0) {
		return false;
	}
	if (type.getCallSignatures().length > 0) {
		return false;
	}
	return type.getProperties().length > 0;
}

// Writes a field's type compactly. A named type is shown by its name; an unnamed object
// type stops at "object" without showing its contents (to keep the "only one level deep" promise).
function shortTypeText(
	type: ts.Type,
	checker: ts.TypeChecker,
	depth = 0,
): string {
	const element = depth < MAX_ARRAY_DEPTH ? elementType(type, checker) : null;
	if (element) {
		return `${shortTypeText(element, checker, depth + 1)}[]`;
	}
	const text = checker.typeToString(type).replace(UNDEFINED_UNION_PATTERN, "");
	const name = asTypeName(text);
	if (name) {
		return name;
	}
	if (isStructuralObject(type)) {
		return "object";
	}
	if (text.length <= TYPE_TEXT_LIMIT && !text.includes("\n")) {
		return text;
	}
	// A type that's too long gets rounded down to a category word. Printing it in full wouldn't fit on one line and would break inspect's table layout.
	if (type.getCallSignatures().length > 0) {
		return "function";
	}
	if (type.isUnion()) {
		return "union";
	}
	return "object";
}

// Collapses JSDoc down to a single line. inspect lists one field per line, so a leftover line break would make the line boundaries unreadable.
function describe(
	property: ts.Symbol,
	checker: ts.TypeChecker,
): string | undefined {
	const text = ts
		.displayPartsToString(property.getDocumentationComment(checker))
		.replace(/\s+/g, " ")
		.trim();
	if (!text) {
		return undefined;
	}
	return text.length > DESCRIPTION_LIMIT
		? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…`
		: text;
}

function toField(
	property: ts.Symbol,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): PropField {
	const declaration =
		property.valueDeclaration ?? property.getDeclarations()?.[0] ?? fallback;
	return {
		name: property.getName(),
		type: shortTypeText(
			stripUndefined(checker.getTypeOfSymbolAtLocation(property, declaration)),
			checker,
		),
		optional: (property.flags & ts.SymbolFlags.Optional) !== 0 || undefined,
		description: describe(property, checker),
	};
}

type Fields = {
	fields: PropField[];
	// Total count before being cut down to the limit.
	total: number;
	// Whether these fields were collected across all members of a union. When true, the
	// caller needs to render fields/variants as "shared fields, plus exactly one of
	// variants" rather than a single flat shape.
	union?: boolean;
	// Only populated when union is true. Fields present on only some branches — the
	// reader must pick exactly one of these per instance.
	variants?: PropField[];
};

// Whether every member of a union is, without exception, "an object type that has
// fields". Discriminated unions (`{ kind: "link"; href: string } | { kind: "button"; onClick: () => void }`)
// fall into this category. A union of string literals (`"a" | "b"`) is excluded here
// (it carries neither the Object nor Intersection flag, so it's filtered out). If it
// weren't excluded, calling getProperties() on a member would return the 52 members of
// String.prototype (see the comment on the readMembers side).
function isObjectUnionMember(type: ts.Type): boolean {
	if ((type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
		return false;
	}
	if (type.getCallSignatures().length > 0) {
		return false;
	}
	return type.getProperties().length > 0;
}

// Merges a discriminated union's fields across its members, splitting them into fields
// shared by every branch and fields that only exist on some (variants — pick exactly one).
//
// Calling getProperties() on the union type itself only returns "fields present on
// every member" (i.e. just the common fields, like the discriminant). Picking up
// branch-specific fields (`href`, `onClick`, etc.) requires calling getProperties() on
// each member individually and merging by name.
//
// A base intersected with the union (`{ label } & ({ onClick } | { items })`) makes this
// harder: TypeScript distributes the intersection over the union, so every member ends
// up with all four property symbols — a branch that doesn't have a given field often
// still declares it as `field?: never` purely to cancel out excess-property checking.
// That symbol carries no real type of its own (it resolves to `undefined`), so a field
// only counts as "present" on a member when its resolved type is more than that
// placeholder. Grouping and requiredness are both judged from these real occurrences
// only — a field present as a real (non-placeholder) value in every member is shared;
// otherwise it's a variant, and it's shown as required unless it's optional even within
// the branch(es) where it does appear (never from a `?: never` branch it's absent from).
function unionFields(
	members: readonly ts.Type[],
	checker: ts.TypeChecker,
	fallback: ts.Node,
): Fields {
	const perMember = members.map((member) => {
		const properties = new Map<string, ts.Symbol>();
		for (const property of member.getProperties()) {
			properties.set(property.getName(), property);
		}
		return properties;
	});

	// Preserves order of appearance (member order, then declaration order within a
	// member). This produces a readable ordering where the base common fields come first, followed by the branch-specific ones.
	const order: string[] = [];
	const seen = new Set<string>();
	for (const properties of perMember) {
		for (const name of properties.keys()) {
			if (!seen.has(name)) {
				seen.add(name);
				order.push(name);
			}
		}
	}

	const shared: PropField[] = [];
	const variants: PropField[] = [];
	for (const name of order.slice(0, FIELD_LIMIT)) {
		const occurrences = perMember
			.map((properties) => properties.get(name))
			.filter((symbol): symbol is ts.Symbol => symbol !== undefined);
		// Per-member text + optionality, preserving member order (collapsing into a
		// union and passing that to typeToString would have checker.getUnionType reorder
		// the members by type id, which no longer matches declaration order).
		const contributions = occurrences.map((symbol) => {
			const declaration =
				symbol.valueDeclaration ?? symbol.getDeclarations()?.[0] ?? fallback;
			const raw = checker.getTypeOfSymbolAtLocation(symbol, declaration);
			return {
				symbol,
				text: shortTypeText(stripUndefined(raw), checker),
				optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
			};
		});
		// A `?: never` cancel-out branch resolves to "undefined" and contributes nothing
		// real — excluding it is what makes both the shared/variant split and the
		// requiredness judgment below only look at branches that actually carry the field.
		const real = contributions.filter((c) => c.text !== "undefined");
		const presentInAll = real.length === perMember.length;
		const texts = [...new Set(real.map((c) => c.text))];
		const description = occurrences
			.map((symbol) => describe(symbol, checker))
			.find((text): text is string => text !== undefined);
		const field: PropField = {
			name,
			type: texts.join(" | ") || "undefined",
			// Optional if it's ever written as optional in a branch where it actually
			// appears. For a variant field this deliberately ignores the `?: never`
			// branches it's absent from — those don't make it optional, they make it not apply.
			optional: real.some((c) => c.optional) || undefined,
			description,
		};
		(presentInAll ? shared : variants).push(field);
	}

	return {
		fields: shared,
		variants: variants.length > 0 ? variants : undefined,
		total: order.length,
		union: true,
	};
}

function readFields(
	type: ts.Type,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): Fields | null {
	if (type.isUnion()) {
		// A discriminated union's shape changes depending on which branch is written,
		// but as long as every member is an object type with fields, there's no reason
		// to discard the per-branch fields and JSDoc (the host's tsc is what catches an
		// actually wrong combination, so expanding here is safe). If even one member
		// isn't an object type (e.g. a mix of literals / primitives), there's no common
		// shape we can commit to, so it isn't expanded.
		if (!type.types.every(isObjectUnionMember)) {
			return null;
		}
		return unionFields(type.types, checker, fallback);
	}
	// An intersection type is "one shape that satisfies everything at once", so there's
	// no ambiguity about which branch it is. getProperties() already returns the merged
	// result, so it can be expanded as-is. Intersection types don't carry the Object
	// flag, so a flag-only check would never reach this branch.
	if ((type.flags & ts.TypeFlags.Object) === 0 && !type.isIntersection()) {
		return null;
	}
	// A function is not "a shape with fields".
	if (type.getCallSignatures().length > 0) {
		return null;
	}
	const properties = type.getProperties();
	if (properties.length === 0) {
		return null;
	}
	return {
		fields: properties
			.slice(0, FIELD_LIMIT)
			.map((property) => toField(property, checker, fallback)),
		total: properties.length,
	};
}

// A single parameter's text. Name, optionality, and rest are placed before the type, and the type is rounded the same way fields are.
function parameterText(
	parameter: ts.Symbol,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): string {
	const declaration =
		parameter.valueDeclaration ?? parameter.getDeclarations()?.[0];
	const type = checker.getTypeOfSymbolAtLocation(
		parameter,
		declaration ?? fallback,
	);
	const isParameterDeclaration =
		declaration !== undefined && ts.isParameter(declaration);
	// A rest parameter's type is the array itself (`...args: unknown[]`), so undefined isn't stripped from it.
	const rest =
		isParameterDeclaration && declaration.dotDotDotToken !== undefined;
	const optional =
		isParameterDeclaration && checker.isOptionalParameter(declaration);
	const text = shortTypeText(rest ? type : stripUndefined(type), checker);
	return `${rest ? "..." : ""}${parameter.getName()}${optional ? "?" : ""}: ${text}`;
}

// Writes a single call signature on one line.
// Type parameters are kept as declared. In `<TData>(table: Table<TData>) => void`, TData
// is a value the caller decides, so collapsing it to a concrete type would write one
// particular inference result as if it were the whole specification.
function signatureText(
	signature: ts.Signature,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): string {
	const typeParameters = signature.getTypeParameters() ?? [];
	const head =
		typeParameters.length > 0
			? `<${typeParameters.map((parameter) => checker.typeToString(parameter)).join(", ")}>`
			: "";
	const parameters = signature
		.getParameters()
		.map((parameter) => parameterText(parameter, checker, fallback));
	const returns = shortTypeText(signature.getReturnType(), checker);
	return `${head}(${parameters.join(", ")}) => ${returns}`;
}

// A function prop's call signature.
//
// A function prop for which the Manifest shows only a name gives no way to know its
// arguments or return value, so no call can be written for it. The actual type is often
// as short as `(files: File[]) => void`, and adding just that one line changes the prop
// from "we know it exists but can't write it" to "writable". Overloads are all listed in
// declaration order — which one gets used is the caller's decision, so narrowing to just
// the first would hide a call that should have been writable.
export function resolveCallSignatures(
	raw: ts.Type,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): string[] | null {
	const signatures = stripNullish(raw).getCallSignatures();
	if (signatures.length === 0) {
		return null;
	}
	return signatures.map((signature) =>
		signatureText(signature, checker, fallback),
	);
}

// The kinds of union member that can be listed as-is — literals and primitives only.
// Expanding an object union wouldn't get us its contents anyway (calling getProperties()
// on a string-literal union returns String.prototype's 52 members instead), so the line is drawn here.
const LISTABLE_MEMBER_FLAGS =
	ts.TypeFlags.StringLike |
	ts.TypeFlags.NumberLike |
	ts.TypeFlags.BooleanLike |
	ts.TypeFlags.BigIntLike |
	ts.TypeFlags.ESSymbolLike;

type Members = {
	members: string[];
	// Total count before being cut down to the limit.
	total: number;
};

// Lists a union's members. For something like `string | number` or 15 string literals,
// listing the members gives more actually-writable information than showing a name
// would. Discriminated unions are left unexpanded here for the same reason as in readFields.
function readMembers(type: ts.Type, checker: ts.TypeChecker): Members | null {
	if (!type.isUnion()) {
		return null;
	}
	// null / undefined express "no value", which the nullable / optional flags already convey.
	const listed = type.types.filter(
		(member) =>
			(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
	);
	if (
		listed.length === 0 ||
		listed.some((member) => (member.flags & LISTABLE_MEMBER_FLAGS) === 0)
	) {
		return null;
	}
	return {
		members: listed
			.slice(0, MEMBER_LIMIT)
			.map((member) => checker.typeToString(member)),
		total: listed.length,
	};
}

// Display name for an unnamed union. When it's short enough to write out fully, like
// `string | number`, that text is itself the name — splitting name and contents across
// two lines would give the reader nothing extra. Only when it can't be written out fully does it get rounded down to a category word.
function unionText(members: Members, truncated: number): string {
	const text = members.members.join(" | ");
	return truncated === 0 && text.length <= TYPE_TEXT_LIMIT ? text : "union";
}

export type HostDeclarationRef = {
	// Absolute path to the file that declares the type.
	file: string;
	// The type's display name, for pointing a reader at "look up this name in that file".
	name: string;
};

// Where a prop's type is declared, when that's the host's own source rather than
// node_modules. Peels one array level the same way resolvePropShape does (the element is
// what a prop like `icons: IconName[]` actually refers to), and only reports a type that
// has a real name — an anonymous object type isn't declared anywhere a reader could go
// look, so it isn't reportable.
//
// Used to find a prop type the host declared in a file that --source's globs don't
// cover (e.g. an icons module kept outside the glob on purpose or by oversight), so that
// gap can be surfaced in --report instead of silently leaving no trace of it.
export function hostDeclarationRefs(
	raw: ts.Type,
	checker: ts.TypeChecker,
): HostDeclarationRef[] {
	const stripped = stripNullish(raw);
	const element = elementType(stripped, checker);
	const target = element ? stripNullish(element) : stripped;
	if (!isHostDeclared(target)) {
		return [];
	}
	const name = typeName(target, checker);
	if (!name) {
		return [];
	}
	const files = new Set(
		declarationsOf(target).map(
			(declaration) => declaration.getSourceFile().fileName,
		),
	);
	return [...files].map((file) => ({ file, name }));
}

// Builds the one-level-deep shape from the type of a prop that was rounded down to json.
// A type for which neither a name nor a shape can be produced returns null — writing a guess would be worse than writing nothing.
export function resolvePropShape(
	raw: ts.Type,
	checker: ts.TypeChecker,
	fallback: ts.Node,
): PropShape | null {
	const stripped = stripNullish(raw);
	// For an array, peel off just one level and show the element's shape — the element is what actually needs to be written.
	const element = elementType(stripped, checker);
	const target = element ? stripNullish(element) : stripped;
	const name = typeName(target, checker);
	const read = isExpandable(target)
		? readFields(target, checker, fallback)
		: null;
	// A type for which fields could be produced isn't a union, so both are never populated at once.
	const members = read ? null : readMembers(target, checker);
	if (!read && !members && !name) {
		return null;
	}
	const shown = read ?? members;
	// A union's shown count spans both fields and variants (both were sliced from the
	// same order list, sharing one FIELD_LIMIT), so both sides count toward "how many of
	// total were actually shown".
	const count = read
		? read.fields.length + (read.variants?.length ?? 0)
		: (members?.members.length ?? 0);
	const truncated = shown ? shown.total - count : 0;
	return {
		type: name ?? (members ? unionText(members, truncated) : "object"),
		array: element ? true : undefined,
		package: declaringPackage(target) ?? undefined,
		fields: read?.fields ?? [],
		members: members?.members,
		truncated: truncated > 0 ? truncated : undefined,
		union: read?.union,
		variants: read?.variants,
	};
}
