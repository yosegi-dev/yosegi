import { describe, expect, it } from "bun:test";
import { ComposerError } from "../domain/errors.ts";
import { sampleRegistry } from "../test-fixtures.ts";
import { ComponentService } from "./component-service.ts";

function service(): ComponentService {
	return new ComponentService(sampleRegistry());
}

describe("ComponentService", () => {
	it("Registry Version を返す", () => {
		expect(service().getRegistryVersion()).toBe("test:v1");
	});

	it("id でコンポーネントを取得する", () => {
		expect(service().getComponent("Button")?.name).toBe("Button");
		expect(service().getComponent("Nope")).toBe(null);
	});

	it("キーワードで検索する", () => {
		const found = service().searchComponents({ query: "button" });
		expect(found.map((c) => c.id)).toContain("Button");
	});

	// Several queries are OR'd together, so a caller unsure of the exact name can pass
	// multiple guesses in one call instead of round-tripping per guess.
	it("query を複数渡すと OR で検索する", () => {
		const found = service().searchComponents({ query: ["button", "table"] });
		expect(found.map((c) => c.id).sort()).toEqual(["Button", "Table"]);
	});

	// A single-string query keeps behaving exactly as before array support was added.
	it("query が単一の文字列でも従来どおり動く", () => {
		const found = service().searchComponents({ query: "table" });
		expect(found.map((c) => c.id)).toEqual(["Table"]);
	});

	// The suggestion lives on the error itself, so every adapter (CLI / MCP / HTTP)
	// surfaces the same candidates without re-deriving them.
	it("requireComponent は typo に候補付き COMPONENT_NOT_FOUND を投げる", () => {
		let caught: unknown;
		try {
			service().requireComponent("Buton");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ComposerError);
		const composerError = caught as ComposerError;
		expect(composerError.code).toBe("COMPONENT_NOT_FOUND");
		expect(composerError.suggestion).toContain("Button");
	});

	it("requireComponent は候補がなければ suggestion を null にする", () => {
		let caught: unknown;
		try {
			service().requireComponent("zzzzzzzz");
		} catch (error) {
			caught = error;
		}
		expect((caught as ComposerError).suggestion).toBe(null);
	});

	it("カテゴリで絞り込む", () => {
		const found = service().searchComponents({ category: "form" });
		expect(found.map((c) => c.id).sort()).toEqual(["SearchForm", "TextField"]);
	});

	it("カテゴリ一覧を返す", () => {
		expect(service().listCategories()).toContain("shadcn-ui");
	});
});
