import { describe, expect, it } from "bun:test";
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

	it("カテゴリで絞り込む", () => {
		const found = service().searchComponents({ category: "form" });
		expect(found.map((c) => c.id).sort()).toEqual(["SearchForm", "TextField"]);
	});

	it("カテゴリ一覧を返す", () => {
		expect(service().listCategories()).toContain("shadcn-ui");
	});
});
