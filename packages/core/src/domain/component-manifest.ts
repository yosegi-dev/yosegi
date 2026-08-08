import { z } from "zod";

// A Component Manifest normalizes the component information registered in Storybook
// into an internal format that's easy for the Composer to work with. Storybook-specific
// types (Meta / ArgTypes, etc.) are not carried in here; the Registry generation step
// converts them into this format instead.

// Type category describing how a prop's value can be written. Props that can't hold
// a declarative value (function / reactNode) can be marked editable=false to exclude
// them from editing.
export const propKindSchema = z.enum([
	"string",
	"number",
	"boolean",
	"enum",
	"json",
	"reactNode",
	"function",
]);
export type PropKind = z.infer<typeof propKindSchema>;

// A one-level expansion of the contents of props that were rounded down to json.
//
// A prop of kind json is just an opaque box in the manifest — all it can expose is
// its name and not-editable. Since it's the agent that writes the actual value at
// implementation time, that prop is effectively unusable unless the field names,
// types, and required-ness are known. Type checking can't substitute for this (a
// third-party type with an empty interface will happily accept a bogus object
// literal), so this has to be conveyed as prose instead.
export const propFieldSchema = z.object({
	name: z.string().min(1),
	// Abbreviated type notation. Nested objects stop at "object", arrays stop at "Foo[]".
	type: z.string().min(1),
	// Unspecified is treated as false (i.e. required).
	optional: z.boolean().optional(),
	// The JSDoc attached to the field, collapsed to a single line.
	description: z.string().optional(),
});
export type PropField = z.infer<typeof propFieldSchema>;

export const propShapeSchema = z.object({
	// Display name of the type the fields belong to. Anonymous object types use "object".
	type: z.string().min(1),
	// Whether the prop is an array and fields describes its element type. Unspecified
	// is treated as false.
	array: z.boolean().optional(),
	// The node_modules package name that declares the type (e.g. "@rowkit/table-core").
	// Third-party types that aren't expanded leave only a name behind, so this says where
	// to go look. Not set for host-declared types or types whose package can't be identified.
	package: z.string().min(1).optional(),
	// Fields expanded one level deep. Empty for types that aren't expanded (unions of
	// literals/primitives, third-party types), leaving only type as a clue. For a
	// discriminated union (union: true), this holds only the fields common to every
	// branch (e.g. a shared base, or the discriminant itself) — branch-specific fields
	// live in variants instead, so a field's presence here already means "always applies".
	fields: z.array(propFieldSchema),
	// Members of a union. Only populated when every member is a literal or primitive.
	// Unions of objects are expanded on the fields side instead (with union: true), so
	// they aren't listed here.
	members: z.array(z.string().min(1)).optional(),
	// Whether fields (and variants) were collected across the members of a discriminated
	// union. The type alone doesn't determine which combination is valid (the host's tsc
	// catches actual mistakes at that point), but fields/variants already say which of
	// them are shared vs. exclusive-or, so no separate note is needed to read them correctly.
	union: z.boolean().optional(),
	// Fields present on only some of a discriminated union's branches (only populated
	// when union is true). Exactly one of these must be written per instance — each is
	// required within its own branch, so unlike fields, none of these carry `optional`
	// unless it's genuinely optional even within that branch too.
	variants: z.array(propFieldSchema).optional(),
	// Count of entries dropped by the truncation limit. Keeps the manifest and inspect
	// output from ballooning into a full copy of the type definition. Since fields/
	// variants and members are mutually exclusive (a union doesn't have members),
	// whichever side is populated tells you which count this refers to.
	truncated: z.number().int().positive().optional(),
});
export type PropShape = z.infer<typeof propShapeSchema>;

