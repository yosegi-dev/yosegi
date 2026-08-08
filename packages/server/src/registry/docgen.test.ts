import { describe, expect, it } from "bun:test";
import {
	formatDocgenLoadFailure,
	loadDocgen,
	resolveExtractorTypeScript,
} from "./docgen.ts";

const ALIAS_COMMAND = "npm install -D typescript@npm:@typescript/typescript6";

describe("loadDocgen", () => {
	it("読み込みに成功すると withCompilerOptions が使える", () => {
		expect(typeof loadDocgen().withCompilerOptions).toBe("function");
	});

	it("抽出器が解決した typescript を報告できる", () => {
		const resolved = resolveExtractorTypeScript();
		expect(resolved).not.toBeNull();
		expect(resolved).toContain("@");
	});
});

describe("formatDocgenLoadFailure", () => {
	it("TypeScript 7 なら互換パッケージのコマンドを示す", () => {
		const message = formatDocgenLoadFailure("typescript@7.0.2", "boom");
		expect(message).toContain("typescript@7.0.2");
		expect(message).toContain(ALIAS_COMMAND);
		expect(message).toContain("boom");
	});

	// The alias is the wrong advice below 7, where the API is present and the failure is
	// something else entirely.
	it("TypeScript 6 では互換パッケージを勧めない", () => {
		const message = formatDocgenLoadFailure("typescript@6.0.3", "boom");
		expect(message).toContain("typescript@6.0.3");
		expect(message).not.toContain(ALIAS_COMMAND);
	});

	it("解決先が不明なら推測せず原因だけを伝える", () => {
		const message = formatDocgenLoadFailure(null, "boom");
		expect(message).not.toContain(ALIAS_COMMAND);
		expect(message).toContain("Underlying error: boom");
	});
});
