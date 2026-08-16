import { describe, expect, it } from "bun:test";
import {
	formatDocgenLoadFailure,
	loadDocgen,
	resolveExtractorTypeScript,
} from "./docgen.ts";

// Both entries, in one command: `typescript` alone would leave the host without a `tsc`.
const ALIAS_COMMAND =
	"npm install -D @typescript/native@npm:typescript typescript@npm:@typescript/typescript6";

// bun cannot resolve the alias above, so it gets the 6.x compiler as a direct dependency.
const BUN_COMMAND =
	"bun add -d @typescript/native@npm:typescript typescript@^6";

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

	// The extractor fails on the same host state as typescript.ts, so it has to carry the
	// same bun caveat rather than sending a bun host at the alias alone.
	it("TypeScript 7 なら bun 向けの直接依存も併記する", () => {
		const message = formatDocgenLoadFailure("typescript@7.0.2", "boom");
		expect(message).toContain(BUN_COMMAND);
	});

	// The alias is the wrong advice below 7, where the API is present and the failure is
	// something else entirely.
	it("TypeScript 6 では互換パッケージを勧めない", () => {
		const message = formatDocgenLoadFailure("typescript@6.0.3", "boom");
		expect(message).toContain("typescript@6.0.3");
		expect(message).not.toContain(ALIAS_COMMAND);
		expect(message).not.toContain(BUN_COMMAND);
	});

	it("解決先が不明なら推測せず原因だけを伝える", () => {
		const message = formatDocgenLoadFailure(null, "boom");
		expect(message).not.toContain(ALIAS_COMMAND);
		expect(message).not.toContain(BUN_COMMAND);
		expect(message).toContain("Underlying error: boom");
	});
});