export const propDefinitionSchema = z.object({
	kind: propKindSchema,
	description: z.string().optional(),
	// Unspecified is treated as false.
	required: z.boolean().optional(),
	// Whether the prop itself may be omitted (i.e. accepts null). Unspecified is
	// treated as false.
	nullable: z.boolean().optional(),
	// Enum choices. Only meaningful when kind === "enum".
	options: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
	defaultValue: z.unknown().optional(),
	// Whether a value can be written in the Screen JSON. Unspecified is treated as
	// true (function / reactNode are explicitly false).
	editable: z.boolean().optional(),
	// The type's shape one level deep, present only when kind === "json". Not set for
	// types that couldn't be read.
	shape: propShapeSchema.optional(),
	// Call signatures, in declaration order; more than one means overloads.
	//
	// Props with kind === "function" leave only a name in the manifest — no
	// parameters or return type — so the agent can't write a call for them. Function
	// types whose type text doesn't include `=>` (e.g. `Dispatch<SetStateAction<Date>>`)
	// fall through to kind === "json" instead, so this field can also be present there
	// for types that carry a call signature.
	signatures: z.array(z.string().min(1)).min(1).optional(),
});
export type PropDefinition = z.infer<typeof propDefinitionSchema>;

export const slotDefinitionSchema = z.object({
	description: z.string().optional(),
	// Component ids allowed to be placed here. Unspecified allows any component.
	allowedComponents: z.array(z.string()).optional(),
	// Maximum number of children the Slot can hold. Unspecified means unlimited.
	maxItems: z.number().int().positive().optional(),
	// Whether the Slot requires at least one child. Unspecified is treated as false.
	required: z.boolean().optional(),
});
export type SlotDefinition = z.infer<typeof slotDefinitionSchema>;

// A manifest built mechanically from types lists every export that exists, so the
// parts the host actually wants used sit alongside internal implementation details
// with no distinction. A Story is the host's own curation signal — "this is fine to
// use" — so we keep track of whether one exists and use it as a recommendation signal.
export const componentCurationSchema = z.object({
	// Whether a corresponding Story exists.
	recommended: z.boolean().optional(),
	// The title of the originating Story (e.g. "Components/Button").
	storyTitle: z.string().optional(),
	// Number of Stories available for reference as usage examples.
	storyCount: z.number().int().nonnegative().optional(),
	// Path to the Story file (Storybook's importPath). The references.storybook URL
	// only ever points at the first Story, so this gives a coordinate for reading a
	// specific piece of behavior.
	storyFile: z.string().optional(),
	// Individual Story names (e.g. ["Playground", "Loading", "Empty"]), kept in the
	// same order as index.json.
	storyNames: z.array(z.string()).optional(),
});
export type ComponentCuration = z.infer<typeof componentCurationSchema>;

export const componentConstraintsSchema = z.object({
	allowedParents: z.array(z.string()).optional(),
	allowedChildren: z.array(z.string()).optional(),
	deprecated: z.boolean().optional(),
});

export const componentManifestSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().optional(),
	// Used to filter by category in the Component Browser (e.g. "shadcn-ui").
	category: z.string().optional(),
	import: z.object({
		// The module path as resolved when the manifest was built (relative to
		// projectRoot for `--source`). Not necessarily something that can be written
		// directly in an import statement.
		packageName: z.string().min(1),
		exportName: z.string().min(1),
		// Whether this is a default export. `import X from "..."` and
		// `import { X } from "..."` need to be written differently, and a default
		// export's name doesn't exist on the module side (it borrows the declaration
		// name). Unspecified is treated as named.
		kind: z.enum(["named", "default"]).optional(),
		// The specifier the host actually writes in its import statement. This is the
		// result of resolving tsconfig paths, so it's absent for hosts without aliases
		// or cases that couldn't be resolved (packageName is used instead).
		specifier: z.string().min(1).optional(),
	}),
	props: z.record(z.string(), propDefinitionSchema),
	slots: z.record(z.string(), slotDefinitionSchema),
	// Whether props could be determined from TypeScript types (or explicit metadata).
	// false means "a manifest with only className isn't the real thing," and inspect
	// surfaces a warning for it. Unset for a Registry built from index.json alone,
	// since there's no way to judge in that case.
	propsFromTypes: z.boolean().optional(),
	// A one-line note that standard DOM attributes (onClick, aria-*, ...) pass through,
	// for a component whose props type folds in one of React's DOM-attribute mixins
	// (HTMLAttributes, ComponentPropsWithoutRef<"button">, a Radix primitive's props, ...).
	// These props are real and accepted, but aren't listed individually here — a Radix
	// wrapper alone can carry hundreds of them, which is noise rather than something an
	// agent can act on. Naming that pass-through exists (and the element, when it can be
	// pinned down) is the useful middle ground between silence and enumeration. Absent
	// when no such mixin was detected; under-claiming (no note) is preferred over guessing.
	passthrough: z.string().min(1).optional(),
	constraints: componentConstraintsSchema.optional(),
	curation: componentCurationSchema.optional(),
	usage: z
		.object({
			recommendedFor: z.array(z.string()).optional(),
			notRecommendedFor: z.array(z.string()).optional(),
		})
		.optional(),
	references: z
		.object({
			storybook: z.string().optional(),
			figma: z.string().optional(),
			notion: z.string().optional(),
		})
		.optional(),
});
export type ComponentManifest = z.infer<typeof componentManifestSchema>;

