import { describe, expect, it } from "bun:test";
import { parseMetaTemplate } from "./meta-template.ts";

// A boilerplate file (fragment) written by the host. Real hosts place their AGENTS.md conventions in this shape.
const FRAGMENT = `import type { Meta } from "@storybook/react-vite";
import { DesignDocsPage } from "~/components/storybook/design-docs-page";

/**
 * 画面モック。
 */
const meta: Meta = {
	title: "Examples/Placeholder",
	tags: ["autodocs"],
	parameters: {
		docs: { page: DesignDocsPage },
	},
};

export default meta;
`;

describe("parseMetaTemplate", () => {
	it("meta のプロパティ・JSDoc・import を取り出す", () => {
		const { template } = parseMetaTemplate(FRAGMENT, "meta-template.tsx");
		expect(template.properties).toEqual([
			'tags: ["autodocs"]',
			"parameters: {\n\tdocs: { page: DesignDocsPage },\n}",
		]);
		expect(template.jsdoc).toBe("/**\n * 画面モック。\n */");
		expect(template.imports).toEqual([
			'import { DesignDocsPage } from "~/components/storybook/design-docs-page";',
		]);
	});

	// title comes from `--title`; component is decided by Yosegi because a screen isn't a single component.
	it("title / component は引き継がず警告に出す", () => {
		const { template, warnings } = parseMetaTemplate(
			`import { Button } from "~/components/shadcn-ui/button";
const meta = {
	title: "Components/Button",
	component: Button,
	tags: ["autodocs"],
};
`,
			"copy-source.stories.tsx",
		);
		expect(template.properties).toEqual(['tags: ["autodocs"]']);
		expect(warnings.some((warning) => warning.includes('"title"'))).toBe(true);
		expect(warnings.some((warning) => warning.includes('"component"'))).toBe(
			true,
		);
	});

	// Using a copy-source Story as the template drags in that component's own import too.
	it("引き継いだ meta から参照されない import は落とす", () => {
		const { template, warnings } = parseMetaTemplate(
			`import { Button } from "~/components/shadcn-ui/button";
import "~/styles/storybook.css";
const meta = {
	component: Button,
	tags: ["autodocs"],
};
`,
			"copy-source.stories.tsx",
		);
		// A side-effect import can't be judged for reference, so it's kept.
		expect(template.imports).toEqual(['import "~/styles/storybook.css";']);
		expect(warnings.some((warning) => warning.includes("Button"))).toBe(true);
	});

	// The emitter always writes these, so the template's own Meta / StoryObj is dropped to avoid duplicates.
	it("Meta / StoryObj の型 import は引き継がない", () => {
		const { template } = parseMetaTemplate(FRAGMENT, "meta-template.tsx");
		expect(template.imports?.some((entry) => entry.includes("Meta"))).toBe(
			false,
		);
	});

	// A copy-source Story's Figma URL can't possibly belong to the screen being built.
	// Silently carrying it over would fabricate "information that doesn't exist," so we call it out instead.
	it("引き継いだ URL は警告で名指しする", () => {
		const { warnings } = parseMetaTemplate(
			`const meta = {
	/**
	 * Figma: https://www.figma.com/design/abc?node-id=1-2
	 */
	tags: ["autodocs"],
	parameters: { design: { url: "https://www.figma.com/design/abc?node-id=1-2" } },
};
`,
			"copy-source.stories.tsx",
		);
		expect(
			warnings.some((warning) =>
				warning.includes("https://www.figma.com/design/abc?node-id=1-2"),
			),
		).toBe(true);
	});

	it("export default のオブジェクトも meta として読む", () => {
		const { template } = parseMetaTemplate(
			`export default {
	tags: ["autodocs"],
};
`,
			"default-export.tsx",
		);
		expect(template.properties).toEqual(['tags: ["autodocs"]']);
	});

	it("meta が無いファイルは直し方を添えて throw する", () => {
		expect(() =>
			parseMetaTemplate("export const x = 1;\n", "broken.tsx"),
		).toThrow(/has no meta object/);
	});
});
