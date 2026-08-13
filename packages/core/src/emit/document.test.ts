import { describe, expect, it } from "bun:test";
import type { ScreenVariant } from "../domain/screen-definition.ts";
import {
	assertEmittableNames,
	renderFixtures,
	renderJsdoc,
} from "./document.ts";

// Direct unit tests for the shared document helpers. The two emit targets also
// exercise them end to end (csf.test.ts / component.test.ts); these pin the
// helpers' own contract so a regression is reported here first, not through a
// target's full-file assertion.

function variant(name: string): ScreenVariant {
	return { name, operations: [] };
}

// The options every assertEmittableNames test starts from; individual tests
// override the field under test.
function names(overrides: Partial<Parameters<typeof assertEmittableNames>[0]>) {
	return assertEmittableNames({
		exportName: "Default",
		exportKind: "Story",
		fixtures: {},
		variants: [],
		reservedIdentifiers: ["meta", "Meta", "StoryObj"],
		...overrides,
	});
}

describe("renderFixtures", () => {
	it("挿入順の const 行を返し、複数行の値はタブでインデントする", () => {
		const lines = renderFixtures({
			customers: [{ name: "Sato" }],
			pageSize: 20,
		});
		expect(lines.join("\n")).toBe(
			[
				"const customers = [",
				"\t{",
				'\t\t"name": "Sato"',
				"\t}",
				"];",
				"const pageSize = 20;",
			].join("\n"),
		);
	});

	it("空の fixtures では何も返さない", () => {
		expect(renderFixtures({})).toEqual([]);
	});

	it("値は常に JSON リテラルとして書く", () => {
		// A string value must never land in a code position as-is.
		const lines = renderFixtures({ label: 'x"; import "./evil.ts"; //' });
		expect(lines).toEqual([
			'const label = "x\\"; import \\"./evil.ts\\"; //";',
		]);
	});

	it("JSON 表現を持たない値は throw する", () => {
		expect(() => renderFixtures({ bad: undefined })).toThrow(
			'Fixture "bad" has no JSON representation.',
		);
		expect(() => renderFixtures({ handler: () => null })).toThrow(
			'Fixture "handler" has no JSON representation.',
		);
	});
});

describe("renderJsdoc", () => {
	it("1 行の説明は 1 行の JSDoc になる", () => {
		expect(renderJsdoc("No customers yet.")).toEqual([
			"/** No customers yet. */",
		]);
	});

	it("複数行の説明はブロック形式になる", () => {
		expect(renderJsdoc("line 1\nline 2")).toEqual([
			"/**",
			" * line 1",
			" * line 2",
			" */",
		]);
	});

	// `*/` in the text would close the comment and spill the rest into a code position.
	it("説明中の */ はコメントを閉じない", () => {
		const lines = renderJsdoc("a */ b");
		expect(lines).toEqual(["/** a *\\/ b */"]);
		expect(lines.join("\n").split("*/").length - 1).toBe(1);
	});
});

describe("assertEmittableNames", () => {
	it("正当な名前の組み合わせは通す", () => {
		expect(() =>
			names({
				fixtures: { customers: [] },
				variants: [variant("Loading"), variant("Empty")],
			}),
		).not.toThrow();
	});

	it("識別子でない export 名を exportKind を先頭大文字にして拒否する", () => {
		expect(() => names({ exportName: "1st" })).toThrow(
			'Story name "1st" is not a valid JavaScript identifier',
		);
		expect(() => names({ exportName: "1st", exportKind: "component" })).toThrow(
			'Component name "1st" is not a valid JavaScript identifier',
		);
	});

	it("予約識別子・識別子でない fixture 名を予約リスト付きで拒否する", () => {
		expect(() => names({ fixtures: { meta: [] } })).toThrow(
			"not writable as a top-level const (it must be a JavaScript identifier other than meta / Meta / StoryObj)",
		);
		expect(() => names({ fixtures: { "customer-rows": [] } })).toThrow(
			"not writable as a top-level const",
		);
		// The reserved list is the caller's: the component target reserves
		// ReactElement instead of the CSF names.
		expect(() =>
			names({
				fixtures: { ReactElement: [] },
				reservedIdentifiers: ["ReactElement"],
			}),
		).toThrow("other than ReactElement");
	});

	it("export 名と衝突する fixture 名を exportKind 込みの文言で拒否する", () => {
		expect(() => names({ fixtures: { Default: [] } })).toThrow(
			"collides with the Story export name. Rename the fixture or pass a different story name.",
		);
		expect(() =>
			names({
				exportName: "Screen",
				exportKind: "component",
				fixtures: { Screen: [] },
			}),
		).toThrow(
			"collides with the component export name. Rename the fixture or pass a different component name.",
		);
	});

	it("variant 名の予約語・export 名衝突・fixture 衝突・重複を拒否する", () => {
		expect(() => names({ variants: [variant("meta")] })).toThrow(
			'Variant name "meta" is not writable as a Story export',
		);
		expect(() => names({ variants: [variant("Default")] })).toThrow(
			"collides with the Story export name",
		);
		expect(() =>
			names({ fixtures: { Empty: [] }, variants: [variant("Empty")] }),
		).toThrow("collides with a fixture name");
		expect(() =>
			names({ variants: [variant("Empty"), variant("Empty")] }),
		).toThrow('Variant name "Empty" is used more than once');
	});
});
