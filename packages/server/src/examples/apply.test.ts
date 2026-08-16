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
