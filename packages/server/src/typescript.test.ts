import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	compilerApiFix,
	formatTypeScriptLoadFailure,
	hasCompilerApi,
	loadTypeScript,
	resolveTypeScript,
} from "./typescript.ts";

// Both entries, in one command: `typescript` alone would leave the host without a `tsc`.
const ALIAS_COMMAND =
	"npm install -D @typescript/native@npm:typescript typescript@npm:@typescript/typescript6";

// bun cannot resolve the alias above, so it gets the 6.x compiler as a direct dependency.
const BUN_COMMAND =
	"bun add -d @typescript/native@npm:typescript typescript@^6";

// What `require("typescript")` returns on a host that installed 7.0.
const STUB_MODULE = { version: "7.0.2", versionMajorMinor: "7.0" };

describe("loadTypeScript", () => {
	it("読み込みに成功すると compiler API が使える", () => {
		expect(typeof loadTypeScript().createSourceFile).toBe("function");
	});

	it("自分が解決した typescript を報告できる", () => {
		const resolved = resolveTypeScript();
		expect(resolved).not.toBeNull();
		expect(resolved).toContain("@");
	});
});

describe("hasCompilerApi", () => {
	it("TypeScript 7.0 が返すスタブは compiler API と認めない", () => {
		expect(hasCompilerApi(STUB_MODULE)).toBe(false);
	});

	it("実際の typescript は compiler API と認める", () => {
		expect(hasCompilerApi(loadTypeScript())).toBe(true);
	});

	it("オブジェクトでない値も compiler API と認めない", () => {
		expect(hasCompilerApi(null)).toBe(false);
	});
});

describe("formatTypeScriptLoadFailure", () => {
	it("TypeScript 7 なら 6 と 7 の併存インストールを示す", () => {
		const message = formatTypeScriptLoadFailure("typescript@7.0.2", "boom");
		expect(message).toContain("typescript@7.0.2");
		expect(message).toContain(ALIAS_COMMAND);
		expect(message).toContain("boom");
	});

	// bun resolves the compatibility package back to itself, so a bun host that followed the
	// alias command alone would hit a second failure. Both forms have to be on screen.
	it("TypeScript 7 なら bun 向けの直接依存も併記する", () => {
		const message = formatTypeScriptLoadFailure("typescript@7.0.2", "boom");
		expect(message).toContain(BUN_COMMAND);
	});

	// The alias is the wrong advice below 7, where the API is present and the failure is
	// something else entirely.
	it("TypeScript 6 では併存インストールを勧めない", () => {
		const message = formatTypeScriptLoadFailure("typescript@6.0.3", "boom");
		expect(message).toContain("typescript@6.0.3");
		expect(message).not.toContain(ALIAS_COMMAND);
		expect(message).not.toContain(BUN_COMMAND);
	});

	it("解決先が不明なら推測せず原因だけを伝える", () => {
		const message = formatTypeScriptLoadFailure(null, "boom");
		expect(message).not.toContain(ALIAS_COMMAND);
		expect(message).not.toContain(BUN_COMMAND);
		expect(message).toContain("Underlying error: boom");
	});

	// The compatibility package resolves as `@typescript/typescript6@6.x`. The major is read
	// from the version, so the scope's own `@` must not be mistaken for the separator.
	it("併存インストール済みのエイリアスには何も勧めない", () => {
		expect(compilerApiFix("@typescript/typescript6@6.0.3")).toEqual([]);
	});
});

// The regression this guards against is a compiler API dereference that runs while a module
// is being evaluated: it throws before any command starts, so it takes down every command
// that the CLI merely imports its way past — `yosegi --help` included. The check has to be a
// real process, because the failure is in module evaluation and this test file has already
// loaded the compiler API for the assertions above.
describe("compiler API を持たない typescript のホスト", () => {
	const cliEntry = fileURLToPath(
		new URL("./adapters/cli/main.ts", import.meta.url),
	);
	let directory: string;
	let preload: string;

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "yosegi-no-compiler-api-"));
		// Bun's module plugin is what makes "typescript" resolve to the 7.0 stub for the
		// spawned process only. Installing an actual TypeScript 7 to test against would
		// mean a second copy of a 23MB package in the workspace.
		preload = join(directory, "stub-typescript.ts");
		await writeFile(
			preload,
			[
				'import { plugin } from "bun";',
				"",
				"plugin({",
				'\tname: "typescript without a compiler API",',
				"\tsetup(build) {",
				'\t\tbuild.module("typescript", () => ({',
				`\t\t\texports: ${JSON.stringify(STUB_MODULE)},`,
				'\t\t\tloader: "object",',
				"\t\t}));",
				"\t},",
				"});",
				"",
			].join("\n"),
		);
		await mkdir(join(directory, "src"), { recursive: true });
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { jsx: "react-jsx", strict: true },
				include: ["src"],
			}),
		);
		await writeFile(
			join(directory, "src", "button.tsx"),
			"export function Button({ label }: { label: string }) {\n\treturn <button>{label}</button>;\n}\n",
		);
	});

	afterAll(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	const run = (args: string[]): { exitCode: number; output: string } => {
		const result = Bun.spawnSync(
			[process.execPath, "--preload", preload, cliEntry, ...args],
			{ cwd: directory },
		);
		return {
			exitCode: result.exitCode,
			output: `${result.stdout.toString()}${result.stderr.toString()}`,
		};
	};

	it("--help は compiler API を必要としないので成功する", () => {
		const { exitCode, output } = run(["--help"]);
		expect(exitCode).toBe(0);
		expect(output).toContain("Yosegi CLI");
	}, 30_000);

	it("型を読むコマンドは直し方つきで失敗する", () => {
		const { exitCode, output } = run([
			"registry",
			"build",
			"--source",
			"src/**/*.tsx",
			"--project-root",
			directory,
			"--tsconfig",
			join(directory, "tsconfig.json"),
			"--out",
			join(directory, "registry.json"),
		]);
		expect(exitCode).not.toBe(0);
		expect(output).toContain("Failed to load the TypeScript compiler API");
	}, 30_000);
});
