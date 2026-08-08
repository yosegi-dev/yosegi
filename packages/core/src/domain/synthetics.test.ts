import { describe, expect, it } from "bun:test";
import { parseComponentRegistry } from "./component-manifest.ts";
import { parseScreenDefinition } from "./screen-definition.ts";
import {
	isSyntheticComponentId,
	isSyntheticManifest,
	SYNTHETIC_PACKAGE,
	syntheticComponentManifests,
	withSyntheticComponents,
} from "./synthetics.ts";
import { validateScreen } from "./validator.ts";

const emptyRegistry = () =>
	parseComponentRegistry({ version: "v1", components: [] });

describe("synthetics", () => {
	it("identifies synthetic primitive ids", () => {
		expect(isSyntheticComponentId("Text")).toBe(true);
		expect(isSyntheticComponentId("Box")).toBe(true);
		expect(isSyntheticComponentId("Heading")).toBe(true);
		expect(isSyntheticComponentId("Button")).toBe(false);
	});

	it("Manifests can be identified by the sentinel packageName", () => {
		for (const manifest of syntheticComponentManifests()) {
			expect(manifest.import.packageName).toBe(SYNTHETIC_PACKAGE);
			expect(isSyntheticManifest(manifest)).toBe(true);
		}
	});

	it("withSyntheticComponents adds 3 entries to the Registry", () => {
		const registry = withSyntheticComponents(emptyRegistry());
		expect(registry.components.map((c) => c.id)).toEqual([
			"Text",
			"Box",
			"Heading",
		]);
	});

	it("prefers the host's version when the host has the same id", () => {
		const host = parseComponentRegistry({
			version: "v1",
			components: [
				{
					id: "Text",
					name: "Text",
					import: { packageName: "~/components/text", exportName: "Text" },
					props: {},
					slots: {},
				},
			],
		});
		const registry = withSyntheticComponents(host);
		const text = registry.components.filter((c) => c.id === "Text");
		expect(text).toHaveLength(1);
		expect(text[0].import.packageName).toBe("~/components/text");
	});

	it("a screen made only of synthetic primitives passes validation", () => {
		const screen = parseScreenDefinition({
			schemaVersion: "1.0",
			id: "s",
			name: "S",
			componentRegistryVersion: "v1",
			revision: 0,
			root: {
				id: "root",
				component: "Box",
				props: { className: "p-6" },
				slots: {
					children: [
						{
							id: "h",
							component: "Heading",
							props: { text: "見出し" },
							slots: {},
						},
					],
				},
			},
		});
		const result = validateScreen(
			screen,
			withSyntheticComponents(emptyRegistry()),
		);
		expect(result.valid).toBe(true);
	});
});
