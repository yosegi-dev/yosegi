import { describe, expect, it } from "bun:test";
import {
	buildRegistryFromStorybook,
	type StorybookIndex,
} from "./storybook-registry.ts";

function sampleIndex(): StorybookIndex {
	return {
		v: 5,
		entries: {
			"shadcn-ui-button--playground": {
				type: "story",
				id: "shadcn-ui-button--playground",
				name: "Playground",
				title: "shadcn-ui/Button",
				importPath: "./app/components/shadcn-ui/button.stories.tsx",
				componentPath: "./app/components/shadcn-ui/button.tsx",
				tags: ["autodocs", "stable"],
			},
			"shadcn-ui-button--variant": {
				type: "story",
				id: "shadcn-ui-button--variant",
				name: "Variant",
				title: "shadcn-ui/Button",
				importPath: "./app/components/shadcn-ui/button.stories.tsx",
				tags: ["stable"],
			},
			"shadcn-ui-button--docs": {
				type: "docs",
				id: "shadcn-ui-button--docs",
				name: "Docs",
				title: "shadcn-ui/Button",
				importPath: "./app/components/shadcn-ui/button.stories.tsx",
			},
			"legacy-banner--default": {
				type: "story",
				id: "legacy-banner--default",
				name: "Default",
				title: "legacy/Banner",
				importPath: "./app/components/legacy/banner.stories.tsx",
				tags: ["deprecated"],
			},
		},
	};
}

