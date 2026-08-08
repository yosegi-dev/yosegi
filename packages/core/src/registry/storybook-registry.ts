import { createHash } from "node:crypto";
import { z } from "zod";
import {
	type ComponentManifest,
	type ComponentRegistry,
	componentConstraintsSchema,
	componentManifestSchema,
	slotDefinitionSchema,
} from "../domain/component-manifest.ts";
import { mergeSyntheticComponents } from "../domain/synthetics.ts";

// index.json has no argTypes, so Props / Slots are empty for a component with no
// explicit metadata. This used to default className / children onto every
// component, but index.json gives no basis for judging whether a given part
// actually accepts them. Defaulting them would make the Registry report props /
// slots it doesn't really accept, and a Story that trusted that would fail the
// host's type check. If we don't know, we don't list it. Props including
// className / children are supplied through explicit metadata (use the --source
// path if you want them determined from types).

// Minimal schema for the index.json (v5) that a Storybook static build outputs.
// argTypes isn't included in index.json, so Props/Slot/constraints are filled in
// via explicit composer metadata (per the design brief: no fully automatic inference).
export const storybookIndexSchema = z.object({
	v: z.number(),
	entries: z.record(
		z.string(),
		z.object({
			type: z.enum(["story", "docs"]),
			id: z.string(),
			name: z.string(),
			title: z.string(),
			importPath: z.string(),
			componentPath: z.string().optional(),
			tags: z.array(z.string()).optional(),
		}),
	),
});
export type StorybookIndex = z.infer<typeof storybookIndexSchema>;

// Per-component metadata supplied explicitly, from a Story's
// `export const composer = {...}` or a dedicated JSON file. Overrides and fills
// in information that can't be obtained from index.json.
export const composerMetadataSchema = z.object({
	description: z.string().optional(),
	category: z.string().optional(),
	import: z
		.object({ packageName: z.string(), exportName: z.string() })
		.optional(),
	props: z
		.record(z.string(), componentManifestSchema.shape.props.valueType)
		.optional(),
	slots: z.record(z.string(), slotDefinitionSchema).optional(),
	constraints: componentConstraintsSchema.optional(),
	usage: componentManifestSchema.shape.usage,
	references: z
		.object({
			figma: z.string().optional(),
			notion: z.string().optional(),
		})
		.optional(),
});
export type ComposerMetadata = z.infer<typeof composerMetadataSchema>;

export type BuildRegistryOptions = {
	// Storybook's public URL. Used to generate the deep link in references.storybook.
	storybookBaseUrl?: string;
	// Component id -> explicit metadata.
	metadata?: Record<string, ComposerMetadata>;
	// An explicit version (a git ref, etc.). Falls back to a content hash if not given.
	version?: string;
};

// "shadcn-ui/Button" -> { category: "shadcn-ui", id: "Button" }
function splitTitle(title: string): { category: string; id: string } {
	const segments = title.split("/").filter(Boolean);
	const id = segments.at(-1) ?? title;
	const category = segments.length > 1 ? segments[0] : "uncategorized";
	return { category, id };
}

// Determines deprecated from the tags.
function isDeprecated(tags: string[] | undefined): boolean {
	return (tags ?? []).includes("deprecated");
}