// The inputs used when the Registry was built. Since version is a content hash, it
// can only tell you "same or different" — not what part of the host this particular
// Registry read, or when. We keep a clue for judging staleness, and a command for
// rebuilding under the same conditions, on the Registry itself.
//
// What's kept here is "the inputs that determine the manifest's contents" plus the
// flags actually used, so the rebuild can be reproduced exactly. Dropping one would
// make the rebuild line produce a manifest with different contents (e.g. dropping
// storybookUrl removes references.storybook, which even changes the version hash).
// Output destinations like data-dir / out are not included.
export const registryBuildInputsSchema = z.object({
	sources: z.array(z.string()).optional(),
	tsconfig: z.string().optional(),
	// --project-root. Kept only when explicitly given (when unspecified it's derived
	// from the tsconfig location, so not recording it lets a rebuild re-derive the
	// same default).
	projectRoot: z.string().optional(),
	index: z.string().optional(),
	// --storybook-url. Source of the references.storybook deep link. Dropping it
	// changes the content.
	storybookUrl: z.string().optional(),
	// --version. An explicit ref that overrides the content hash. If used, a rebuild
	// should produce the same version too.
	version: z.string().optional(),
	metadata: z.string().optional(),
	// --report. Doesn't change the manifest's contents, but is kept for reproducing
	// the flags actually used.
	report: z.string().optional(),
});
export type RegistryBuildInputs = z.infer<typeof registryBuildInputsSchema>;

// A Registry is a collection of Manifests with a version attached. version represents
// the Registry's content hash or a git ref, and is what a Screen Definition references.
export const componentRegistrySchema = z.object({
	version: z.string().min(1),
	generatedAt: z.string().optional(),
	// The version of Yosegi (@yosegi/yosegi) that generated this Registry. version
	// itself is a content hash, so it can only say "did the inputs change" — it can't
	// detect the case where the Yosegi that built the manifest was itself too old to
	// emit a newer field (e.g. function signatures). Kept so it can be compared
	// against the currently running CLI on read, prompting a rebuild on mismatch.
	// Absent on Registries built before this field existed (missing is treated as
	// "unknown").
	builtWith: z.string().min(1).optional(),
	// Absolute path to the CLI entry point that generated this (e.g. bin/yosegi.js),
	// captured from the running process. builtWith alone only tells you "which
	// version," and in environments spanning multiple checkouts the reader would have
	// to guess which path the `yosegi` in the rebuild line points to. Keeping this
	// lets the component list show that path directly. Absent on Registries built
	// before this field existed.
	builtWithCliPath: z.string().min(1).optional(),
	inputs: registryBuildInputsSchema.optional(),
	components: z.array(componentManifestSchema),
});
export type ComponentRegistry = z.infer<typeof componentRegistrySchema>;

// Validate external input (e.g. JSON) into a Manifest / Registry.
export function parseComponentManifest(input: unknown): ComponentManifest {
	return componentManifestSchema.parse(input);
}

export function parseComponentRegistry(input: unknown): ComponentRegistry {
	return componentRegistrySchema.parse(input);
}

// A lightweight view that converts a Registry into a Map keyed by id for easy lookup.
export function indexRegistry(
	registry: ComponentRegistry,
): Map<string, ComponentManifest> {
	return new Map(registry.components.map((c) => [c.id, c]));
}
