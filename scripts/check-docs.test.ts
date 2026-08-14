import { describe, expect, it } from "bun:test";
import { checkDocs, eastAsianWidth, slugify } from "./check-docs.ts";

const never = (): boolean => false;

describe("eastAsianWidth", () => {
	it("ASCII は 1 桁で数える", () => {
		expect(eastAsianWidth("abc 123")).toBe(7);
	});

	it("全角文字は 2 桁で数える", () => {
		expect(eastAsianWidth("日本語")).toBe(6);
		expect(eastAsianWidth("カナと（記号）")).toBe(14);
	});

	it("和欧混在の行を実際の表示幅で数える", () => {
		expect(eastAsianWidth("props は型から決まる")).toBe(20);
	});

	// The em dash is East Asian Ambiguous; the pages were wrapped treating it
	// as narrow, so the checker has to agree.
	it("em ダッシュ（—）は 1 桁で数える", () => {
		expect(eastAsianWidth("——")).toBe(2);
	});
});

describe("slugify", () => {
	it("英語見出しを小文字とハイフンに落とす", () => {
		expect(slugify("Hosts on TypeScript 7")).toBe("hosts-on-typescript-7");
	});

	it("日本語見出しの文字を保つ", () => {
		expect(slugify("検証エラーの code")).toBe("検証エラーの-code");
	});

	it("記号を落とす", () => {
		expect(slugify("`registry build`")).toBe("registry-build");
	});
});

