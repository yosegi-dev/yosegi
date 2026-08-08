import { describe, expect, it } from "bun:test";
import { sampleRegistry } from "../test-fixtures.ts";
import {
	indexRegistry,
	parseComponentManifest,
	parseComponentRegistry,
} from "./component-manifest.ts";

describe("parseComponentManifest", () => {
	it("can parse a minimal Prop definition (kind only)", () => {
		const manifest = parseComponentManifest({
			id: "Button",
			name: "Button",
			import: { packageName: "pkg", exportName: "Button" },
			props: { label: { kind: "string" } },
			slots: {},
		});
		expect(manifest.props.label.kind).toBe("string");
		// Unspecified required / nullable / editable are undefined (defaults are interpreted on the logic side).
		expect(manifest.props.label.required).toBeUndefined();
		expect(manifest.props.label.editable).toBeUndefined();
	});

	it("retains curation (recommendation signal derived from a Story)", () => {
		const manifest = parseComponentManifest({
			id: "app/components/button#Button",
			name: "Button",
			import: {
				packageName: "./app/components/button.tsx",
				exportName: "Button",
			},
			props: {},
			slots: {},
			curation: {
				recommended: true,
				storyTitle: "Components/Button",
				storyCount: 6,
			},
		});
		expect(manifest.curation).toEqual({
			recommended: true,
			storyTitle: "Components/Button",
			storyCount: 6,
		});
	});

	it("can omit curation", () => {
		const manifest = parseComponentManifest({
			id: "X",
			name: "X",
			import: { packageName: "p", exportName: "X" },
			props: {},
			slots: {},
		});
		expect(manifest.curation).toBeUndefined();
	});

	it("fails when storyCount is negative", () => {
		expect(() =>
			parseComponentManifest({
				id: "X",
				name: "X",
				import: { packageName: "p", exportName: "X" },
				props: {},
				slots: {},
				curation: { storyCount: -1 },
			}),
		).toThrow();
	});

	it("fails when kind is invalid", () => {
		expect(() =>
			parseComponentManifest({
				id: "X",
				name: "X",
				import: { packageName: "p", exportName: "X" },
				props: { a: { kind: "date" } },
				slots: {},
			}),
		).toThrow();
	});
});

describe("passthrough", () => {
	it("accepts a one-line pass-through note", () => {
		const manifest = parseComponentManifest({
			id: "X",
			name: "X",
			import: { packageName: "p", exportName: "X" },
			props: {},
			slots: {},
			passthrough: "button DOM props (onClick, aria-*, …) pass through",
		});
		expect(manifest.passthrough).toBe(
			"button DOM props (onClick, aria-*, …) pass through",
		);
	});

	it("is undefined when not set (an old manifest without this field still parses)", () => {
		const manifest = parseComponentManifest({
			id: "X",
			name: "X",
			import: { packageName: "p", exportName: "X" },
			props: {},
			slots: {},
		});
		expect(manifest.passthrough).toBeUndefined();
	});

	it("rejects an empty string (write no note rather than an empty one)", () => {
		expect(() =>
			parseComponentManifest({
				id: "X",
				name: "X",
				import: { packageName: "p", exportName: "X" },
				props: {},
				slots: {},
				passthrough: "",
			}),
		).toThrow();
	});
});

describe("indexRegistry", () => {
	it("returns a Map that can look up a Manifest by id", () => {
		const index = indexRegistry(sampleRegistry());
		expect(index.get("Button")?.name).toBe("Button");
		expect(index.has("Nope")).toBe(false);
	});
});

describe("parseComponentRegistry provenance", () => {
	const base = {
		version: "src:abc123",
		components: [],
	};

	it("retains builtWith and the extended inputs", () => {
		const registry = parseComponentRegistry({
			...base,
			generatedAt: "2026-08-09T01:02:03.000Z",
			builtWith: "0.1.0",
			builtWithCliPath: "/checkout/packages/server/bin/yosegi.js",
			inputs: {
				sources: ["app/components/**/*.tsx"],
				tsconfig: "./tsconfig.json",
				projectRoot: "./app",
				index: "http://localhost:6006/index.json",
				storybookUrl: "http://localhost:6006",
				version: "v1.2.3",
				metadata: "./meta.json",
				report: "tmp/report.json",
			},
		});
		expect(registry.builtWith).toBe("0.1.0");
		expect(registry.builtWithCliPath).toBe(
			"/checkout/packages/server/bin/yosegi.js",
		);
		expect(registry.inputs?.storybookUrl).toBe("http://localhost:6006");
		expect(registry.inputs?.projectRoot).toBe("./app");
		expect(registry.inputs?.version).toBe("v1.2.3");
		expect(registry.inputs?.report).toBe("tmp/report.json");
	});

	// A manifest built before this field existed doesn't have builtWith / builtWithCliPath.
	// It should still parse gracefully, with missing values treated as "unknown".
	it("an old manifest without builtWith still passes validation, with the value undefined", () => {
		const registry = parseComponentRegistry(base);
		expect(registry.builtWith).toBeUndefined();
		expect(registry.builtWithCliPath).toBeUndefined();
	});
});

describe("propDefinition shape", () => {
	function parseWithShape(shape: unknown) {
		return parseComponentManifest({
			id: "X",
			name: "X",
			import: { packageName: "p", exportName: "X" },
			props: { config: { kind: "json", shape } },
			slots: {},
		}).props.config.shape;
	}

	it("retains fields and truncated", () => {
		expect(
			parseWithShape({
				type: "SelectAllState",
				array: true,
				fields: [
					{ name: "totalCount", type: "number", description: "件数。" },
					{ name: "label", type: "string", optional: true },
				],
				truncated: 3,
			}),
		).toEqual({
			type: "SelectAllState",
			array: true,
			fields: [
				{ name: "totalCount", type: "number", description: "件数。" },
				{ name: "label", type: "string", optional: true },
			],
			truncated: 3,
		});
	});

	// A type that couldn't be expanded leaves only its name behind. Valid even with empty fields.
	it("passes even when fields is empty", () => {
		expect(parseWithShape({ type: "Action", fields: [] })?.fields).toEqual([]);
	});

	// shape is an optional field added later. Existing manifests must still parse as-is.
	it("props without shape still pass as-is", () => {
		expect(
			parseComponentManifest({
				id: "X",
				name: "X",
				import: { packageName: "p", exportName: "X" },
				props: { config: { kind: "json" } },
				slots: {},
			}).props.config.shape,
		).toBeUndefined();
	});

	it("fails when fields is missing", () => {
		expect(() => parseWithShape({ type: "Action" })).toThrow();
	});

	// union: true is a note that "the listed fields aren't guaranteed to all be
	// present at once". It can be retained independently of members (used for unions
	// of literals/primitives).
	it("retains the union flag", () => {
		expect(
			parseWithShape({
				type: "Action",
				array: true,
				union: true,
				fields: [
					{ name: "kind", type: '"link" | "button"' },
					{ name: "href", type: "string", optional: true },
				],
			})?.union,
		).toBe(true);
	});

	it("a shape without union still passes (undefined)", () => {
		expect(
			parseWithShape({ type: "SelectAllState", fields: [] })?.union,
		).toBeUndefined();
	});
});
