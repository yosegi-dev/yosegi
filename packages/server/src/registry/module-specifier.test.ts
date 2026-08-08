import { describe, expect, it } from "bun:test";
import { buildModuleSpecifierResolver } from "./module-specifier.ts";

const BASE = "/host/packages/frontend";

function resolver(paths: Record<string, string[]> | undefined) {
	return buildModuleSpecifierResolver({ paths, basePath: BASE });
}

describe("buildModuleSpecifierResolver", () => {
	it("alias に当たるファイルをホストが書く specifier へ直す", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve(`${BASE}/app/components/data-table.tsx`)).toBe(
			"~/components/data-table",
		);
	});

	it("拡張子を落とす", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve(`${BASE}/app/hooks/use-toast.ts`)).toBe("~/hooks/use-toast");
	});

	it("ディレクトリの index は specifier に残さない", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve(`${BASE}/app/components/email-input/index.tsx`)).toBe(
			"~/components/email-input",
		);
	});

	it("alias 直下の index は畳まない（alias そのものになってしまうため）", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve(`${BASE}/app/index.tsx`)).toBe("~/index");
	});

	it("複数の alias が当たる場合は substitution が深い方を採る", () => {
		// A combination that's common in a host's tsconfig. `*` matches every file, but
		// what the host actually writes is the `~/...` form.
		const resolve = resolver({ "~/*": ["./app/*"], "*": ["./*"] });
		expect(resolve(`${BASE}/app/components/button.tsx`)).toBe(
			"~/components/button",
		);
	});

	it("入れ子の alias はより具体的な方を採る", () => {
		const resolve = resolver({
			"~/*": ["./app/*"],
			"@ui/*": ["./app/components/ui/*"],
		});
		expect(resolve(`${BASE}/app/components/ui/button.tsx`)).toBe("@ui/button");
		expect(resolve(`${BASE}/app/components/card.tsx`)).toBe(
			"~/components/card",
		);
	});

	it("どの alias にも当たらないファイルは null", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve(`${BASE}/scripts/build.ts`)).toBeNull();
	});

	it("basePath の外にあるファイルは null", () => {
		const resolve = resolver({ "~/*": ["./app/*"] });
		expect(resolve("/other/app/components/button.tsx")).toBeNull();
	});

	it("paths を持たない tsconfig では常に null", () => {
		expect(resolver(undefined)(`${BASE}/app/components/button.tsx`)).toBeNull();
		expect(resolver({})(`${BASE}/app/components/button.tsx`)).toBeNull();
	});

	it("ワイルドカードを持たない 1 ファイル固定の指定も解く", () => {
		const resolve = resolver({ "~/test-setup": ["./test-setup.ts"] });
		expect(resolve(`${BASE}/test-setup.ts`)).toBe("~/test-setup");
		expect(resolve(`${BASE}/test-setup-other.ts`)).toBeNull();
	});

	it("pattern と substitution で `*` の有無が食い違う指定は使わない", () => {
		const resolve = resolver({ "~/*": ["./app/entry.tsx"] });
		expect(resolve(`${BASE}/app/entry.tsx`)).toBeNull();
	});

	it("substitution の接尾辞まで一致を要求する", () => {
		const resolve = resolver({ "@styles/*": ["./app/styles/*.css.ts"] });
		expect(resolve(`${BASE}/app/styles/button.css.ts`)).toBe("@styles/button");
		expect(resolve(`${BASE}/app/styles/button.ts`)).toBeNull();
	});
});
