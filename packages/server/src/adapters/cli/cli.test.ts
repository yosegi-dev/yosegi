import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseComponentRegistry } from "@yosegi/core";
import { sampleRegistry, sampleScreen } from "@yosegi/core/testing";
import { yosegiCliPath, yosegiVersion } from "../../config.ts";
import { parseArgs, runCli } from "./cli.ts";

describe("parseArgs", () => {
	it("フラグと位置引数を分離する", () => {
		const { positionals, flags } = parseArgs([
			"screen",
			"push",
			"a.json",
			"--data-dir",
			"/tmp/x",
		]);
		expect(positionals).toEqual(["screen", "push", "a.json"]);
		expect(flags["data-dir"]).toBe("/tmp/x");
	});

	it("値を伴わない末尾フラグは boolean になる", () => {
		const { flags } = parseArgs(["registry", "build", "--force"]);
		expect(flags.force).toBe(true);
	});

	it("次トークンが -- 始まりのフラグは boolean 扱い", () => {
		const { flags } = parseArgs(["--a", "--b", "v"]);
		expect(flags.a).toBe(true);
		expect(flags.b).toBe("v");
	});

	it("同じフラグの繰り返し指定は配列になる", () => {
		const { flags } = parseArgs([
			"--source",
			"a/**/*.tsx",
			"--source",
			"b/**/*.tsx",
		]);
		expect(flags.source).toEqual(["a/**/*.tsx", "b/**/*.tsx"]);
	});
});

