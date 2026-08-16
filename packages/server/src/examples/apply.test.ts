import { describe, expect, it } from "bun:test";
import { renameByIdentifierBoundary, renameComponent } from "./apply.ts";

// A template holding every way the old text can appear without being the component: as the
// prefix of two other identifiers, inside a comment, and inside a string literal.
const COLLIDING = [
	'import type { ScreenExampleProps } from "~/props";',
	'import { ScreenExampleHeader } from "~/header";',
	"",
	"// ScreenExample is the template this came from.",
	'const label = "ScreenExample";',
	"",
	"export function ScreenExample(props: ScreenExampleProps) {",
	"\treturn <ScreenExampleHeader title={label} {...props} />;",
	"}",
	"",
].join("\n");

// The same text in every position that is not a reference to the binding: a JSX attribute
// name, a property key, a type member, a class member, and a property access.
const MEMBER_POSITIONS = [
	'import { Card } from "~/card";',
	"",
	"type Props = { ScreenExample: string };",
	"",
	"class Registry {",
	"\tScreenExample() {}",
	"}",
	"",
	"const config = { ScreenExample: 1 };",
	"",
	"export function ScreenExample(props: Props) {",
	"\treturn <Card ScreenExample={config.ScreenExample} {...props} />;",
	"}",
	"",
].join("\n");

describe("renameComponent", () => {
	it("宣言とその参照だけを置換する", () => {
		const result = renameComponent(
			COLLIDING,
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(result.structural).toBe(true);
		expect(result.declared).toBe(true);
		expect(result.source).toContain("export function GuestRoute(");
	});

	// The bug a plain replaceAll causes: the import is rewritten to a name the module it
	// comes from does not export, and the copy stops compiling.
	it("部分文字列として含む別識別子は置換しない", () => {
		const { source } = renameComponent(
			COLLIDING,
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(source).toContain(
			'import type { ScreenExampleProps } from "~/props";',
		);
		expect(source).toContain('import { ScreenExampleHeader } from "~/header";');
		expect(source).not.toContain("GuestRouteProps");
		expect(source).not.toContain("GuestRouteHeader");
	});

	it("コメントと文字列リテラルは置換しない", () => {
		const { source } = renameComponent(
			COLLIDING,
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(source).toContain(
			"// ScreenExample is the template this came from.",
		);
		expect(source).toContain('const label = "ScreenExample";');
	});

	// Prose is not a declaration, which is what separates "the catalog is stale" from "the
	// template really does export this".
	it("名前がコメントにしか無ければ declared は false", () => {
		const result = renameComponent(
			"// OnlyProse lived here.\nexport function Kept() {\n\treturn null;\n}\n",
			"screen.tsx",
			"OnlyProse",
			"GuestRoute",
		);
		expect(result.declared).toBe(false);
		expect(result.occurrences).toBe(0);
		expect(result.source).toContain("// OnlyProse lived here.");
	});

	// JSX attribute names and property keys carry the text without referring to the binding,
	// so rewriting them would change what the component is passed and what shape it expects.
	it("JSX 属性名・プロパティキー・メンバー名は置換しない", () => {
		const { source, declared } = renameComponent(
			MEMBER_POSITIONS,
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(declared).toBe(true);
		// Only the declaration moves.
		expect(source).toContain("export function GuestRoute(props: Props)");
		// Everything that is a name rather than a reference stays.
		expect(source).toContain("type Props = { ScreenExample: string };");
		expect(source).toContain("\tScreenExample() {}");
		expect(source).toContain("const config = { ScreenExample: 1 };");
		expect(source).toContain(
			"<Card ScreenExample={config.ScreenExample} {...props} />",
		);
		expect(source).not.toContain("GuestRoute={");
		expect(source).not.toContain("config.GuestRoute");
		expect(source).not.toContain("{ GuestRoute:");
	});

	// A local inside another function is not the exported component, so the template
	// declares nothing to rename and the copy comes through untouched.
	it("ネストした宣言だけではドリフト扱いになる", () => {
		const result = renameComponent(
			[
				"export function Other() {",
				"\tconst ScreenExample = 1;",
				"\treturn ScreenExample;",
				"}",
				"",
			].join("\n"),
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(result.declared).toBe(false);
		expect(result.occurrences).toBe(0);
		expect(result.source).toContain("const ScreenExample = 1;");
		expect(result.source).not.toContain("GuestRoute");
	});

	// Top level but never exported: not the component the catalog is pointing at.
	it("export されていないトップレベル宣言はドリフト扱いになる", () => {
		const result = renameComponent(
			"const ScreenExample = 1;\nexport function Other() {\n\treturn ScreenExample;\n}\n",
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(result.declared).toBe(false);
		expect(result.source).not.toContain("GuestRoute");
	});

	// An imported name belongs to the module it comes from; renaming either half asks that
	// module for an export it does not have.
	it("import 由来の名前は宣言として扱わない", () => {
		const result = renameComponent(
			'import { ScreenExample } from "~/elsewhere";\nexport default ScreenExample;\n',
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(result.declared).toBe(false);
		expect(result.source).toContain(
			'import { ScreenExample } from "~/elsewhere";',
		);
	});

	// `export { local as Public }` — the local half is the binding, the alias is the name the
	// outside sees and is not ours to change.
	it("export エイリアスは変えずローカル名だけ置換する", () => {
		const { source, declared } = renameComponent(
			"function ScreenExample() {\n\treturn null;\n}\nexport { ScreenExample as Screen };\n",
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(declared).toBe(true);
		expect(source).toContain("function GuestRoute()");
		expect(source).toContain("export { GuestRoute as Screen };");
	});

	it("const で宣言されたコンポーネントも declared になる", () => {
		const result = renameComponent(
			"const ScreenExample = () => null;\nexport default ScreenExample;\n",
			"screen.tsx",
			"ScreenExample",
			"GuestRoute",
		);
		expect(result.declared).toBe(true);
		expect(result.occurrences).toBe(2);
		expect(result.source).toBe(
			"const GuestRoute = () => null;\nexport default GuestRoute;\n",
		);
	});
});

describe("renameByIdentifierBoundary", () => {
	// The fallback's one job: still refuse the substring, so the copy compiles even on a
	// host with no compiler API.
	it("部分文字列として含む別識別子は置換しない", () => {
		const { source } = renameByIdentifierBoundary(
			COLLIDING,
			"ScreenExample",
			"GuestRoute",
		);
		expect(source).toContain(
			'import type { ScreenExampleProps } from "~/props";',
		);
		expect(source).not.toContain("GuestRouteProps");
		expect(source).toContain("export function GuestRoute(");
	});

	// The limit it cannot escape without a parser, and the reason apply warns when it runs.
	it("コメントと文字列リテラルも置換してしまう", () => {
		const { source, structural } = renameByIdentifierBoundary(
			COLLIDING,
			"ScreenExample",
			"GuestRoute",
		);
		expect(structural).toBe(false);
		expect(source).toContain("// GuestRoute is the template this came from.");
		expect(source).toContain('const label = "GuestRoute";');
	});
});