describe("checkDocs", () => {
	const en = (body: string) => `# Page\n\n${body}\n`;

	it("整合したページには何も報告しない", () => {
		const { errors, widthErrors } = checkDocs(
			[
				{ path: "docs/page.md", text: en("See [other](./other.md#a-b).") },
				{ path: "docs/other.md", text: "# Other\n\n## A b\n\ntext\n" },
				{ path: "docs/ja/page.md", text: en("[other](./other.md) を参照。") },
				{ path: "docs/ja/other.md", text: "# Other\n\n## A b\n\n本文\n" },
			],
			never,
		);
		expect(errors).toEqual([]);
		expect(widthErrors).toEqual([]);
	});

	it("存在しないファイルへのリンクを報告する", () => {
		const { errors } = checkDocs(
			[
				{ path: "docs/page.md", text: en("See [gone](./gone.md).") },
				{ path: "docs/ja/page.md", text: en("[gone](./gone.md) を参照。") },
			],
			never,
		);
		expect(errors).toContain("docs/page.md: missing file -> ./gone.md");
	});

	it("map の外のファイルは exists で解決する", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/ja/page.md",
					text: en("[skill](../../skills/x/SKILL.md)"),
				},
			],
			(path) => path === "skills/x/SKILL.md",
		);
		expect(errors).toEqual([]);
	});

	it("存在しないアンカーを報告する", () => {
		const { errors } = checkDocs(
			[
				{ path: "docs/page.md", text: en("See [other](./other.md#missing).") },
				{ path: "docs/other.md", text: "# Other\n\n## Present\n" },
				{ path: "docs/ja/page.md", text: en("ja") },
				{ path: "docs/ja/other.md", text: "# Other\n\n## Present\n" },
			],
			never,
		);
		expect(errors).toContain(
			"docs/page.md: missing anchor -> ./other.md#missing",
		);
	});

	// A backticked link example is documentation about links, not a link.
	it("インラインコード内のリンクは無視する", () => {
		const { errors } = checkDocs(
			[
				{ path: "docs/page.md", text: en("Write `[x](./gone.md)` to link.") },
				{
					path: "docs/ja/page.md",
					text: en("リンクは `[x](./gone.md)` と書く。"),
				},
			],
			never,
		);
		expect(errors).toEqual([]);
	});

	it("日本語の対が無いページを報告する", () => {
		const { errors } = checkDocs(
			[{ path: "docs/page.md", text: en("body") }],
			never,
		);
		expect(errors).toContain("docs/page.md: no Japanese twin");
	});

	it("README.md の対は README.ja.md", () => {
		const { errors } = checkDocs(
			[{ path: "README.md", text: en("body") }],
			never,
		);
		expect(errors).toContain("README.md: no Japanese twin");
	});

	it("見出し・フェンス・表の行数の食い違いを報告する", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: "# Page\n\n## Extra\n\n| a |\n| - |\n\n```sh\nx\n```\n",
				},
				{ path: "docs/ja/page.md", text: "# Page\n\n| a |\n| - |\n| b |\n" },
			],
			never,
		);
		expect(errors).toContain(
			"docs/page.md vs docs/ja/page.md: headings 2 != 1",
		);
		expect(errors).toContain("docs/page.md vs docs/ja/page.md: fences 1 != 0");
		expect(errors).toContain(
			"docs/page.md vs docs/ja/page.md: table rows 2 != 3",
		);
	});

	it("同数でも内容が食い違うフェンスを報告する", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: en("```sh\nyosegi registry build\n```"),
				},
				{
					path: "docs/ja/page.md",
					text: en("```sh\nyosegi registry check\n```"),
				},
			],
			never,
		);
		expect(errors).toEqual([
			'docs/page.md vs docs/ja/page.md: fence 1 content "yosegi registry build" != "yosegi registry check"',
		]);
	});

	it("info string が食い違うフェンスを報告する", () => {
		const { errors } = checkDocs(
			[
				{ path: "docs/page.md", text: en("```sh\nx\n```") },
				{ path: "docs/ja/page.md", text: en("```ts\nx\n```") },
			],
			never,
		);
		expect(errors).toEqual([
			'docs/page.md vs docs/ja/page.md: fence 1 info "sh" != "ts"',
		]);
	});

	// Comments inside a code block are translated (docs/conventions.md), so
	// comment text — including a translation re-wrapped onto a different number
	// of lines — must not read as a content mismatch.
	it("フェンス内の訳されたコメントは内容差に数えない", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: en(
						"```sh\n# Build the registry from your types\nyosegi registry build # from types\n```",
					),
				},
				{
					path: "docs/ja/page.md",
					text: en(
						"```sh\n# 型から Component Registry を\n# 作る（2 行に折り返す）\n\nyosegi registry build # 型から\n```",
					),
				},
			],
			never,
		);
		expect(errors).toEqual([]);
	});

	// A diagram's labels are translated (docs/conventions.md); its structure is
	// what has to match.
	it("mermaid フェンスの訳されたラベルは内容差に数えない", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: en(
						'```mermaid\nflowchart TD\n  a["Write it directly"] -->|"valid"| b["A Story"]\n```',
					),
				},
				{
					path: "docs/ja/page.md",
					text: en(
						'```mermaid\nflowchart TD\n  a["直接書く"] -->|"検証を通る"| b["Story"]\n```',
					),
				},
			],
			never,
		);
		expect(errors).toEqual([]);
	});

	// A diagram carries `%%` comments and blank lines for the same reason a code
	// block carries `#` ones, and a translation re-wraps them.
	it("mermaid フェンスの %% コメントと空行は内容差に数えない", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: en(
						'```mermaid\n%% the upstream half\nflowchart TD\n\n  a["x"] --> b["y"]\n```',
					),
				},
				{
					path: "docs/ja/page.md",
					text: en(
						'```mermaid\nflowchart TD\n  %% 上流の半分\n  %% 2 行に折り返す\n  a["x"] --> b["y"]\n\n```',
					),
				},
			],
			never,
		);
		expect(errors).toEqual([]);
	});

	it("mermaid フェンスの構造の食い違いは報告する", () => {
		const { errors } = checkDocs(
			[
				{
					path: "docs/page.md",
					text: en('```mermaid\nflowchart TD\n  a["x"] --> b["y"]\n```'),
				},
				{
					path: "docs/ja/page.md",
					text: en('```mermaid\nflowchart TD\n  a["x"] --> c["y"]\n```'),
				},
			],
			never,
		);
		expect(errors).toEqual([
			'docs/page.md vs docs/ja/page.md: fence 1 content "  a[""] --> b[""]" != "  a[""] --> c[""]"',
		]);
	});

	it("東アジア文字幅で 100 桁を超えた行を報告する", () => {
		const long = "あ".repeat(51);
		const { widthErrors } = checkDocs(
			[{ path: "docs/ja/page.md", text: en(long) }],
			never,
		);
		expect(widthErrors).toEqual([
			`docs/ja/page.md:3: 102 columns (limit ${100})`,
		]);
	});

	it("表・コードブロック・front matter は幅の検査から除く", () => {
		const long = "あ".repeat(51);
		const text = `---\ntagline: ${long}\n---\n\n| ${long} |\n\n\`\`\`sh\n${long}\n\`\`\`\n`;
		const { widthErrors } = checkDocs(
			[{ path: "docs/ja/page.md", text }],
			never,
		);
		expect(widthErrors).toEqual([]);
	});

	it("~~~ フェンス内のリンクと長行も検査から除く", () => {
		const long = "あ".repeat(51);
		const text = `# Page\n\n~~~md\n[example](./missing.md)\n${long}\n~~~\n`;
		const { errors, widthErrors } = checkDocs(
			[{ path: "docs/ja/page.md", text }],
			never,
		);
		expect(errors).toEqual([]);
		expect(widthErrors).toEqual([]);
	});

	// CommonMark allows a fence to be indented by up to three spaces, as under
	// a list item; its contents are still code, not prose.
	it("インデントされたフェンス内のリンクと長行も検査から除く", () => {
		const long = "あ".repeat(51);
		for (const marker of ["```", "~~~"]) {
			const text = `# Page\n\n-  a\n\n   ${marker}md\n   [example](./missing.md)\n   ${long}\n   ${marker}\n`;
			const { errors, widthErrors } = checkDocs(
				[{ path: "docs/ja/page.md", text }],
				never,
			);
			expect(errors).toEqual([]);
			expect(widthErrors).toEqual([]);
		}
	});

	// CommonMark closes a fence only with the opener's character, so a backtick
	// run inside a tilde fence is content, not a boundary.
	it("~~~ フェンスはバッククォートでは閉じない", () => {
		const text = "# Page\n\n~~~md\n```\n[example](./missing.md)\n```\n~~~\n";
		const { errors } = checkDocs([{ path: "docs/ja/page.md", text }], never);
		expect(errors).toEqual([]);
	});

	// GFM does not require the outer pipes, so `name | description` tables are
	// tables too; the delimiter row is what identifies them.
	it("外側パイプの無い表も幅の検査から除く", () => {
		const long = "あ".repeat(51);
		const text = en(`名前 | 説明\n--- | ---\n${long} | 値\n\n${long}`);
		const { widthErrors } = checkDocs(
			[{ path: "docs/ja/page.md", text }],
			never,
		);
		// The prose line after the table is still checked.
		expect(widthErrors).toEqual([
			`docs/ja/page.md:7: 102 columns (limit ${100})`,
		]);
	});

	// A lone thematic break must not turn the paragraph above it into a table.
	it("--- 単独の行は表の区切りとして扱わない", () => {
		const long = `${"あ".repeat(50)} | x`;
		const text = en(`${long}\n\n---`);
		const { widthErrors } = checkDocs(
			[{ path: "docs/ja/page.md", text }],
			never,
		);
		expect(widthErrors).toEqual([
			`docs/ja/page.md:3: 104 columns (limit ${100})`,
		]);
	});

	it("docs の外のファイルは幅を検査しない", () => {
		const { widthErrors } = checkDocs(
			[{ path: "AGENTS.md", text: en("a".repeat(120)) }],
			never,
		);
		expect(widthErrors).toEqual([]);
	});
});