describe("runCli", () => {
	let dataDir: string;
	let logs: string[];
	let warnings: string[];
	const original = console.log;
	const originalWarn = console.warn;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "vc-cli-"));
		await mkdir(join(dataDir, "screens"), { recursive: true });
		await writeFile(
			join(dataDir, "registry.json"),
			JSON.stringify(sampleRegistry()),
		);
		logs = [];
		warnings = [];
		console.log = (value: unknown) => {
			logs.push(typeof value === "string" ? value : JSON.stringify(value));
		};
		// The registry version-mismatch warning goes to stderr. The default fixture has no
		// builtWith, so it fires every time. Swallow it so it doesn't pollute the logs, but
		// inspect its contents in the freshness-warning tests.
		console.warn = (value: unknown) => {
			warnings.push(typeof value === "string" ? value : JSON.stringify(value));
		};
	});

	afterEach(async () => {
		console.log = original;
		console.warn = originalWarn;
		await rm(dataDir, { recursive: true, force: true });
	});

	function output(): string {
		return logs.join("\n");
	}

	function warned(): string {
		return warnings.join("\n");
	}

	it("component list はコンポーネントを列挙し props を要約する", async () => {
		const code = await runCli(["component", "list", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("Button");
		// The list itself should reveal what can be passed in, so candidates can be narrowed
		// without dropping down to inspect.
		expect(output()).toContain("variant:enum(5)");
		expect(output()).toContain("props: title:string*");
	});

	it("component list --category はカテゴリで絞り込む", async () => {
		const code = await runCli([
			"component",
			"list",
			"--category",
			"form",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("matching category=form");
		expect(output()).toContain("SearchForm");
		expect(output()).not.toContain("PageHeader");
	});

	it("component list --query は id・説明を部分一致で絞り込む", async () => {
		const code = await runCli([
			"component",
			"list",
			"--query",
			"button",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("Button");
		expect(output()).not.toContain("SearchForm");
	});

	// --query repeated (same convention as --source) OR's the terms together, so guessing
	// a component's name doesn't cost a round-trip per guess.
	it("component list --query を繰り返すと OR で絞り込む", async () => {
		const code = await runCli([
			"component",
			"list",
			"--query",
			"button",
			"--query",
			"table",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("matching query=button,table");
		expect(output()).toContain("Button");
		expect(output()).toContain("Table");
		expect(output()).not.toContain("SearchForm");
	});

	// Comma-separated works the same as repeating the flag, same convention as --source.
	it("component list --query はカンマ区切りでも OR で絞り込む", async () => {
		const code = await runCli([
			"component",
			"list",
			"--query",
			"button,table",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("Button");
		expect(output()).toContain("Table");
		expect(output()).not.toContain("SearchForm");
	});

	it("component list --json は Manifest と件数を構造化して返す", async () => {
		const code = await runCli([
			"component",
			"list",
			"--json",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			version: string;
			total: number;
			categories: string[];
			components: { id: string; props: Record<string, unknown> }[];
		};
		expect(parsed.version).toBe("test:v1");
		expect(parsed.total).toBe(parsed.components.length);
		expect(parsed.categories).toContain("form");
		expect(parsed.components.some((c) => c.id === "Button")).toBe(true);
	});

	it("component inspect は props と import 文を出す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("import { Button } from");
		expect(output()).toContain("options:");
	});

	it("component inspect --json は Manifest をそのまま返す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"--json",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as { id: string };
		expect(parsed.id).toBe("Button");
	});

	it("component inspect の未登録は exit 1", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Nope",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
	});

	// Return an existing id as a suggestion, so an agent can fix a typo on its own.
	it("component inspect の綴り違いには候補を返す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"TextFild",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("Did you mean: TextField?");
	});

	// Reading several components no longer requires looping the CLI and stripping a
	// repeated header by hand — a single call takes multiple ids.
	it("component inspect は複数 id をまとめて出し、見出しは一度だけ出す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"TextField",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("import { Button } from");
		expect(output()).toContain("import { TextField } from");
		// The registry provenance header (from formatComponentList's header block) appears
		// exactly once, above both components, not once per id.
		const headerOccurrences = output().split("registry test:v1").length - 1;
		expect(headerOccurrences).toBe(1);
	});

	it("component inspect --quiet は複数 id でも見出しを出さない", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"TextField",
			"--quiet",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).not.toContain("registry test:v1");
		expect(output()).toContain("import { Button } from");
		expect(output()).toContain("import { TextField } from");
	});

	// Single-id behaviour is unchanged: no header, even without --quiet.
	it("component inspect は id が 1 つなら見出しを出さない", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).not.toContain("registry test:v1");
	});

	// A mix of found and missing ids still reports every id's result, and exits 1 because
	// at least one lookup failed.
	it("component inspect は一部の id が未登録でも残りは出し、exit 1 にする", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"Nope",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("import { Button } from");
		expect(output()).toContain("Nope");
		expect(output()).toContain("not found");
	});

	it("component inspect --json は複数 id を配列で返す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Button",
			"TextField",
			"--json",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as { id: string }[];
		expect(parsed.map((c) => c.id)).toEqual(["Button", "TextField"]);
	});

	it("component list --quiet は台帳の出所を出さない", async () => {
		const code = await runCli([
			"component",
			"list",
			"--quiet",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).not.toContain("registry test:v1");
		expect(output()).toContain("Button");
	});

	it("screen push で新規作成し、pull / list / validate できる", async () => {
		const file = join(dataDir, "screen.json");
		await writeFile(file, JSON.stringify(sampleScreen()));

		const pushCode = await runCli([
			"screen",
			"push",
			file,
			"--data-dir",
			dataDir,
		]);
		expect(pushCode).toBe(0);

		const listCode = await runCli(["screen", "list", "--data-dir", dataDir]);
		expect(listCode).toBe(0);
		expect(output()).toContain("customer-list");

		logs = [];
		const validateCode = await runCli([
			"screen",
			"validate",
			"customer-list",
			"--data-dir",
			dataDir,
		]);
		expect(validateCode).toBe(0);
		expect(output()).toContain('"valid": true');
	});

	// Since a local Screen JSON file can be pushed as-is, the CLI also needs to guard
	// against an id that points outside the storage directory.
	it("保存先の外を指す id の screen push / pull を拒否する", async () => {
		const file = join(dataDir, "evil.json");
		await writeFile(
			file,
			JSON.stringify({ ...sampleScreen(), id: "../../victim/target" }),
		);

		expect(await runCli(["screen", "push", file, "--data-dir", dataDir])).toBe(
			1,
		);
		expect(existsSync(join(dataDir, "..", "..", "victim", "target.json"))).toBe(
			false,
		);

		logs = [];
		expect(
			await runCli([
				"screen",
				"pull",
				"../../victim/target",
				"--data-dir",
				dataDir,
			]),
		).toBe(1);
		expect(output()).toContain("INVALID_SCREEN_ID");
	});

	it("screen apply で Operation を適用する", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		await runCli(["screen", "push", screenFile, "--data-dir", dataDir]);

		const opsFile = join(dataDir, "ops.json");
		await writeFile(
			opsFile,
			JSON.stringify([
				{ type: "setProps", nodeId: "node-header", props: { title: "CLI" } },
			]),
		);
		logs = [];
		const code = await runCli([
			"screen",
			"apply",
			"customer-list",
			opsFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain("CLI");
	});

	it("registry build は index.json から Registry を書き出す", async () => {
		const indexFile = join(dataDir, "index.json");
		await writeFile(
			indexFile,
			JSON.stringify({
				v: 5,
				entries: {
					"components-button--default": {
						type: "story",
						id: "components-button--default",
						name: "Default",
						title: "Components/Button",
						importPath: "./button.stories.tsx",
					},
				},
			}),
		);
		const outFile = join(dataDir, "out-registry.json");
		const code = await runCli([
			"registry",
			"build",
			"--index",
			indexFile,
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const written = JSON.parse(await Bun.file(outFile).text()) as {
			components: { id: string }[];
		};
		expect(written.components.map((c) => c.id)).toContain("Button");
	});

	it("screen generate は Story ファイルを書き出す", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "generated", "customer-list.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--title",
			"Examples/顧客一覧",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain(`Wrote ${outFile}`);

		const source = await Bun.file(outFile).text();
		expect(source).toContain(
			'import type { Meta, StoryObj } from "@storybook/react";',
		);
		expect(source).toContain(
			'import { Page, PageHeader } from "~/components/layout";',
		);
		expect(source).toContain('title: "Examples/顧客一覧",');
		expect(source).toContain('<PageHeader title="Customer list" />');
	});

	it("screen generate は --import-map / --framework / --registry を反映する", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const registryFile = join(dataDir, "explicit-registry.json");
		await writeFile(registryFile, JSON.stringify(sampleRegistry()));
		const outFile = join(dataDir, "out.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--import-map",
			"~/components=@host/ui",
			"--framework",
			"@storybook/react-vite",
			"--story-name",
			"Wide",
			"--registry",
			registryFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(outFile).text();
		expect(source).toContain(
			'import type { Meta, StoryObj } from "@storybook/react-vite";',
		);
		expect(source).toContain('from "@host/ui/layout";');
		expect(source).toContain("export const Wide: StoryObj = {");
	});

	it("screen generate は合成プリミティブだけの画面も生成できる", async () => {
		const screenFile = join(dataDir, "synthetic.json");
		await writeFile(
			screenFile,
			JSON.stringify({
				schemaVersion: "1.0",
				id: "synthetic",
				name: "合成のみ",
				componentRegistryVersion: "test:v1",
				revision: 0,
				root: {
					id: "root",
					component: "Box",
					props: { className: "p-6" },
					slots: {
						children: [
							{
								id: "heading",
								component: "Heading",
								props: { text: "見出し" },
								slots: {},
							},
						],
					},
				},
			}),
		);
		const outFile = join(dataDir, "synthetic.stories.tsx");
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(outFile).text();
		expect(source).toContain('title: "Screens/合成のみ",');
		expect(source).toContain('<div className="p-6">');
		expect(source).toContain("見出し");
	});

	it("screen generate は検証エラーで exit 1 になり書き出さない", async () => {
		const screen = sampleScreen();
		screen.root.slots.header[0].component = "NotRegistered";
		const screenFile = join(dataDir, "broken.json");
		await writeFile(screenFile, JSON.stringify(screen));
		const outFile = join(dataDir, "broken.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("COMPONENT_NOT_FOUND");
		expect(await Bun.file(outFile).exists()).toBe(false);
	});

	// A missing required argument is a coded JSON error, not a usage dump — usage stays
	// reserved for --help.
	it("screen generate は --out 無しで MISSING_ARGUMENT を返す", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; message: string; command: string };
		};
		expect(parsed.error.code).toBe("MISSING_ARGUMENT");
		expect(parsed.error.command).toBe("screen generate");
		expect(parsed.error.message).toContain("--out");
		expect(output()).not.toContain("Yosegi CLI");
	});

	it("screen generate --target component は素のコンポーネントファイルを書き出す", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "generated", "customer-list.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--target",
			"component",
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain(`Wrote ${outFile}`);

		const source = await Bun.file(outFile).text();
		expect(source).toContain('import type { ReactElement } from "react";');
		expect(source).toContain("export function Screen(): ReactElement {");
		expect(source).toContain('<PageHeader title="Customer list" />');
		expect(source).not.toContain("@storybook");
		expect(source).not.toContain("const meta");
	});

	it("screen generate --target component は --story-name を関数名にする", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "customer-list.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--target",
			"component",
			"--story-name",
			"CustomerList",
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const source = await Bun.file(outFile).text();
		expect(source).toContain("export function CustomerList(): ReactElement {");
	});

	// The extension is what the host's tooling dispatches on, so a component file
	// must not take the Storybook glob's .stories.tsx suffix (nor a non-.tsx one).
	it("screen generate --target component は拡張子の食い違いを INVALID_ARGUMENT にする", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		for (const outFile of [
			join(dataDir, "x.stories.tsx"),
			join(dataDir, "x.ts"),
		]) {
			logs = [];
			const code = await runCli([
				"screen",
				"generate",
				screenFile,
				"--target",
				"component",
				"--out",
				outFile,
				"--data-dir",
				dataDir,
			]);
			expect(code).toBe(1);
			expect(output()).toContain("INVALID_ARGUMENT");
			expect(await Bun.file(outFile).exists()).toBe(false);
		}
	});

	// A CSF-only flag on the component target is rejected rather than silently
	// ignored — the caller asked for something the output cannot carry.
	it("screen generate --target component は CSF 専用フラグを INVALID_ARGUMENT にする", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "x.tsx");
		for (const extra of [
			["--title", "Examples/X"],
			["--framework", "@storybook/react-vite"],
			["--meta-template", join(dataDir, "meta.tsx")],
		]) {
			logs = [];
			const code = await runCli([
				"screen",
				"generate",
				screenFile,
				"--target",
				"component",
				"--out",
				outFile,
				...extra,
				"--data-dir",
				dataDir,
			]);
			expect(code).toBe(1);
			expect(output()).toContain("INVALID_ARGUMENT");
			expect(output()).toContain(extra[0]);
		}
	});

	it("screen generate は未知の --target を INVALID_ARGUMENT にする", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--target",
			"page",
			"--out",
			join(dataDir, "x.tsx"),
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("INVALID_ARGUMENT");
		expect(output()).toContain("Unknown --target");
		expect(output()).toContain("component");
	});

	// story import reads Stories (exports with a render), which a component file
	// does not have; the failure names the reason instead of returning an empty tree.
	it("story import は --target component の出力を明示的に失敗させる", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "customer-list.tsx");
		await runCli([
			"screen",
			"generate",
			screenFile,
			"--target",
			"component",
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		logs = [];
		const code = await runCli([
			"story",
			"import",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as { error: { code: string } };
		expect(parsed.error.code).toBe("STORY_NOT_FOUND");
	});

	it("component inspect は id 無しで MISSING_ARGUMENT を返す", async () => {
		const code = await runCli(["component", "inspect", "--data-dir", dataDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; command: string };
		};
		expect(parsed.error.code).toBe("MISSING_ARGUMENT");
		expect(parsed.error.command).toBe("component inspect");
	});

	it("screen pull は screenId 無しで MISSING_ARGUMENT を返す", async () => {
		const code = await runCli(["screen", "pull", "--data-dir", dataDir]);
		expect(code).toBe(1);
		expect(output()).toContain("MISSING_ARGUMENT");
		expect(output()).toContain("screenId");
	});

	it("screen context は import 文・結線タスク・構造サマリを返す", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));

		const code = await runCli([
			"screen",
			"context",
			screenFile,
			"--route",
			"/customers",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const context = JSON.parse(output()) as {
			imports: string[];
			tasks: { kind: string; nodeId: string }[];
			structure: { outline: string[] };
			target: { route: string | null };
		};
		expect(context.imports).toContain(
			'import { Page, PageHeader } from "~/components/layout";',
		);
		expect(context.tasks.some((task) => task.nodeId === "node-table")).toBe(
			true,
		);
		expect(context.structure.outline[0]).toBe("Page #node-page");
		expect(context.target.route).toBe("/customers");
	});

	it("screen context は --import-map を反映し --out へ書き出せる", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "context", "customer-list.json");

		const code = await runCli([
			"screen",
			"context",
			screenFile,
			"--import-map",
			"~/components=@host/ui",
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain(`Wrote ${outFile}`);

		const written = JSON.parse(await Bun.file(outFile).text()) as {
			imports: string[];
		};
		expect(written.imports).toContain(
			'import { Page, PageHeader } from "@host/ui/layout";',
		);
	});

	// Confirm end-to-end that a Story written upstream (screen generate) can be read back
	// and passed straight to the downstream step (screen context).
	it("story import は生成した Story を Screen JSON へ戻せる", async () => {
		const screenFile = join(dataDir, "screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const storyFile = join(dataDir, "customer-list.stories.tsx");
		await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			storyFile,
			"--data-dir",
			dataDir,
		]);

		logs = [];
		const restoredFile = join(dataDir, "restored", "screen.json");
		const code = await runCli([
			"story",
			"import",
			storyFile,
			"--out",
			restoredFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		expect(output()).toContain(`Wrote ${restoredFile}`);
		expect(output()).toContain('"warnings": []');

		const restored = JSON.parse(await Bun.file(restoredFile).text()) as {
			id: string;
			name: string;
			root: { component: string; slots: Record<string, unknown[]> };
		};
		// The screen id comes from the file name; the name comes from the tail of meta.title.
		expect(restored.id).toBe("customer-list");
		expect(restored.name).toBe("Customer list");
		expect(restored.root.component).toBe("Page");
		expect(restored.root.slots.header).toHaveLength(1);

		// The restored Screen JSON can be passed straight to the downstream step.
		logs = [];
		const contextCode = await runCli([
			"screen",
			"context",
			restoredFile,
			"--data-dir",
			dataDir,
		]);
		expect(contextCode).toBe(0);
		const context = JSON.parse(output()) as { imports: string[] };
		expect(context.imports).toContain(
			'import { Page, PageHeader } from "~/components/layout";',
		);
	});

	// Fixtures ride the whole loop: Screen JSON -> const declarations in the Story
	// -> back into the restored Screen JSON.
	it("screen generate は fixtures を const として書き出し、story import が読み戻す", async () => {
		const screen = {
			...sampleScreen(),
			fixtures: { customers: [{ name: "Sato" }, { name: "Suzuki" }] },
		};
		const screenFile = join(dataDir, "fixtures-screen.json");
		await writeFile(screenFile, JSON.stringify(screen));
		const storyFile = join(dataDir, "customer-list.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(storyFile).text();
		expect(source).toContain("const customers = [");
		// The fixture-backed binding is written into the JSX even though rows is optional.
		expect(source).toContain("rows={customers}");

		logs = [];
		const restoredFile = join(dataDir, "restored-fixtures", "screen.json");
		const importCode = await runCli([
			"story",
			"import",
			storyFile,
			"--out",
			restoredFile,
			"--data-dir",
			dataDir,
		]);
		expect(importCode).toBe(0);
		expect(output()).toContain('"warnings": []');
		const restored = JSON.parse(await Bun.file(restoredFile).text()) as {
			fixtures: Record<string, unknown>;
		};
		expect(restored.fixtures).toEqual({
			customers: [{ name: "Sato" }, { name: "Suzuki" }],
		});
	});

	// Variants ride from Screen JSON into one file with several Story exports.
	// The read-back imports one export per run and names the ones it skipped.
	it("screen generate は variants を複数の Story export として書き出す", async () => {
		const screen = {
			...sampleScreen(),
			variants: [
				{
					name: "Loading",
					description: "Rows are being fetched.",
					operations: [
						{
							type: "setProps",
							nodeId: "node-table",
							props: { loading: true },
						},
					],
				},
			],
		};
		const screenFile = join(dataDir, "variants-screen.json");
		await writeFile(screenFile, JSON.stringify(screen));
		const storyFile = join(dataDir, "variants.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(storyFile).text();
		expect(source).toContain("export const Default: StoryObj = {");
		expect(source).toContain(
			"/** Rows are being fetched. */\nexport const Loading: StoryObj = {",
		);

		logs = [];
		const importCode = await runCli([
			"story",
			"import",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(importCode).toBe(0);
		expect(output()).toContain("MULTIPLE_STORIES");
		expect(output()).toContain('also exports \\"Loading\\"');

		logs = [];
		const variantImportCode = await runCli([
			"story",
			"import",
			storyFile,
			"--story-name",
			"Loading",
			"--data-dir",
			dataDir,
		]);
		expect(variantImportCode).toBe(0);
		// The variant export reads back as its applied tree.
		expect(output()).toContain('"loading": true');
	});

	it("variant の検証エラーは variant 名付きで報告され、ファイルを書かない", async () => {
		const screen = {
			...sampleScreen(),
			variants: [
				{
					name: "Broken",
					operations: [
						{ type: "setProps", nodeId: "no-such-node", props: { a: 1 } },
					],
				},
			],
		};
		const screenFile = join(dataDir, "broken-variant.json");
		await writeFile(screenFile, JSON.stringify(screen));
		const storyFile = join(dataDir, "broken-variant.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("VARIANT_OPERATION_FAILED");
		expect(output()).toContain('"variant": "Broken"');
		expect(existsSync(storyFile)).toBe(false);
	});

	it("screen push は variants を保存し、pull で返す", async () => {
		const screen = {
			...sampleScreen(),
			id: "with-variants",
			variants: [
				{
					name: "Loading",
					operations: [
						{
							type: "setProps",
							nodeId: "node-table",
							props: { loading: true },
						},
					],
				},
			],
		};
		const file = join(dataDir, "with-variants.json");
		await writeFile(file, JSON.stringify(screen));

		expect(await runCli(["screen", "push", file, "--data-dir", dataDir])).toBe(
			0,
		);

		logs = [];
		expect(
			await runCli(["screen", "pull", "with-variants", "--data-dir", dataDir]),
		).toBe(0);
		const pulled = JSON.parse(output()) as {
			variants?: { name: string }[];
		};
		expect(pulled.variants?.map((variant) => variant.name)).toEqual([
			"Loading",
		]);
	});

	it("story import は --out 無しなら screen と warnings を標準出力へ返す", async () => {
		const storyFile = join(dataDir, "hand-written.stories.tsx");
		await writeFile(
			storyFile,
			[
				'import { Table } from "~/components/table";',
				'const meta: Meta = { title: "Examples/一覧" };',
				"export default meta;",
				"export const Default: StoryObj = {",
				"\trender: () => <Table loading={isLoading} />,",
				"};",
			].join("\n"),
		);

		const code = await runCli([
			"story",
			"import",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const result = JSON.parse(output()) as {
			title: string;
			storyName: string;
			screen: { id: string; root: { component: string } };
			warnings: { code: string }[];
		};
		expect(result.title).toBe("Examples/一覧");
		expect(result.storyName).toBe("Default");
		expect(result.screen.id).toBe("hand-written");
		expect(result.screen.root.component).toBe("Table");
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"OPAQUE_PROP",
		]);
	});

	// The failure goes out through the same envelope as every other command's, so an agent
	// branching on error.code reaches this one too. The warnings stay attached inside it.
	it("story import はツリーを復元できなければ error エンベロープで exit 1", async () => {
		const storyFile = join(dataDir, "no-render.stories.tsx");
		await writeFile(
			storyFile,
			[
				'const meta: Meta = { title: "Examples/なし" };',
				"export default meta;",
				'export const Default: StoryObj = { args: { label: "ボタン" } };',
			].join("\n"),
		);

		const code = await runCli([
			"story",
			"import",
			storyFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: {
				code: string;
				message: string;
				file: string;
				warnings: { code: string }[];
			};
			warnings?: unknown;
		};
		expect(parsed.warnings).toBeUndefined();
		expect(parsed.error.code).toBe("STORY_NOT_FOUND");
		expect(parsed.error.file).toBe(storyFile);
		expect(parsed.error.warnings.map((warning) => warning.code)).toEqual([
			"STORY_NOT_FOUND",
		]);
		// The message has to say why importing can never work here, not just that it failed.
		expect(parsed.error.message).toContain("render function");
		expect(parsed.error.message).toContain("`component` + `args`");
		expect(parsed.error.message).toContain("read the Story file directly");
	});

	// A --story-name that lands on an args-only export ends the run just as STORY_NOT_FOUND
	// does, and takes the same envelope with its own code.
	it("story import は RENDER_NOT_STATIC も error エンベロープで返す", async () => {
		const storyFile = join(dataDir, "args-only.stories.tsx");
		await writeFile(
			storyFile,
			[
				'const meta: Meta = { title: "Examples/なし" };',
				"export default meta;",
				'export const Default: StoryObj = { args: { label: "ボタン" } };',
			].join("\n"),
		);

		const code = await runCli([
			"story",
			"import",
			storyFile,
			"--story-name",
			"Default",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as { error: { code: string } };
		expect(parsed.error.code).toBe("RENDER_NOT_STATIC");
	});

	it("registry build は --index に URL を指定できる", async () => {
		const index = {
			v: 5,
			entries: {
				"components-badge--default": {
					type: "story",
					id: "components-badge--default",
					name: "Default",
					title: "Components/Badge",
					importPath: "./badge.stories.tsx",
				},
			},
		};
		const server = Bun.serve({
			port: 0,
			fetch: () => Response.json(index),
		});
		try {
			const outFile = join(dataDir, "url-registry.json");
			const code = await runCli([
				"registry",
				"build",
				"--index",
				`http://localhost:${server.port}/index.json`,
				"--out",
				outFile,
				"--data-dir",
				dataDir,
			]);
			expect(code).toBe(0);
			const written = JSON.parse(await Bun.file(outFile).text()) as {
				components: { id: string }[];
			};
			expect(written.components.map((c) => c.id)).toContain("Badge");
		} finally {
			await server.stop(true);
		}
	});

	// An index URL nothing is listening on. The port is bound and released rather than
	// picked, so the connection is refused immediately instead of timing out.
	const unreachableIndexUrl = async (): Promise<string> => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("") });
		const url = new URL("/index.json", server.url).href;
		await server.stop(true);
		return url;
	};

	// The runtime reports an unreachable URL as a bare connection error, which names neither
	// the URL nor the flag that chose it. `registry status` already explains this condition;
	// build has to say at least as much, or an agent is left with nothing to act on.
	it("registry build は届かない --index の URL とフラグと対処を示す", async () => {
		const url = await unreachableIndexUrl();
		const code = await runCli([
			"registry",
			"build",
			"--index",
			url,
			"--out",
			join(dataDir, "unreachable-registry.json"),
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const { error } = JSON.parse(output()) as {
			error: { code: string; message: string };
		};
		expect(error.message).toContain(url);
		expect(error.message).toContain("given as --index");
		expect(error.message).toContain("Start Storybook");
		// Without --source there is nothing else to build from, so dropping the flag is not
		// a way out here.
		expect(error.message).toContain("Without --source there is no other input");
		expect(error.message).toContain("Underlying error:");
	});

	// With --source the registry can still be built, just without the Storybook layer, so
	// dropping the flag is a real option and the message has to offer it.
	it("registry build --source なら --index を外す選択肢も示す", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const url = await unreachableIndexUrl();
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--index",
			url,
			"--out",
			join(dataDir, "unreachable-source-registry.json"),
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const { error } = JSON.parse(output()) as { error: { message: string } };
		expect(error.message).toContain(url);
		expect(error.message).toContain("Dropping --index also works");
	});

	// The default location is not something the caller typed, so blaming --index for it
	// would send the reader looking for a flag that is not in the invocation.
	it("registry build は --index 未指定なら既定の場所だと明示する", async () => {
		const code = await runCli([
			"registry",
			"build",
			"--out",
			join(dataDir, "default-index-registry.json"),
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const { error } = JSON.parse(output()) as { error: { message: string } };
		expect(error.message).toContain("storybook-static/index.json");
		expect(error.message).toContain("No --index was given");
		expect(error.message).not.toContain("given as --index");
	});

	it("registry build --source はソースの型から Registry を書き出す", async () => {
		const outFile = join(dataDir, "source-registry.json");
		const reportFile = join(dataDir, "source-report.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--out",
			outFile,
			"--report",
			reportFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const written = JSON.parse(await Bun.file(outFile).text()) as {
			components: { id: string; props: Record<string, { kind: string }> }[];
		};
		const card = written.components.find(
			(component) => component.id === "sample-card#SampleCard",
		);
		expect(card?.props.variant?.kind).toBe("enum");
		expect(await Bun.file(reportFile).exists()).toBe(true);
		// The fixtures resolve the workspace's @types/react, so the degraded-build
		// warnings must stay silent on a healthy host.
		expect(output()).not.toContain("React's type definitions did not resolve");
		expect(output()).not.toContain("no React component exports were found");
	});

	// version is a content hash, so it can't distinguish a rebuild that produced the same
	// result. Which part of the host the registry read, and when, can only be recorded at write time.
	it("registry build は生成時刻と入力を Registry に残す", async () => {
		const outFile = join(dataDir, "provenance-registry.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const tsconfig = join(fixtureRoot, "tsconfig.json");
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			tsconfig,
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const written = JSON.parse(await Bun.file(outFile).text()) as {
			generatedAt: string;
			inputs: { sources: string[]; tsconfig: string; index?: string };
		};
		expect(Number.isNaN(Date.parse(written.generatedAt))).toBe(false);
		expect(written.inputs.sources).toEqual(["**/*.tsx"]);
		expect(written.inputs.tsconfig).toBe(tsconfig);
		expect(written.inputs.index).toBeUndefined();
	});

	// version / generatedAt alone can't detect "an older Yosegi is missing newer fields".
	// Record which Yosegi built it, plus every flag needed to reproduce it (including storybook-url).
	it("registry build は生成した Yosegi の版と全フラグを Registry に残す", async () => {
		const outFile = join(dataDir, "builtwith-registry.json");
		const reportFile = join(dataDir, "builtwith-report.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--project-root",
			fixtureRoot,
			"--storybook-url",
			"http://localhost:6006",
			"--report",
			reportFile,
			"--out",
			outFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const written = JSON.parse(await Bun.file(outFile).text()) as {
			builtWith: string;
			builtWithCliPath: string;
			inputs: {
				storybookUrl?: string;
				projectRoot?: string;
				report?: string;
			};
		};
		expect(written.builtWith).toBe(yosegiVersion());
		// Which checkout's CLI built it. Recorded from process.argv[1], so it matches the
		// path of the bun process running this test itself.
		expect(written.builtWithCliPath).toBe(yosegiCliPath());
		expect(written.inputs.storybookUrl).toBe("http://localhost:6006");
		expect(written.inputs.projectRoot).toBe(fixtureRoot);
		expect(written.inputs.report).toBe(reportFile);
	});

	// A registry built by an older Yosegi that's missing newer fields still looks "fresh"
	// by every other freshness signal. Only this warning catches it: it fires when the
	// version differs from the running CLI, and stays silent when they match.
	it("component list は台帳を作った版が食い違えば警告する", async () => {
		const staleDir = join(dataDir, "stale");
		await mkdir(join(staleDir, "screens"), { recursive: true });
		await writeFile(
			join(staleDir, "registry.json"),
			JSON.stringify({ ...sampleRegistry(), builtWith: "0.0.1" }),
		);
		const code = await runCli(["component", "list", "--data-dir", staleDir]);
		expect(code).toBe(0);
		expect(warned()).toContain("built by Yosegi 0.0.1, but this CLI is");
		expect(warned()).toContain("Rebuild it:");
	});

	it("component list は台帳を作った版が一致すれば警告しない", async () => {
		const freshDir = join(dataDir, "fresh");
		await mkdir(join(freshDir, "screens"), { recursive: true });
		await writeFile(
			join(freshDir, "registry.json"),
			JSON.stringify({ ...sampleRegistry(), builtWith: yosegiVersion() }),
		);
		const code = await runCli(["component", "list", "--data-dir", freshDir]);
		expect(code).toBe(0);
		expect(warned()).not.toContain("Rebuild it:");
	});

	it("component list は版の記録が無い古い台帳では作り直しを促す", async () => {
		// The default fixture written by beforeEach has no builtWith (the shape predates this feature).
		const code = await runCli(["component", "list", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(warned()).toContain("unrecorded");
		expect(warned()).toContain("Rebuild it:");
	});

	it("component list は台帳の生成時刻と再ビルドのコマンドを見出しに出す", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const listDataDir = join(dataDir, "provenance-list");
		await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--data-dir",
			listDataDir,
		]);
		logs = [];
		const code = await runCli(["component", "list", "--data-dir", listDataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("registry src:");
		// In an environment spanning multiple checkouts, the reader can't tell which path
		// the `yosegi` in the rebuild line refers to. Print the absolute path of the CLI
		// that built it, between the built and rebuild lines.
		expect(output()).toContain(`cli: ${yosegiCliPath()}`);
		expect(output()).toContain(
			'rebuild: yosegi registry build --source "**/*.tsx" --tsconfig',
		);
	});

	// --json is the path an agent parses mechanically, so check that adding a new field
	// doesn't break the existing structured output (it still parses, and existing fields are unchanged).
	it("component list --json は builtWithCliPath を壊さず含める", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const listDataDir = join(dataDir, "provenance-list-json");
		await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--data-dir",
			listDataDir,
		]);
		logs = [];
		const code = await runCli([
			"component",
			"list",
			"--json",
			"--data-dir",
			listDataDir,
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			builtWith: string;
			builtWithCliPath: string;
			components: unknown[];
		};
		expect(parsed.builtWithCliPath).toBe(yosegiCliPath());
		// Confirm the parsed shape still matches a Registry (passes parseComponentRegistry).
		expect(() =>
			parseComponentRegistry({
				version: "src:v1",
				builtWith: parsed.builtWith,
				builtWithCliPath: parsed.builtWithCliPath,
				components: [],
			}),
		).not.toThrow();
	});

	// Where to write JSDoc can be named mechanically from the registry. Someone who passes
	// --report gets the full list; someone who doesn't should still learn such a list exists.
	it("registry build --report は JSDoc を書くべき props を優先順に書き出す", async () => {
		const reportFile = join(dataDir, "doc-report.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__doc-fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--out",
			join(dataDir, "doc-registry.json"),
			"--report",
			reportFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const report = JSON.parse(await Bun.file(reportFile).text()) as {
			undocumented: {
				totalCount: number;
				requiredOpaqueCount: number;
				props: {
					component: string;
					prop: string;
					priority: string;
					shape?: { type: string; fields: string[] };
				}[];
			};
		};
		expect(report.undocumented.requiredOpaqueCount).toBe(2);
		expect(report.undocumented.props[0]).toMatchObject({
			component: "documentation#Ledger",
			prop: "columns",
			priority: "required-opaque",
			shape: {
				type: "TableColumn[]",
				fields: ["header: string", "width?: number"],
			},
		});
		// A pointer for someone who doesn't know about --report. Print both the count and the flag name.
		expect(output()).toContain("2 required props across 1 components");
		expect(output()).toContain("--report <path> lists which");
	});

	it("registry build --report は --source が届かないホストのファイルを書き出す", async () => {
		const reportFile = join(dataDir, "outside-source-report.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__outside-source-fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			// icons.ts はここでは対象外 (components/ 配下のみ)。
			"components/**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--project-root",
			fixtureRoot,
			"--out",
			join(dataDir, "outside-source-registry.json"),
			"--report",
			reportFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const report = JSON.parse(await Bun.file(reportFile).text()) as {
			outsideSources: {
				totalCount: number;
				files: { file: string; referencedBy: string[]; types: string[] }[];
			};
		};
		expect(report.outsideSources.totalCount).toBe(1);
		expect(report.outsideSources.files[0]).toMatchObject({
			file: "icons",
			referencedBy: ["components/tag#Tag"],
			types: ["IconMeta"],
		});
		// A pointer for someone who doesn't know about --report, printed even without it.
		expect(output()).toContain(
			"1 host files are referenced by props but not covered by --source",
		);
		expect(output()).toContain("--report");
	});

	// The id scheme is `<module path>#<exportName>`. Confirm end-to-end that a Screen JSON
	// can reference an id from a --source-built Registry directly, and that it passes
	// through validation and CSF generation.
	async function buildSourceRegistry(): Promise<{
		registryFile: string;
		version: string;
	}> {
		const registryFile = join(dataDir, "source-registry.json");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--out",
			registryFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const { version } = JSON.parse(await Bun.file(registryFile).text()) as {
			version: string;
		};
		return { registryFile, version };
	}

	it("registry build --source の id で screen generate まで通る", async () => {
		const { registryFile, version } = await buildSourceRegistry();
		const screenFile = join(dataDir, "source-screen.json");
		await writeFile(
			screenFile,
			JSON.stringify({
				schemaVersion: "1.0",
				id: "source-screen",
				name: "型由来 id の画面",
				componentRegistryVersion: version,
				revision: 0,
				root: {
					id: "root",
					component: "Box",
					props: { className: "p-6" },
					slots: {
						children: [
							{
								id: "card",
								component: "sample-card#SampleCard",
								props: { title: "見出し", variant: "danger" },
								slots: {
									children: [
										{
											id: "badge",
											component: "variant-collision#CollidingBadge",
											// A variant that collides with an HTML attribute. If the
											// registry didn't hold it as an enum, this becomes INVALID_PROP_VALUE.
											props: { color: "primary" },
											slots: {},
										},
									],
								},
							},
						],
					},
				},
			}),
		);

		const outFile = join(dataDir, "source-screen.stories.tsx");
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--registry",
			registryFile,
			"--import-map",
			".=~/components",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(outFile).text();
		// The import statement is built from manifest.import, not the id — confirm the
		// export name and path are correct even for the new id scheme.
		expect(source).toContain(
			'import { SampleCard } from "~/components/sample-card";',
		);
		expect(source).toContain(
			'import { CollidingBadge } from "~/components/variant-collision";',
		);
		expect(source).toContain('<SampleCard title="見出し" variant="danger">');
		expect(source).toContain('<CollidingBadge color="primary" />');
	});

	it("registry build --source の id は不正な enum 値を検証で弾く", async () => {
		const { registryFile, version } = await buildSourceRegistry();
		const screenFile = join(dataDir, "broken-source-screen.json");
		await writeFile(
			screenFile,
			JSON.stringify({
				schemaVersion: "1.0",
				id: "broken-source-screen",
				name: "不正な variant",
				componentRegistryVersion: version,
				revision: 0,
				root: {
					id: "root",
					component: "variant-collision#CollidingBadge",
					props: { color: "brand" },
					slots: {},
				},
			}),
		);

		logs = [];
		const outFile = join(dataDir, "broken-source.stories.tsx");
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--registry",
			registryFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("INVALID_PROP_VALUE");
		expect(await Bun.file(outFile).exists()).toBe(false);
	});

	// Requiring the caller to mkdir the working directory first would add an extra step, so
	// the CLI creates it.
	it("registry build は未作成の --data-dir へも書き出せる", async () => {
		const freshDir = join(dataDir, "fresh", "nested");
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--data-dir",
			freshDir,
		]);
		expect(code).toBe(0);
		expect(await Bun.file(join(freshDir, "registry.json")).exists()).toBe(true);
	});

	// A registry made up of only synthetic primitives can still be written, so warn about it
	// so it doesn't get lost among the success message.
	it("registry build --source が 0 件のときは警告を出す", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"nowhere/**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--data-dir",
			join(dataDir, "empty"),
		]);
		expect(code).toBe(0);
		expect(output()).toContain("--source matched no files");
	});

	// A glob that matches files but no component exports (a non-React project, or globs
	// covering only utilities) used to look identical to a successful build.
	it("registry build --source がコンポーネントを1つも見つけないときは警告を出す", async () => {
		const hostRoot = join(dataDir, "nonreact-host");
		await mkdir(join(hostRoot, "src"), { recursive: true });
		await writeFile(
			join(hostRoot, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, jsx: "react-jsx" },
				include: ["src"],
			}),
		);
		await writeFile(
			join(hostRoot, "src", "util.ts"),
			"export function formatLabel(label: string): string {\n\treturn label.trim();\n}\n",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"src/**/*.ts",
			"--tsconfig",
			join(hostRoot, "tsconfig.json"),
			"--data-dir",
			join(dataDir, "nonreact-data"),
		]);
		expect(code).toBe(0);
		expect(output()).toContain("no React component exports were found");
		// The glob did match, so the files: 0 warning must stay silent.
		expect(output()).not.toContain("--source matched no files");
	});

	// A host whose @types/react does not resolve (pnpm's strict node_modules, or a host
	// without a direct dependency on it) degrades silently: ReactNode props flatten to
	// json and slots vanish while every count looks healthy. The temp directory is what
	// keeps the workspace's own @types/react out of reach.
	it("registry build --source は @types/react が解決できないときに警告を出す", async () => {
		const hostRoot = join(dataDir, "no-react-types-host");
		await mkdir(join(hostRoot, "components"), { recursive: true });
		await writeFile(
			join(hostRoot, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, jsx: "react-jsx" },
				include: ["components"],
			}),
		);
		await writeFile(
			join(hostRoot, "components", "button.tsx"),
			[
				'import type { ReactNode } from "react";',
				"export type ButtonProps = { icon?: ReactNode; children?: ReactNode };",
				"export function Button({ children }: ButtonProps) {",
				"\treturn <button>{children}</button>;",
				"}",
				"",
			].join("\n"),
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"components/**/*.tsx",
			"--tsconfig",
			join(hostRoot, "tsconfig.json"),
			"--data-dir",
			join(dataDir, "no-react-types-data"),
		]);
		expect(code).toBe(0);
		expect(output()).toContain(
			"check that the host's @types/react resolves through --tsconfig",
		);
		// Components were found, so the no-component warning must not also fire.
		expect(output()).not.toContain("no React component exports were found");
		// The degraded shape count is what --report readers correlate the warning with.
		expect(output()).toContain('"anyShapedProps": 2');
	});

	// The degradation warnings must ride inside the JSON object; a warning line printed
	// before it would make the output unparseable as one document.
	it("registry build --json は劣化警告も単一 JSON に畳み込む", async () => {
		const hostRoot = join(dataDir, "nonreact-host-json");
		await mkdir(join(hostRoot, "src"), { recursive: true });
		await writeFile(
			join(hostRoot, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, jsx: "react-jsx" },
				include: ["src"],
			}),
		);
		await writeFile(
			join(hostRoot, "src", "util.ts"),
			"export function formatLabel(label: string): string {\n\treturn label.trim();\n}\n",
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"src/**/*.ts",
			"--tsconfig",
			join(hostRoot, "tsconfig.json"),
			"--json",
			"--data-dir",
			join(dataDir, "nonreact-json-data"),
		]);
		expect(code).toBe(0);
		// Parseable as one document — nothing printed outside the object.
		const parsed = JSON.parse(output()) as { warnings: string[] };
		expect(parsed.warnings.join("\n")).toContain(
			"no React component exports were found",
		);
	});

	it("registry build --json は @types/react の警告も単一 JSON に畳み込む", async () => {
		const hostRoot = join(dataDir, "no-react-types-json-host");
		await mkdir(join(hostRoot, "components"), { recursive: true });
		await writeFile(
			join(hostRoot, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { strict: true, jsx: "react-jsx" },
				include: ["components"],
			}),
		);
		await writeFile(
			join(hostRoot, "components", "button.tsx"),
			[
				'import type { ReactNode } from "react";',
				"export type ButtonProps = { icon?: ReactNode; children?: ReactNode };",
				"export function Button({ children }: ButtonProps) {",
				"\treturn <button>{children}</button>;",
				"}",
				"",
			].join("\n"),
		);
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"components/**/*.tsx",
			"--tsconfig",
			join(hostRoot, "tsconfig.json"),
			"--json",
			"--data-dir",
			join(dataDir, "no-react-types-json-data"),
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as { warnings: string[] };
		expect(parsed.warnings.join("\n")).toContain(
			"@types/react resolves through --tsconfig",
		);
	});

	// --json folds the text output's mixed stream (Wrote line / warnings / stats / hints)
	// into one machine-readable object.
	it("registry build --json は結果を単一の JSON オブジェクトで返す", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const outFile = join(dataDir, "json-registry.json");
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"nowhere/**/*.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--out",
			outFile,
			"--json",
			"--data-dir",
			join(dataDir, "empty"),
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			out: string;
			version: string;
			count: number;
			stats: { files: number };
			warnings: string[];
			hints: string[];
		};
		expect(parsed.out).toBe(outFile);
		expect(parsed.count).toBeGreaterThan(0);
		expect(parsed.stats.files).toBe(0);
		expect(parsed.warnings.join("\n")).toContain("--source matched no files");
		expect(output()).not.toContain("Wrote ");
	});

	it("registry build --json は --index 単独でも同じ形で返す", async () => {
		const indexFile = join(dataDir, "json-index.json");
		await writeFile(
			indexFile,
			JSON.stringify({
				v: 5,
				entries: {
					"components-badge--default": {
						type: "story",
						id: "components-badge--default",
						name: "Default",
						title: "Components/Badge",
						importPath: "./badge.stories.tsx",
					},
				},
			}),
		);
		const outFile = join(dataDir, "json-index-registry.json");
		const code = await runCli([
			"registry",
			"build",
			"--index",
			indexFile,
			"--out",
			outFile,
			"--json",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			out: string;
			count: number;
			stats: null;
			warnings: string[];
			hints: string[];
		};
		expect(parsed.out).toBe(outFile);
		expect(parsed.count).toBeGreaterThan(0);
		// The index-only path has no extraction statistics.
		expect(parsed.stats).toBe(null);
	});

	// A fixable invocation must not read as an internal failure.
	it("registry build --source は --tsconfig 無しだと INVALID_ARGUMENT になる", async () => {
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"**/*.tsx",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("--tsconfig");
		expect(output()).toContain("INVALID_ARGUMENT");
		expect(output()).not.toContain("INTERNAL_ERROR");
	});

	// The structured path / dataDir let an agent see which --data-dir was consulted
	// without parsing the message.
	it("registry が無ければ REGISTRY_NOT_FOUND と path / dataDir を返す", async () => {
		const emptyDir = join(dataDir, "empty");
		const code = await runCli(["component", "list", "--data-dir", emptyDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; path: string; dataDir: string };
		};
		expect(parsed.error.code).toBe("REGISTRY_NOT_FOUND");
		expect(parsed.error.path).toBe(join(emptyDir, "registry.json"));
		expect(parsed.error.dataDir).toBe(emptyDir);
	});

	it("component inspect の未登録 id は COMPONENT_NOT_FOUND を返す", async () => {
		const code = await runCli([
			"component",
			"inspect",
			"Nope",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("COMPONENT_NOT_FOUND");
	});

	// The CLI's payloads are files: "Request payload" wording would point the reader
	// at a request that doesn't exist.
	it("スキーマ違反のファイルは Input file の文言で INVALID_REQUEST になる", async () => {
		const screenFile = join(dataDir, "bad.json");
		await writeFile(screenFile, JSON.stringify({ schemaVersion: "1.0" }));
		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			join(dataDir, "out.stories.tsx"),
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		expect(output()).toContain("INVALID_REQUEST");
		expect(output()).toContain("Input file failed schema validation.");
	});

	// Components whose props can't be read from types can only be supplemented via
	// `--metadata`, whose content mirrors the host's cva variants. Confirm end-to-end, from
	// generating the scaffold to applying it.
	it("registry metadata の雛形をそのまま --metadata に渡せる", async () => {
		const fixtureRoot = join(
			import.meta.dir,
			"..",
			"..",
			"registry",
			"__fixtures__",
		);
		const metadataFile = join(dataDir, "cva-metadata.json");
		const metadataCode = await runCli([
			"registry",
			"metadata",
			"typography#Text",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--out",
			metadataFile,
		]);
		expect(metadataCode).toBe(0);
		// Props other than variants don't make it into the scaffold. Staying silent here
		// would let the registry drift from reality.
		expect(output()).toContain("the template only covers cva variants");

		const registryFile = join(dataDir, "cva-registry.json");
		const buildCode = await runCli([
			"registry",
			"build",
			"--source",
			"typography.tsx",
			"--tsconfig",
			join(fixtureRoot, "tsconfig.json"),
			"--metadata",
			metadataFile,
			"--out",
			registryFile,
			"--data-dir",
			dataDir,
		]);
		expect(buildCode).toBe(0);
		const written = JSON.parse(await Bun.file(registryFile).text()) as {
			components: {
				id: string;
				props: Record<string, { kind: string; options?: unknown[] }>;
			}[];
		};
		const text = written.components.find(
			(component) => component.id === "typography#Text",
		);
		// A component whose types only expose className and as gets cva-derived variants added.
		expect(text?.props.size?.options).toEqual(["xsm", "sm", "md"]);
		expect(text?.props.bold?.kind).toBe("boolean");
	});

	it("registry metadata は基準ディレクトリの指定が無いとエラーになる", async () => {
		const code = await runCli(["registry", "metadata", "typography#Text"]);
		expect(code).toBe(1);
		expect(output()).toContain("--tsconfig");
	});

	// The real-world usage is running with cwd outside the host (in this case, on the
	// Yosegi side). Both the --source glob and the id's module path need to resolve
	// relative to --project-root / --tsconfig. Back when resolution was cwd-relative, this
	// matched zero files and returned an empty scaffold.
	describe("ホストの外を cwd にして registry metadata を実行する", () => {
		let hostRoot: string;

		beforeEach(async () => {
			hostRoot = join(dataDir, "host");
			await mkdir(join(hostRoot, "app", "components"), { recursive: true });
			await writeFile(
				join(hostRoot, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
			);
			await writeFile(
				join(hostRoot, "app", "components", "typography.tsx"),
				`import { cva } from "class-variance-authority";

const textVariants = cva("", {
	variants: {
		size: { sm: "text-sm", md: "text-base" },
		color: { primary: "text-primary", helper: "text-helper" },
		weight: { normal: "font-normal", bold: "font-bold" },
	},
	defaultVariants: { size: "md" },
});

export function Text() {
	return <p className={textVariants()} />;
}
`,
			);
		});

		// The scaffold is only the first line; the rest are Note: lines, so they aren't
		// parsed as JSON.
		function textProps(): Record<string, { options?: unknown[] }> {
			const parsed = JSON.parse(logs[0]) as Record<
				string,
				{ props: Record<string, { options?: unknown[] }> }
			>;
			return parsed["app/components/typography#Text"].props;
		}

		it("--source の glob を --tsconfig のディレクトリ基準で展開する", async () => {
			const code = await runCli([
				"registry",
				"metadata",
				"app/components/typography#Text",
				"--source",
				"app/components/**/*.tsx",
				"--tsconfig",
				join(hostRoot, "tsconfig.json"),
			]);
			expect(code).toBe(0);
			expect(textProps().size?.options).toEqual(["sm", "md"]);
			expect(textProps().color?.options).toEqual(["primary", "helper"]);
			expect(textProps().weight?.options).toEqual(["normal", "bold"]);
		});

		it("--project-root を渡せばそちらを基準にする", async () => {
			const code = await runCli([
				"registry",
				"metadata",
				"app/components/typography#Text",
				"--source",
				"app/components/**/*.tsx",
				"--project-root",
				hostRoot,
			]);
			expect(code).toBe(0);
			expect(textProps().size?.options).toEqual(["sm", "md"]);
		});

		it("--source 無しでも id のモジュールパスから解決する", async () => {
			const code = await runCli([
				"registry",
				"metadata",
				"app/components/typography#Text",
				"--tsconfig",
				join(hostRoot, "tsconfig.json"),
			]);
			expect(code).toBe(0);
			expect(textProps().size?.options).toEqual(["sm", "md"]);
		});
	});

	// The generated meta has only title; it doesn't include the boilerplate the host
	// requires for a Story. Since both the formatter and the linter would still pass
	// without it, pin down that the template can fill it in.
	it("screen generate は --meta-template の定型を meta へ差し込む", async () => {
		const templateFile = join(dataDir, "meta-template.tsx");
		await writeFile(
			templateFile,
			`import type { Meta } from "@storybook/react-vite";
import { DesignDocsPage } from "~/components/storybook/design-docs-page";

/**
 * 画面モック。
 */
const meta: Meta = {
	title: "Examples/Placeholder",
	tags: ["autodocs"],
	parameters: { docs: { page: DesignDocsPage } },
};

export default meta;
`,
		);
		const screenFile = join(dataDir, "meta-screen.json");
		await writeFile(screenFile, JSON.stringify(sampleScreen()));
		const outFile = join(dataDir, "meta-screen.stories.tsx");

		const code = await runCli([
			"screen",
			"generate",
			screenFile,
			"--out",
			outFile,
			"--title",
			"Screens/顧客一覧",
			"--meta-template",
			templateFile,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);

		const source = await Bun.file(outFile).text();
		expect(source).toContain("/**\n * 画面モック。\n */\nconst meta: Meta = {");
		expect(source).toContain('\ttitle: "Screens/顧客一覧",');
		expect(source).toContain('\ttags: ["autodocs"],');
		expect(source).toContain(
			"\tparameters: { docs: { page: DesignDocsPage } },",
		);
		expect(source).toContain(
			'import { DesignDocsPage } from "~/components/storybook/design-docs-page";',
		);
		// The template's title is not used, since the screen side decides it. Don't drop it
		// silently — warn about it.
		expect(output()).toContain('Ignored "title" from the meta template');
	});

	// --- example list / example apply (PoC) ---
	//
	// The catalog and its templates are host files, so every test here writes them into the
	// temp data dir and points --catalog at them, the same way a host would.

	// A template that is real, compiling code rather than a file of placeholders — the whole
	// premise of copy-and-own. It carries one multi-line import and one inline data literal,
	// which are exactly what the post-copy survey has to find.
	const SAMPLE_TEMPLATE = [
		'import { useState } from "react";',
		"import {",
		"\tButton,",
		"\tIconButton,",
		'} from "~/components/button";',
		"",
		"type Row = { id: string; name: string };",
		"",
		"const rows: Row[] = [{ id: \"1\", name: 'Sample' }];",
		"",
		"export function SampleScreenExample() {",
		"\tconst [selected, setSelected] = useState<string | null>(null);",
		"\treturn (",
		"\t\t<div>",
		"\t\t\t<Button onClick={() => setSelected(rows[0].id)}>{selected}</Button>",
		"\t\t\t<IconButton />",
		"\t\t</div>",
		"\t);",
		"}",
		"",
	].join("\n");

	// The rename's hard cases, all sharing "SampleScreenExample" as a prefix or as prose:
	// two imported identifiers that merely start with it, the name inside a comment, and the
	// name inside a string literal. Only the declaration and its references may change.
	const COLLIDING_TEMPLATE = [
		'import type { SampleScreenExampleProps } from "~/components/props";',
		'import { SampleScreenExampleHeader } from "~/components/header";',
		"",
		"// SampleScreenExample is the template this file was copied from.",
		'const label = "SampleScreenExample";',
		"",
		"export function SampleScreenExample(props: SampleScreenExampleProps) {",
		"\treturn <SampleScreenExampleHeader title={label} {...props} />;",
		"}",
		"",
	].join("\n");

	async function writeCatalog(
		entries: unknown[] = [
			{
				key: "sample-screen",
				label: "Sample screen",
				description: "A screen with a table and a button",
				templatePath: "templates/sample-screen.tsx",
				componentName: "SampleScreenExample",
			},
		],
		template: string = SAMPLE_TEMPLATE,
	): Promise<string> {
		await mkdir(join(dataDir, "templates"), { recursive: true });
		await writeFile(join(dataDir, "templates", "sample-screen.tsx"), template);
		const catalog = join(dataDir, "examples.json");
		await writeFile(catalog, JSON.stringify({ examples: entries }));
		return catalog;
	}

	it("example list はカタログの key・label・templatePath を列挙する", async () => {
		const catalog = await writeCatalog();
		const code = await runCli(["example", "list", "--catalog", catalog]);
		expect(code).toBe(0);
		expect(output()).toContain("sample-screen");
		expect(output()).toContain("Sample screen");
		expect(output()).toContain("A screen with a table and a button");
		expect(output()).toContain("templates/sample-screen.tsx");
		// The list's job is to make the next command decidable, so it spells that command out.
		expect(output()).toContain("yosegi example apply");
	});

	it("example list --json は機械可読なカタログを返す", async () => {
		const catalog = await writeCatalog();
		const code = await runCli([
			"example",
			"list",
			"--catalog",
			catalog,
			"--json",
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			total: number;
			examples: { key: string; componentName: string }[];
		};
		expect(parsed.total).toBe(1);
		expect(parsed.examples[0].key).toBe("sample-screen");
		expect(parsed.examples[0].componentName).toBe("SampleScreenExample");
	});

	// --catalog is only an override; the default location is the one a host that has run
	// nothing but `yosegi example apply` would use.
	it("example list は --catalog 省略時に <data-dir>/examples.json を読む", async () => {
		await writeCatalog();
		const code = await runCli(["example", "list", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("sample-screen");
	});

	it("example apply はテンプレートを複製し componentName を置換する", async () => {
		const catalog = await writeCatalog();
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		const written = await readFile(out, "utf8");
		expect(written).toContain("export function GuestListRoute()");
		expect(written).not.toContain("SampleScreenExample");
		// The copy owns itself, so it says so at the top rather than leaving a reader to
		// assume edits here will be overwritten by a later template change.
		expect(written).toContain('Copied from the "sample-screen" example');
		expect(written).toContain("does not track later changes to the template");
		// Everything else is carried over byte for byte.
		expect(written).toContain(
			"const rows: Row[] = [{ id: \"1\", name: 'Sample' }];",
		);
	});

	it("example apply は import と埋め込みデータを行番号付きで案内する", async () => {
		const catalog = await writeCatalog();
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
			"--json",
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			nextSteps: {
				imports: { specifier: string; line: number }[];
				mockData: { name: string; kind: string; line: number }[];
			};
		};
		expect(parsed.nextSteps.imports.map((entry) => entry.specifier)).toEqual([
			"react",
			"~/components/button",
		]);
		// The two provenance lines shift every position, and the reported line has to address
		// the file that now exists, not the template it came from.
		expect(parsed.nextSteps.imports[0].line).toBe(3);
		// The second import spans five lines in the source, which is why this is read off the
		// AST rather than matched line by line.
		expect(parsed.nextSteps.imports[1].line).toBe(4);
		expect(parsed.nextSteps.mockData).toEqual([
			{ name: "rows", kind: "array", line: 11 },
		]);
	});

	// The destination is a file the host owns and may already have edited.
	it("example apply は既存の --out を上書きせず EXAMPLE_OUTPUT_EXISTS を返す", async () => {
		const catalog = await writeCatalog();
		const out = join(dataDir, "routes", "guests.tsx");
		await mkdir(join(dataDir, "routes"), { recursive: true });
		await writeFile(out, "// hand-written\n");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as { error: { code: string } };
		expect(parsed.error.code).toBe("EXAMPLE_OUTPUT_EXISTS");
		expect(await readFile(out, "utf8")).toBe("// hand-written\n");
	});

	it("カタログが無い場合は EXAMPLE_CATALOG_NOT_FOUND を返す", async () => {
		const code = await runCli(["example", "list", "--data-dir", dataDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; path: string };
		};
		expect(parsed.error.code).toBe("EXAMPLE_CATALOG_NOT_FOUND");
		expect(parsed.error.path).toBe(join(dataDir, "examples.json"));
	});

	it("壊れたカタログは INVALID_REQUEST をファイル向け文言で返す", async () => {
		const catalog = join(dataDir, "examples.json");
		await writeFile(catalog, JSON.stringify({ examples: [{ key: "x" }] }));
		const code = await runCli(["example", "list", "--catalog", catalog]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; message: string };
		};
		expect(parsed.error.code).toBe("INVALID_REQUEST");
		expect(parsed.error.message).toContain("Input file");
	});

	it("未知の key は EXAMPLE_NOT_FOUND と候補を返す", async () => {
		const catalog = await writeCatalog();
		const code = await runCli([
			"example",
			"apply",
			"sample-scren",
			"--name",
			"GuestListRoute",
			"--out",
			join(dataDir, "routes", "guests.tsx"),
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; suggestion?: string; availableKeys: string[] };
		};
		expect(parsed.error.code).toBe("EXAMPLE_NOT_FOUND");
		expect(parsed.error.suggestion).toContain("sample-screen");
		expect(parsed.error.availableKeys).toEqual(["sample-screen"]);
	});

	it("templatePath が実在しない場合は EXAMPLE_TEMPLATE_NOT_FOUND を返す", async () => {
		const catalog = await writeCatalog([
			{
				key: "missing",
				label: "Missing",
				description: "points nowhere",
				templatePath: "templates/gone.tsx",
				componentName: "GoneExample",
			},
		]);
		const code = await runCli([
			"example",
			"apply",
			"missing",
			"--name",
			"GuestListRoute",
			"--out",
			join(dataDir, "routes", "guests.tsx"),
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; templatePath: string };
		};
		expect(parsed.error.code).toBe("EXAMPLE_TEMPLATE_NOT_FOUND");
		expect(parsed.error.templatePath).toBe(
			join(dataDir, "templates", "gone.tsx"),
		);
	});

	// --name is substituted into source text, so a non-identifier would write a file that
	// cannot parse. Rejected before the copy rather than after.
	it("identifier でない --name は INVALID_ARGUMENT を返す", async () => {
		const catalog = await writeCatalog();
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"guest-list",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as { error: { code: string } };
		expect(parsed.error.code).toBe("INVALID_ARGUMENT");
		expect(existsSync(out)).toBe(false);
	});

	it("example apply は --name 無しで MISSING_ARGUMENT を返す", async () => {
		const catalog = await writeCatalog();
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--out",
			join(dataDir, "routes", "guests.tsx"),
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; command: string };
		};
		expect(parsed.error.code).toBe("MISSING_ARGUMENT");
		expect(parsed.error.command).toBe("example apply");
	});

	// The catalog's componentName having drifted from the template leaves a file that copied
	// fine but kept the wrong export name — the one thing --name was asked to change.
	it("componentName を宣言していないテンプレートは複製しつつ警告する", async () => {
		const catalog = await writeCatalog([
			{
				key: "sample-screen",
				label: "Sample screen",
				description: "stale componentName",
				templatePath: "templates/sample-screen.tsx",
				componentName: "RenamedAgesAgoExample",
			},
		]);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		expect(output()).toContain('declares no "RenamedAgesAgoExample"');
		expect(await readFile(out, "utf8")).toContain("SampleScreenExample");
	});

	// A plain replaceAll rewrites `SampleScreenExampleProps` to `GuestListRouteProps`, which
	// the module it is imported from does not export, so the copy stops compiling. Only
	// identifier tokens that are the component itself may change.
	it("example apply は componentName を部分文字列に含む別識別子を置換しない", async () => {
		const catalog = await writeCatalog(undefined, COLLIDING_TEMPLATE);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		const written = await readFile(out, "utf8");
		// The declaration and its references are renamed.
		expect(written).toContain("export function GuestListRoute(");
		expect(written).not.toContain("export function SampleScreenExample(");
		// Identifiers that merely start with the same text are left alone, imports included.
		expect(written).toContain(
			'import type { SampleScreenExampleProps } from "~/components/props";',
		);
		expect(written).toContain(
			'import { SampleScreenExampleHeader } from "~/components/header";',
		);
		expect(written).toContain("props: SampleScreenExampleProps");
		expect(written).toContain("<SampleScreenExampleHeader");
		expect(written).not.toContain("GuestListRouteProps");
		expect(written).not.toContain("GuestListRouteHeader");
	});

	// Neither a comment nor a string literal is an identifier token, so neither is rewritten.
	it("example apply はコメントと文字列リテラル内の同名テキストを置換しない", async () => {
		const catalog = await writeCatalog(undefined, COLLIDING_TEMPLATE);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		const written = await readFile(out, "utf8");
		expect(written).toContain(
			"// SampleScreenExample is the template this file was copied from.",
		);
		expect(written).toContain('const label = "SampleScreenExample";');
	});

	// A name that appears only as prose is not a declaration, so the drift warning fires and
	// the file comes through untouched.
	it("コメント内にしか名前が無いテンプレートは置換せず警告する", async () => {
		const catalog = await writeCatalog(
			[
				{
					key: "sample-screen",
					label: "Sample screen",
					description: "name only in prose",
					templatePath: "templates/sample-screen.tsx",
					componentName: "OnlyInAComment",
				},
			],
			[
				"// OnlyInAComment used to live here.",
				"export function Kept() {",
				"\treturn null;",
				"}",
				"",
			].join("\n"),
		);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		expect(output()).toContain('declares no "OnlyInAComment"');
		const written = await readFile(out, "utf8");
		expect(written).toContain("// OnlyInAComment used to live here.");
		expect(written).not.toContain("GuestListRoute");
	});

	// A JSX attribute name and a property key carry the component's text without referring to
	// it, so rewriting them would change what the copy is passed and what shape it expects.
	it("example apply は JSX 属性名・プロパティキーを置換しない", async () => {
		const catalog = await writeCatalog(
			undefined,
			[
				'import { Card } from "~/card";',
				"",
				"const config = { SampleScreenExample: 1 };",
				"",
				"export function SampleScreenExample() {",
				"\treturn <Card SampleScreenExample={config.SampleScreenExample} />;",
				"}",
				"",
			].join("\n"),
		);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		const written = await readFile(out, "utf8");
		expect(written).toContain("export function GuestListRoute()");
		expect(written).toContain("const config = { SampleScreenExample: 1 };");
		expect(written).toContain(
			"<Card SampleScreenExample={config.SampleScreenExample} />",
		);
		expect(written).not.toContain("GuestListRoute={");
		expect(written).not.toContain("config.GuestListRoute");
	});

	// A local inside another function is not the exported component, so this is drift.
	it("ネストした宣言しか無いテンプレートは置換せず警告する", async () => {
		const catalog = await writeCatalog(
			undefined,
			[
				"export function Other() {",
				"\tconst SampleScreenExample = 1;",
				"\treturn SampleScreenExample;",
				"}",
				"",
			].join("\n"),
		);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(0);
		expect(output()).toContain('declares no "SampleScreenExample"');
		const written = await readFile(out, "utf8");
		expect(written).toContain("const SampleScreenExample = 1;");
		expect(written).not.toContain("GuestListRoute");
	});

	// A catalog componentName that is not an identifier can never name a component, and it
	// reaches a RegExp in the no-compiler fallback.
	it("identifier でない componentName は INVALID_ARGUMENT を返す", async () => {
		const catalog = await writeCatalog([
			{
				key: "sample-screen",
				label: "Sample screen",
				description: "bad componentName",
				templatePath: "templates/sample-screen.tsx",
				componentName: "Sample.*Example",
			},
		]);
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as { error: { code: string } };
		expect(parsed.error.code).toBe("INVALID_ARGUMENT");
		expect(existsSync(out)).toBe(false);
	});

	// An argument that is silently dropped lets a mistyped command run and report success,
	// which an agent then trusts — the same reason an unknown flag is rejected.
	it("example list は余分な positional を UNKNOWN_ARGUMENT で拒否する", async () => {
		const catalog = await writeCatalog();
		const code = await runCli([
			"example",
			"list",
			"typo",
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; command: string; unexpected: string[] };
		};
		expect(parsed.error.code).toBe("UNKNOWN_ARGUMENT");
		expect(parsed.error.command).toBe("example list");
		expect(parsed.error.unexpected).toEqual(["typo"]);
	});

	it("example apply は余分な positional を UNKNOWN_ARGUMENT で拒否する", async () => {
		const catalog = await writeCatalog();
		const out = join(dataDir, "routes", "guests.tsx");
		const code = await runCli([
			"example",
			"apply",
			"sample-screen",
			"typo",
			"--name",
			"GuestListRoute",
			"--out",
			out,
			"--catalog",
			catalog,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; unexpected: string[] };
		};
		expect(parsed.error.code).toBe("UNKNOWN_ARGUMENT");
		expect(parsed.error.unexpected).toEqual(["typo"]);
		// Rejected before anything was written.
		expect(existsSync(out)).toBe(false);
	});

	it("未知のコマンドは UNKNOWN_COMMAND と候補を返す", async () => {
		const code = await runCli(["compnent", "list", "--data-dir", dataDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; suggestion?: string };
		};
		expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
		expect(parsed.error.suggestion).toContain("component list");
		expect(output()).not.toContain("Yosegi CLI");
	});

	// A bare group is answered with that group's subcommands, not a fuzzy guess.
	it("サブコマンド無しの group はその group の候補を返す", async () => {
		const code = await runCli(["registry", "--data-dir", dataDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; suggestion?: string };
		};
		expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
		expect(parsed.error.suggestion).toContain("registry build");
		expect(parsed.error.suggestion).toContain("registry status");
	});

	// A misspelled flag used to be silently dropped, and the command ran as if it were
	// never passed — the worst failure mode for an agent, which then trusts the output.
	it("未知のフラグは UNKNOWN_FLAG と候補を返す", async () => {
		const code = await runCli(["component", "list", "--datadir", dataDir]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: {
				code: string;
				command: string;
				knownFlags: string[];
				suggestion?: string;
			};
		};
		expect(parsed.error.code).toBe("UNKNOWN_FLAG");
		expect(parsed.error.command).toBe("component list");
		expect(parsed.error.suggestion).toBe("Did you mean: --data-dir?");
		expect(parsed.error.knownFlags).toContain("--query");
	});

	// --search is nowhere near --query by edit distance, so it comes from the synonym table.
	it("--search には --query を候補として返す", async () => {
		const code = await runCli([
			"component",
			"list",
			"--search",
			"button",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(output()) as {
			error: { code: string; suggestion?: string };
		};
		expect(parsed.error.code).toBe("UNKNOWN_FLAG");
		expect(parsed.error.suggestion).toBe("Did you mean: --query?");
	});

	it("--help は usage を表示し exit 0", async () => {
		const code = await runCli(["--help"]);
		expect(code).toBe(0);
		expect(output()).toContain("Yosegi CLI");
		expect(output()).toContain("  mcp");
		expect(output()).toContain("claude mcp add yosegi -- npx yosegi mcp");
	});

	it("-h も usage を表示し exit 0", async () => {
		const code = await runCli(["-h"]);
		expect(code).toBe(0);
		expect(output()).toContain("Yosegi CLI");
	});

	it("--version は version と cliPath を JSON で返し exit 0", async () => {
		const code = await runCli(["--version"]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as { version: string; cliPath: string };
		expect(parsed.version).toBe(yosegiVersion());
		expect(parsed.cliPath).toBe(yosegiCliPath());
	});

	// With a command present, --version keeps its registry build meaning (a version ref).
	it("registry build の --version はこれまでどおり版の指定として扱う", async () => {
		const indexFile = join(dataDir, "index.json");
		await writeFile(indexFile, JSON.stringify({ v: 5, entries: {} }));
		const out = join(dataDir, "versioned.json");
		const code = await runCli([
			"registry",
			"build",
			"--index",
			indexFile,
			"--out",
			out,
			"--version",
			"ref:custom",
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		const written = JSON.parse(await Bun.file(out).text()) as {
			version: string;
		};
		expect(written.version).toBe("ref:custom");
	});

	it("引数なしは usage を表示し exit 1", async () => {
		const code = await runCli([]);
		expect(code).toBe(1);
		expect(output()).toContain("Yosegi CLI");
	});
});

// registry status recomputes the source hash the same way `registry build` does, from the
// inputs recorded on the registry — the sample fixture Registry has no inputs to recompute
// from, so these tests build a small real source instead.
describe("registry status", () => {
	let sourceDir: string;
	let dataDir: string;
	let logs: string[];
	const original = console.log;
	const originalWarn = console.warn;

	async function writeComponent(labelType: string): Promise<void> {
		await writeFile(
			join(sourceDir, "widget.tsx"),
			[
				"type Props = {",
				"\t/** A label. */",
				`\tlabel: ${labelType};`,
				"};",
				"",
				"/** A tiny component for registry status tests. */",
				"export function Widget({ label }: Props) {",
				"\treturn <div>{label}</div>;",
				"}",
				"",
			].join("\n"),
		);
	}

	beforeEach(async () => {
		sourceDir = await mkdtemp(join(tmpdir(), "vc-cli-status-src-"));
		dataDir = await mkdtemp(join(tmpdir(), "vc-cli-status-data-"));
		await writeFile(
			join(sourceDir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					lib: ["ESNext", "DOM"],
					target: "ESNext",
					module: "ESNext",
					moduleResolution: "bundler",
					jsx: "react-jsx",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
				},
				include: ["**/*.tsx"],
			}),
		);
		await writeComponent("string");
		logs = [];
		console.log = (value: unknown) => {
			logs.push(typeof value === "string" ? value : JSON.stringify(value));
		};
		console.warn = () => {};
	});

	afterEach(async () => {
		console.log = original;
		console.warn = originalWarn;
		await rm(sourceDir, { recursive: true, force: true });
		await rm(dataDir, { recursive: true, force: true });
	});

	function output(): string {
		return logs.join("\n");
	}

	async function build(): Promise<void> {
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"*.tsx",
			"--tsconfig",
			join(sourceDir, "tsconfig.json"),
			"--project-root",
			sourceDir,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		// Discard registry build's own output so it doesn't leak into the status assertions.
		logs = [];
	}

	it("ソースが変わっていなければ current と出す", async () => {
		await build();
		const code = await runCli(["registry", "status", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("source: current");
	});

	it("ソースを書き換えた後は stale と再ビルドのコマンドを出す", async () => {
		await build();
		// Changes the extracted prop's type, so the recomputed content hash differs.
		await writeComponent("number");
		const code = await runCli(["registry", "status", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("source: stale");
		expect(output()).toContain(
			`yosegi registry build --source "*.tsx" --tsconfig ${join(sourceDir, "tsconfig.json")} --project-root ${sourceDir}`,
		);
	});

	// Recorded inputs are read from the registry itself, so status doesn't need --source /
	// --tsconfig re-supplied on the command line.
	it("--source や --tsconfig を渡さなくても記録された inputs から再計算する", async () => {
		await build();
		const code = await runCli([
			"registry",
			"status",
			"--data-dir",
			dataDir,
			"--json",
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			sourceCheck: { checked: boolean; current?: boolean };
			indexCheck: { checked: boolean; reason?: string };
		};
		expect(parsed.sourceCheck.checked).toBe(true);
		expect(parsed.sourceCheck.current).toBe(true);
		// This fixture is built without --index, so there's no Storybook layer to check.
		expect(parsed.indexCheck.checked).toBe(false);
		expect(parsed.indexCheck.reason).toContain("without --index");
	});

	it("inputs の無い registry には unknown と理由を出す", async () => {
		await writeFile(
			join(dataDir, "registry.json"),
			JSON.stringify(sampleRegistry()),
		);
		const code = await runCli(["registry", "status", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("source: unknown");
		expect(output()).toContain("no recorded inputs");
	});

	// index.json cross-references widget.tsx by componentPath, the same shape
	// buildRegistryFromSource expects for curation.
	function indexFixture() {
		return {
			v: 5,
			entries: {
				"components-widget--default": {
					type: "story",
					id: "components-widget--default",
					name: "Default",
					title: "Components/Widget",
					importPath: "./widget.stories.tsx",
					componentPath: "./widget.tsx",
				},
			},
		};
	}

	async function buildWithIndex(indexPath: string): Promise<void> {
		const code = await runCli([
			"registry",
			"build",
			"--source",
			"*.tsx",
			"--tsconfig",
			join(sourceDir, "tsconfig.json"),
			"--project-root",
			sourceDir,
			"--index",
			indexPath,
			"--data-dir",
			dataDir,
		]);
		expect(code).toBe(0);
		logs = [];
	}

	it("index に到達できれば source / index どちらも current と出す", async () => {
		const indexPath = join(sourceDir, "index.json");
		await writeFile(indexPath, JSON.stringify(indexFixture()));
		await buildWithIndex(indexPath);
		const code = await runCli([
			"registry",
			"status",
			"--data-dir",
			dataDir,
			"--json",
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			sourceCheck: { checked: boolean; current?: boolean };
			indexCheck: { checked: boolean; current?: boolean };
		};
		expect(parsed.sourceCheck).toEqual({ checked: true, current: true });
		expect(parsed.indexCheck).toEqual({ checked: true, current: true });
	});

	// The bug this restructure fixes: Storybook down (or on a different port) used to sink
	// the whole `registry status` answer, even though the source hash never depended on
	// the index in the first place. Simulated here by deleting the recorded index file
	// after build — readJsonSource fails the same way for a moved file as for an
	// unreachable URL, so this exercises the same catch path without a real server.
	it("記録された index が読めなくても source の current 判定は落とさない", async () => {
		const indexPath = join(sourceDir, "index.json");
		await writeFile(indexPath, JSON.stringify(indexFixture()));
		await buildWithIndex(indexPath);
		await rm(indexPath);
		const code = await runCli([
			"registry",
			"status",
			"--data-dir",
			dataDir,
			"--json",
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(output()) as {
			sourceCheck: { checked: boolean; current?: boolean };
			indexCheck: { checked: boolean; reason?: string };
		};
		expect(parsed.sourceCheck).toEqual({ checked: true, current: true });
		expect(parsed.indexCheck.checked).toBe(false);
		expect(parsed.indexCheck.reason).toContain("index unreachable");
		expect(parsed.indexCheck.reason).toContain(
			"source check above is unaffected",
		);
	});

	it("記録された index が読めず、かつ text 表示でも source: current と index: unknown を両方出す", async () => {
		const indexPath = join(sourceDir, "index.json");
		await writeFile(indexPath, JSON.stringify(indexFixture()));
		await buildWithIndex(indexPath);
		await rm(indexPath);
		const code = await runCli(["registry", "status", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("source: current");
		expect(output()).toContain("index: unknown — index unreachable");
		expect(output()).not.toContain("stale");
	});

	// When source itself already changed, the merged hash would differ regardless of the
	// index layer, so the implementation doesn't even attempt to fetch it — the reason
	// says so explicitly instead of misreporting "index unreachable".
	it("ソースが stale なら index の再取得はせず理由を出す", async () => {
		const indexPath = join(sourceDir, "index.json");
		await writeFile(indexPath, JSON.stringify(indexFixture()));
		await buildWithIndex(indexPath);
		await writeComponent("number");
		const code = await runCli(["registry", "status", "--data-dir", dataDir]);
		expect(code).toBe(0);
		expect(output()).toContain("source: stale");
		expect(output()).toContain("index: unknown — source already changed");
	});
});

// `yosegi mcp` can't be verified by calling runCli directly (it doesn't return until the
// connection closes). Actually spawn it as a child process and check that MCP's initialize
// handshake succeeds over stdio.
describe("yosegi mcp", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "vc-mcp-"));
		await mkdir(join(dataDir, "screens"), { recursive: true });
		await writeFile(
			join(dataDir, "registry.json"),
			JSON.stringify(sampleRegistry()),
		);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("stdio で initialize に応答し tools を返す", async () => {
		const cliEntry = fileURLToPath(new URL("./main.ts", import.meta.url));
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cliEntry, "mcp", "--data-dir", dataDir],
		});
		const client = new Client({ name: "cli-test", version: "0.0.0" });
		try {
			// connect performs the full initialize round trip. If this succeeds, the
			// subcommand started and is responding to the handshake.
			await client.connect(transport);
			expect(client.getServerVersion()?.name).toBe("yosegi");

			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toContain(
				"search_components",
			);
		} finally {
			await client.close();
		}
	}, 30_000);
});
