import {
	type ComponentManifest,
	type ComponentRegistry,
	componentManifestSchema,
} from "./component-manifest.ts";

// Synthetic primitives aren't any component in the Registry — they're pseudo
// components the tool provides for building structure. When generating CSF they
// expand to plain JSX with no import. Putting this sentinel value in
// import.packageName lets them be distinguished from the case where the host has a
// real component of the same name (e.g. its own Text) in the Registry.
export const SYNTHETIC_PACKAGE = "@yosegi/synthetic";

export const SYNTHETIC_COMPONENT_IDS = ["Text", "Box", "Heading"] as const;
export type SyntheticComponentId = (typeof SYNTHETIC_COMPONENT_IDS)[number];

export function isSyntheticComponentId(id: string): id is SyntheticComponentId {
	return (SYNTHETIC_COMPONENT_IDS as readonly string[]).includes(id);
}

export function isSyntheticManifest(manifest: ComponentManifest): boolean {
	return manifest.import.packageName === SYNTHETIC_PACKAGE;
}

// Manifests for the synthetic primitives. Added to the Registry so the Validator
// doesn't treat them as unregistered.
export function syntheticComponentManifests(): ComponentManifest[] {
	return [
		componentManifestSchema.parse({
			id: "Text",
			name: "Text",
			description: "Arbitrary text. Emitted as a JSX text node.",
			category: "synthetic",
			import: { packageName: SYNTHETIC_PACKAGE, exportName: "Text" },
			props: { text: { kind: "string", required: true } },
			slots: {},
		}),
		componentManifestSchema.parse({
			id: "Box",
			name: "Box",
			description: "Arbitrary container. Emitted as a div with a className.",
			category: "synthetic",
			import: { packageName: SYNTHETIC_PACKAGE, exportName: "Box" },
			props: { className: { kind: "string" } },
			slots: { children: {} },
		}),
		componentManifestSchema.parse({
			id: "Heading",
			name: "Heading",
			description: "Heading. Emitted as an h1.",
			category: "synthetic",
			import: { packageName: SYNTHETIC_PACKAGE, exportName: "Heading" },
			props: { text: { kind: "string", required: true } },
			slots: {},
		}),
	];
}

// Adds synthetic primitives to an array of Manifests. If the host has the same id,
// the host's version takes priority.
export function mergeSyntheticComponents(
	components: ComponentManifest[],
): ComponentManifest[] {
	const existingIds = new Set(components.map((c) => c.id));
	const added = syntheticComponentManifests().filter(
		(manifest) => !existingIds.has(manifest.id),
	);
	if (added.length === 0) {
		return components;
	}
	return [...components, ...added];
}

// Adds synthetic primitives to a Registry. If the host has the same id, the host's
// version takes priority.
export function withSyntheticComponents(
	registry: ComponentRegistry,
): ComponentRegistry {
	const components = mergeSyntheticComponents(registry.components);
	if (components === registry.components) {
		return registry;
	}
	return { ...registry, components };
}