describe("buildRegistryFromStorybook", () => {
	it("title 単位でコンポーネントを集約する", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const hostIds = registry.components
			.filter((c) => c.category !== "synthetic")
			.map((c) => c.id);
		expect(hostIds).toEqual(["Banner", "Button"]);
	});

	it("category を title の先頭セグメントから決める", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.category).toBe("shadcn-ui");
	});

	it("deprecated タグを constraints へ反映する", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const banner = registry.components.find((c) => c.id === "Banner");
		expect(banner?.constraints?.deprecated).toBe(true);
	});

	it("storybookBaseUrl からディープリンクを生成する", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			storybookBaseUrl: "https://sb.example.com/",
		});
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.references?.storybook).toBe(
			"https://sb.example.com/?path=/story/shadcn-ui-button--playground",
		);
	});

	it("明示メタデータで Props / Slot を補完する", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			metadata: {
				Button: {
					props: { variant: { kind: "enum", options: ["default", "ghost"] } },
					slots: {},
				},
			},
		});
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.props.variant?.kind).toBe("enum");
	});

	it("version 未指定なら内容ハッシュが決定的", () => {
		const a = buildRegistryFromStorybook(sampleIndex());
		const b = buildRegistryFromStorybook(sampleIndex());
		expect(a.version).toBe(b.version);
		expect(a.version.startsWith("sha:")).toBe(true);
	});

	it("version 明示時はそれを使う", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			version: "git:abc1234",
		});
		expect(registry.version).toBe("git:abc1234");
	});

	it("末尾セグメントが衝突する title は id を title 全体へ寄せる", () => {
		const index = sampleIndex();
		// Adding legacy/Button collides with shadcn-ui/Button on the trailing segment "Button".
		index.entries["legacy-button--default"] = {
			type: "story",
			id: "legacy-button--default",
			name: "Default",
			title: "legacy/Button",
			importPath: "./app/components/legacy/button.stories.tsx",
		};
		const registry = buildRegistryFromStorybook(index);
		const ids = registry.components.map((c) => c.id);
		expect(ids).toContain("shadcn-ui/Button");
		expect(ids).toContain("legacy/Button");
		// Banner, which has no collision, keeps its trailing segment.
		expect(ids).toContain("Banner");
		expect(ids).not.toContain("Button");
	});

	it("id を退避しても name と exportName は末尾セグメントのまま", () => {
		const index = sampleIndex();
		index.entries["legacy-button--default"] = {
			type: "story",
			id: "legacy-button--default",
			name: "Default",
			title: "legacy/Button",
			importPath: "./app/components/legacy/button.stories.tsx",
		};
		const registry = buildRegistryFromStorybook(index);
		const button = registry.components.find((c) => c.id === "shadcn-ui/Button");
		expect(button?.name).toBe("Button");
		expect(button?.import.exportName).toBe("Button");
	});

	it("衝突解決の結果が index.json の列挙順に依存しない", () => {
		const index = sampleIndex();
		index.entries["legacy-button--default"] = {
			type: "story",
			id: "legacy-button--default",
			name: "Default",
			title: "legacy/Button",
			importPath: "./app/components/legacy/button.stories.tsx",
		};
		const reversed: StorybookIndex = {
			v: index.v,
			entries: Object.fromEntries(Object.entries(index.entries).reverse()),
		};
		// What we're protecting is that "which side gets the short id" doesn't depend on
		// enumeration order. curation keeps Storybook's declaration order (= the order of
		// Story names) as-is, so it's excluded from the version comparison.
		expect(
			buildRegistryFromStorybook(reversed).components.map((c) => c.id),
		).toEqual(buildRegistryFromStorybook(index).components.map((c) => c.id));
	});

	it("componentPath を持つ Story が先頭でなくても実装ファイルを採用する", () => {
		const index = sampleIndex();
		// Enumerate Variant (no componentPath) before Playground (which has one).
		index.entries = Object.fromEntries(
			Object.entries(index.entries).reverse(),
		) as StorybookIndex["entries"];
		const registry = buildRegistryFromStorybook(index);
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.import.packageName).toBe(
			"./app/components/shadcn-ui/button.tsx",
		);
	});

	it("合成プリミティブを常に含める", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const ids = registry.components.map((c) => c.id);
		expect(ids).toContain("Text");
		expect(ids).toContain("Box");
		expect(ids).toContain("Heading");
	});

	it("ホストが同じ id を持つ場合は合成プリミティブより優先する", () => {
		const index = sampleIndex();
		index.entries["typography-text--default"] = {
			type: "story",
			id: "typography-text--default",
			name: "Default",
			title: "Components/Text",
			importPath: "./app/components/text.stories.tsx",
			componentPath: "./app/components/text.tsx",
		};
		const registry = buildRegistryFromStorybook(index);
		const text = registry.components.filter((c) => c.id === "Text");
		expect(text).toHaveLength(1);
		expect(text[0]?.import.packageName).toBe("./app/components/text.tsx");
	});

	// index.json has no argTypes and gives no basis for judging whether a given part
	// accepts className / children. Defaulting them on would make the Registry report
	// props / slots it doesn't actually accept.
	it("明示メタデータが無ければ Props / Slot は空にする", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.props).toEqual({});
		expect(button?.slots).toEqual({});
	});

	it("明示メタデータで指定した Props / Slot だけを載せる", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			metadata: {
				Button: {
					props: { className: { kind: "string" } },
					slots: { icon: { maxItems: 1 } },
				},
			},
		});
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.props.className?.kind).toBe("string");
		expect(button?.slots.icon?.maxItems).toBe(1);
		// children, which wasn't specified, isn't added.
		expect(button?.slots.children).toBeUndefined();
	});

	it("title に一致しない明示メタデータを追加コンポーネントとして登録する", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			metadata: {
				Heading: {
					category: "Components",
					import: {
						packageName: "./app/components/typography.tsx",
						exportName: "Heading",
					},
					props: { size: { kind: "enum", options: ["md", "lg"] } },
				},
			},
		});
		const heading = registry.components.find((c) => c.id === "Heading");
		expect(heading?.import.exportName).toBe("Heading");
		expect(heading?.category).toBe("Components");
		// An added component also has only the props that were specified.
		expect(Object.keys(heading?.props ?? {})).toEqual(["size"]);
		expect(heading?.slots).toEqual({});
	});

	it("追加コンポーネントは同じ id の合成プリミティブを置き換える", () => {
		const registry = buildRegistryFromStorybook(sampleIndex(), {
			metadata: {
				Heading: {
					import: {
						packageName: "./app/components/typography.tsx",
						exportName: "Heading",
					},
				},
			},
		});
		const headings = registry.components.filter((c) => c.id === "Heading");
		expect(headings).toHaveLength(1);
		expect(headings[0]?.import.packageName).toBe(
			"./app/components/typography.tsx",
		);
	});

	it("title にも一致せず import も無い明示メタデータはエラーにする", () => {
		expect(() =>
			buildRegistryFromStorybook(sampleIndex(), {
				metadata: { Buton: { props: { size: { kind: "string" } } } },
			}),
		).toThrow(/Buton/);
	});
});

describe("buildRegistryFromStorybook の Story 情報", () => {
	it("Story ファイルと Story 名を curation に残す", () => {
		const registry = buildRegistryFromStorybook(sampleIndex());
		const button = registry.components.find((c) => c.id === "Button");
		expect(button?.curation?.storyFile).toBe(
			"./app/components/shadcn-ui/button.stories.tsx",
		);
		expect(button?.curation?.storyNames).toEqual(["Playground", "Variant"]);
		expect(button?.curation?.storyCount).toBe(2);
	});
});
