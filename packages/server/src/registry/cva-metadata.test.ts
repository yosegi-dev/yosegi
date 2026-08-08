import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCvaMetadata } from "./cva-metadata.ts";

const FIXTURE_ROOT = join(import.meta.dir, "__fixtures__");

describe("buildCvaMetadata", () => {
	function build(componentIds: string[], projectRoot = FIXTURE_ROOT) {
		return buildCvaMetadata({ projectRoot, componentIds });
	}

	it("cva の variants を enum props の雛形にする", () => {
		const { metadata } = build(["typography#Heading"]);
		expect(metadata["typography#Heading"].props).toEqual({
			size: {
				kind: "enum",
				nullable: true,
				options: ["sm", "md", "lg"],
				defaultValue: undefined,
			},
			color: {
				kind: "enum",
				nullable: true,
				options: ["primary", "danger"],
				defaultValue: undefined,
			},
		});
	});

	// Even for parts exported after a cast, we follow through to the underlying declaration to find the cva.
	// This is exactly the shape that type extraction (source-registry) can't read props from, so it's the primary target here.
	it("別名・キャスト越しの export でも実体の cva を辿る", () => {
		const props = build(["typography#Text"]).metadata["typography#Text"].props;
		expect(props?.size?.options).toEqual(["xsm", "sm", "md"]);
		// defaultVariants is copied over as defaultValue.
		expect(props?.size?.defaultValue).toBe("md");
	});

	it("数値キーの variant は number の選択肢にする", () => {
		const props = build(["typography#Text"]).metadata["typography#Text"].props;
		expect(props?.clamp?.options).toEqual([1, 2]);
	});

	// cva collapses a variant with only true / false into a boolean type.
	it("true / false だけの variant は boolean にする", () => {
		const props = build(["typography#Text"]).metadata["typography#Text"].props;
		expect(props?.bold).toEqual({
			kind: "boolean",
			nullable: true,
			defaultValue: false,
		});
	});

	// Globs are relative to projectRoot, not cwd (same semantics as registry build).
	// The test's cwd is packages/server, so if this resolved relative to cwd it would match nothing.
	describe("--source の glob 解決", () => {
		it("glob は cwd ではなく projectRoot 基準で展開する", () => {
			const { metadata, notes } = buildCvaMetadata({
				projectRoot: FIXTURE_ROOT,
				componentIds: ["Text"],
				sources: ["**/*.tsx"],
			});
			expect(metadata.Text.props?.size?.options).toEqual(["xsm", "sm", "md"]);
			expect(notes.join("\n")).not.toContain("--source matched no files");
		});

		it("モジュールパス付きの id でも glob と併せて解決できる", () => {
			const { metadata } = buildCvaMetadata({
				projectRoot: FIXTURE_ROOT,
				componentIds: ["typography#Heading"],
				sources: ["**/*.tsx"],
			});
			expect(metadata["typography#Heading"].props?.color?.options).toEqual([
				"primary",
				"danger",
			]);
		});

		it("繰り返し指定とカンマ区切りの glob を受ける", () => {
			const { metadata } = buildCvaMetadata({
				projectRoot: FIXTURE_ROOT,
				componentIds: ["Text"],
				sources: ["nowhere/**/*.tsx", "typo*.tsx"],
			});
			expect(metadata.Text.props?.size?.options).toEqual(["xsm", "sm", "md"]);
		});

		// A mistyped glob would otherwise pass silently with zero matches. Surface a likely misconfiguration up front.
		it("glob が 1 件も拾えなければ基準ディレクトリ付きで警告する", () => {
			const { notes } = buildCvaMetadata({
				projectRoot: FIXTURE_ROOT,
				componentIds: ["Text"],
				sources: ["nowhere/**/*.tsx"],
			});
			expect(notes.join("\n")).toContain("--source matched no files");
		});
	});

	it("見つからない id は空の雛形と、探した場所を返す", () => {
		const { metadata, notes } = build(["nowhere/missing#Widget"]);
		expect(metadata["nowhere/missing#Widget"]).toEqual({ props: {} });
		expect(notes.join("\n")).toContain("nowhere/missing");
	});

	describe("ホストのソースを読む", () => {
		let root: string;

		beforeAll(async () => {
			root = await mkdtemp(join(tmpdir(), "yosegi-cva-"));
		});

		afterAll(async () => {
			await rm(root, { recursive: true, force: true });
		});

		async function write(name: string, source: string): Promise<void> {
			await writeFile(join(root, name), source);
		}

		it("class-variance-authority からの import を別名でも追える", async () => {
			await write(
				"aliased.tsx",
				`import { cva as tv } from "class-variance-authority";

const badgeStyles = tv("", { variants: { tone: { info: "a", danger: "b" } } });

export function Badge() {
	return <span className={badgeStyles()} />;
}
`,
			);
			const props = build(["aliased#Badge"], root).metadata["aliased#Badge"]
				.props;
			expect(props?.tone?.options).toEqual(["info", "danger"]);
		});

		// Picks the cva referenced inside the declaration, without relying on the naming convention (`badgeVariants`).
		it("命名が一致しなくても宣言から参照している cva を選ぶ", async () => {
			await write(
				"referenced.tsx",
				`import { cva } from "class-variance-authority";

const outerStyles = cva("", { variants: { outer: { a: "1" } } });
const innerStyles = cva("", { variants: { inner: { b: "2" } } });

export function Inner() {
	return <span className={innerStyles()} />;
}
`,
			);
			const props = build(["referenced#Inner"], root).metadata[
				"referenced#Inner"
			].props;
			expect(Object.keys(props ?? {})).toEqual(["inner"]);
		});

		// Rather than guessing which variants to pick, return an empty scaffold plus the source location.
		it("どの cva を使うか決められない場合は空の雛形とヒントを返す", async () => {
			await write(
				"ambiguous.tsx",
				`import { cva } from "class-variance-authority";

const one = cva("", { variants: { a: { x: "1" } } });
const two = cva("", { variants: { b: { y: "2" } } });

export function Widget() {
	return <span data-x={one} data-y={two} />;
}
`,
			);
			const { metadata, notes } = build(["ambiguous#Widget"], root);
			expect(metadata["ambiguous#Widget"].props).toEqual({});
			expect(notes.join("\n")).toContain("one, two");
		});

		it("cva が無いファイルは空の雛形とヒントを返す", async () => {
			await write(
				"plain.tsx",
				`export function Plain() {
	return <span />;
}
`,
			);
			const { metadata, notes } = build(["plain#Plain"], root);
			expect(metadata["plain#Plain"].props).toEqual({});
			expect(notes.join("\n")).toContain("found no cva call");
		});

		// What could be read goes into the scaffold; only the variants that couldn't are named explicitly.
		it("静的に読めない variant は載せずにヒントへ回す", async () => {
			await write(
				"spread.tsx",
				`import { cva } from "class-variance-authority";

const shared = { sm: "1", lg: "2" };
const styles = cva("", {
	variants: { size: { ...shared }, tone: { info: "a" } },
});

export function Spread() {
	return <span className={styles()} />;
}
`,
			);
			const { metadata, notes } = build(["spread#Spread"], root);
			expect(Object.keys(metadata["spread#Spread"].props ?? {})).toEqual([
				"tone",
			]);
			expect(notes.join("\n")).toContain("size");
		});

		// Short ids from standalone `--index` mode have no module path. Search for the
		// owner by export name among what --source covers.
		it("モジュールパスを持たない id は --source の範囲から export 名で探す", async () => {
			await write(
				"short-id.tsx",
				`import { cva } from "class-variance-authority";

const chipStyles = cva("", { variants: { size: { sm: "1" } } });

export function Chip() {
	return <span className={chipStyles()} />;
}
`,
			);
			const { metadata } = buildCvaMetadata({
				projectRoot: root,
				componentIds: ["Chip"],
				sources: ["short-id.tsx"],
			});
			expect(metadata.Chip.props?.size?.options).toEqual(["sm"]);
		});

		it("モジュールパスを持たない id を --source 無しで渡すと指定方法を返す", () => {
			const { metadata, notes } = build(["Chip"], root);
			expect(metadata.Chip.props).toEqual({});
			expect(notes.join("\n")).toContain("--source <glob>");
		});
	});
});