function contentHash(components: ComponentManifest[]): string {
	const canonical = JSON.stringify(components);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

// Normalizes a Storybook index.json into a Component Registry.
export function buildRegistryFromStorybook(
	index: StorybookIndex,
	options: BuildRegistryOptions = {},
): ComponentRegistry {
	const baseUrl = options.storybookBaseUrl?.replace(/\/$/, "");
	const metadata = options.metadata ?? {};

	// Aggregates components by title (1 component = multiple Stories).
	const byTitle = new Map<
		string,
		{
			title: string;
			firstStoryId: string;
			tags: Set<string>;
			importPath: string;
			componentPath?: string;
			// Story names, kept in index.json's original order.
			storyNames: string[];
		}
	>();
	for (const entry of Object.values(index.entries)) {
		if (entry.type !== "story") {
			continue;
		}
		const existing = byTitle.get(entry.title);
		if (existing) {
			for (const tag of entry.tags ?? []) {
				existing.tags.add(tag);
			}
			// Whether componentPath is present varies per Story. Even if the first Story
			// lacks it, the implementation file can still be identified if a later Story
			// has it, so the first value found is the one adopted.
			existing.componentPath ??= entry.componentPath;
			existing.storyNames.push(entry.name);
			continue;
		}
		byTitle.set(entry.title, {
			title: entry.title,
			firstStoryId: entry.id,
			tags: new Set(entry.tags ?? []),
			importPath: entry.importPath,
			componentPath: entry.componentPath,
			storyNames: [entry.name],
		});
	}

	// id is the title's trailing segment. But in real hosts it's not uncommon for
	// distinct components to share a trailing segment, e.g. "Components/DataTable"
	// and "Examples/DataTable". Colliding ids are disambiguated by falling back to
	// the full title. Escaping only one side of a collision would make which one
	// keeps the short id depend on index.json's enumeration order, so every
	// component in a collision falls back to its title.
	const baseIdCounts = new Map<string, number>();
	for (const grouped of byTitle.values()) {
		const { id } = splitTitle(grouped.title);
		baseIdCounts.set(id, (baseIdCounts.get(id) ?? 0) + 1);
	}

	const components: ComponentManifest[] = [];
	// title is byTitle's key, so under the rule above id should end up unique — but
	// a downstream byId Map would silently let a later duplicate overwrite an earlier
	// one, making a component vanish without warning. Enforced explicitly as an invariant.
	const idToTitle = new Map<string, string>();
	for (const grouped of byTitle.values()) {
		const { category, id: baseId } = splitTitle(grouped.title);
		const id = (baseIdCounts.get(baseId) ?? 0) > 1 ? grouped.title : baseId;
		const conflictingTitle = idToTitle.get(id);
		if (conflictingTitle) {
			throw new Error(
				`Component id "${id}" is produced by multiple Storybook titles ("${conflictingTitle}" and "${grouped.title}"). Rename one so their titles differ.`,
			);
		}
		idToTitle.set(id, grouped.title);
		const meta = metadata[id] ?? {};
		const deprecated = isDeprecated([...grouped.tags]);

		const manifest: ComponentManifest = componentManifestSchema.parse({
			id,
			// The display name is the trailing segment. Even when id falls back to the full title, the display name doesn't change.
			name: baseId,
			description: meta.description,
			category,
			import: meta.import ?? {
				// Use componentPath if present, otherwise fall back to the story's importPath.
				packageName: grouped.componentPath ?? grouped.importPath,
				exportName: baseId,
			},
			props: meta.props ?? {},
			slots: meta.slots ?? {},
			constraints: {
				...(meta.constraints ?? {}),
				deprecated: meta.constraints?.deprecated ?? deprecated,
			},
			usage: meta.usage,
			// Where a Story lives is already present in index.json. references.storybook's
			// URL only points at the first Story, so the file and Story names are kept too.
			curation: {
				recommended: true,
				storyTitle: grouped.title,
				storyCount: grouped.storyNames.length,
				storyFile: grouped.importPath,
				storyNames: grouped.storyNames,
			},
			references: {
				storybook: baseUrl
					? `${baseUrl}/?path=/story/${grouped.firstStoryId}`
					: undefined,
				figma: meta.references?.figma,
				notion: meta.references?.notion,
			},
		});
		components.push(manifest);
	}

	// Adds components that don't appear in index.json to the Registry, using explicit
	// metadata alone. Storybook subcomponents, or a single title that bundles multiple
	// exports (e.g. title "Typography" whose component is Text, with Heading as a
	// subcomponent), can't have their individual exports looked up from index.json, so
	// this is the only path that can register them. import can't be filled in from
	// index.json, so it's required. To avoid silently swallowing a typo'd id, metadata
	// that matches no title and has no import is an error.
	for (const [id, meta] of Object.entries(metadata)) {
		if (idToTitle.has(id)) {
			continue;
		}
		if (!meta.import) {
			throw new Error(
				`Metadata "${id}" matches no Storybook title. Add an explicit "import" ({ packageName, exportName }) to register it as an extra component, or fix the id.`,
			);
		}
		components.push(
			componentManifestSchema.parse({
				id,
				name: id,
				description: meta.description,
				category: meta.category,
				import: meta.import,
				props: meta.props ?? {},
				slots: meta.slots ?? {},
				constraints: meta.constraints,
				usage: meta.usage,
				references: {
					figma: meta.references?.figma,
					notion: meta.references?.notion,
				},
			}),
		);
	}

	// Synthetic primitives (Text / Box / Heading) have no Story and never appear in
	// index.json, but they're required to compose structure. If a consumer of the
	// Registry forgets to add them, validation treats them as unregistered — so a
	// Registry built from index.json always includes them.
	const merged = mergeSyntheticComponents(components);

	// Stabilized by sorting ids ascending before hashing and storing.
	merged.sort((a, b) => a.id.localeCompare(b.id));

	return {
		version: options.version ?? `sha:${contentHash(merged)}`,
		components: merged,
	};
}
