import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComposerError, SERVICE_CODES } from "@yosegi/core";
import {
	HOST_CONFIG_FILENAME,
	hostConfigDefaults,
	loadHostConfig,
	NO_HOST_CONFIG,
} from "./host-config.ts";

describe("loadHostConfig", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "yosegi-config-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function write(
		directory: string,
		content: unknown | string,
	): Promise<string> {
		await mkdir(directory, { recursive: true });
		const path = join(directory, HOST_CONFIG_FILENAME);
		await writeFile(
			path,
			typeof content === "string" ? content : JSON.stringify(content),
		);
		return path;
	}

	async function expectComposerError(
		promise: Promise<unknown>,
	): Promise<ComposerError> {
		try {
			await promise;
		} catch (error) {
			expect(error).toBeInstanceOf(ComposerError);
			return error as ComposerError;
		}
		throw new Error("expected the load to fail");
	}

	it("cwd から上方探索して config を見つける", async () => {
		const path = await write(root, { dataDir: ".yosegi" });
		const nested = join(root, "packages", "web", "src");
		await mkdir(nested, { recursive: true });
		const loaded = await loadHostConfig({ cwd: nested });
		expect(loaded?.path).toBe(path);
		expect(loaded?.config.dataDir).toBe(".yosegi");
	});

	// The nearest config wins, so a workspace package can override the repository root.
	it("上方探索は最も近い config で止まる", async () => {
		await write(root, { dataDir: "root-dir" });
		const nested = join(root, "packages", "web");
		await write(nested, { dataDir: "package-dir" });
		const loaded = await loadHostConfig({ cwd: nested });
		expect(loaded?.config.dataDir).toBe("package-dir");
	});

	it("config が無ければ null を返す", async () => {
		const nested = join(root, "empty");
		await mkdir(nested, { recursive: true });
		expect(await loadHostConfig({ cwd: nested })).toBeNull();
	});

	it("--config は cwd 基準で解決され、上方探索より優先される", async () => {
		await write(root, { dataDir: "discovered" });
		const explicit = join(root, "custom", "elsewhere.json");
		await mkdir(join(root, "custom"), { recursive: true });
		await writeFile(explicit, JSON.stringify({ dataDir: "explicit" }));
		const loaded = await loadHostConfig({
			cwd: root,
			explicitPath: "custom/elsewhere.json",
		});
		expect(loaded?.path).toBe(explicit);
		expect(loaded?.config.dataDir).toBe("explicit");
	});

	// Discovery finding nothing is normal; an explicitly named file that isn't there is not.
	it("--config の指す先が無ければ CONFIG_NOT_FOUND", async () => {
		const error = await expectComposerError(
			loadHostConfig({ cwd: root, explicitPath: "missing.json" }),
		);
		expect(error.code).toBe(SERVICE_CODES.CONFIG_NOT_FOUND);
		expect(error.details?.path).toBe(join(root, "missing.json"));
	});

	// Nothing was read, so there is neither a key to suggest against nor a schema issue to
	// report — the payload carries the path alone. The skill's reference documents that
	// split, so keep it asserted rather than implied.
	it("壊れた JSON は CONFIG_INVALID で path だけを返す", async () => {
		const path = await write(root, "{ not json");
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.details?.path).toBe(path);
		expect(error.details?.issues).toBeUndefined();
		expect(error.suggestion).toBeNull();
	});

	it("未知のキーは CONFIG_INVALID になり候補を添える", async () => {
		await write(root, { datadir: ".yosegi" });
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.suggestion).toBe("Did you mean: dataDir?");
	});

	it("ネストした未知のキーも拒否する", async () => {
		await write(root, { registry: { sources: ["**/*.tsx"] } });
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.suggestion).toBe("Did you mean: source?");
	});

	// A suggestion is only ever derived from an unrecognized key, so a well-named key with a
	// wrong value leaves the reader with issues and nothing else.
	it("型が違う値は CONFIG_INVALID になり issues のみを返す", async () => {
		await write(root, { registry: { source: "**/*.tsx" } });
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(Array.isArray(error.details?.issues)).toBe(true);
		expect(error.suggestion).toBeNull();
	});

	// Even an unknown key only gets a suggestion when something is close enough to it.
	it("近い候補が無い未知のキーには suggestion が付かない", async () => {
		await write(root, { totallyUnrelated: 1 });
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.suggestion).toBeNull();
		expect(Array.isArray(error.details?.issues)).toBe(true);
	});

	// Climbing past a broken config would silently hand back a different one.
	it("壊れた config は上方探索を止める", async () => {
		await write(root, { dataDir: "root-dir" });
		const nested = join(root, "packages", "web");
		await write(nested, "{");
		const error = await expectComposerError(loadHostConfig({ cwd: nested }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.details?.path).toBe(join(nested, HOST_CONFIG_FILENAME));
	});

	it("examples の重複キーは CONFIG_INVALID", async () => {
		const example = {
			key: "list",
			label: "List",
			description: "",
			templatePath: "templates/list.tsx",
			componentName: "List",
		};
		await write(root, { examples: [example, example] });
		const error = await expectComposerError(loadHostConfig({ cwd: root }));
		expect(error.code).toBe(SERVICE_CODES.CONFIG_INVALID);
		expect(error.details?.duplicateKeys).toEqual(["list"]);
		// The schema accepted it, so this fault reports duplicateKeys in place of issues.
		expect(error.details?.issues).toBeUndefined();
	});
});

describe("hostConfigDefaults", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "yosegi-config-defaults-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("config が無ければ何も供給しない", () => {
		expect(hostConfigDefaults(null)).toEqual(NO_HOST_CONFIG);
	});

	// The point of the file: the same command means the same thing from any cwd.
	it("相対パスは config ファイルの位置基準で解決する", () => {
		const configDir = join(root, "repo");
		const defaults = hostConfigDefaults({
			path: join(configDir, HOST_CONFIG_FILENAME),
			config: {
				dataDir: ".yosegi",
				registry: {
					tsconfig: "./tsconfig.json",
					metadata: "tools/metadata.json",
				},
				emit: { metaTemplate: "./.storybook/meta.tsx" },
			},
		});
		expect(defaults.dataDir).toBe(join(configDir, ".yosegi"));
		expect(defaults.tsconfig).toBe(join(configDir, "tsconfig.json"));
		expect(defaults.metadata).toBe(join(configDir, "tools/metadata.json"));
		expect(defaults.metaTemplate).toBe(join(configDir, ".storybook/meta.tsx"));
	});

	// --source globs are matched against --project-root, not the config's directory, so
	// rewriting them here would change which files a glob covers and which ids they produce.
	it("registry.source の glob は書き換えない", () => {
		const defaults = hostConfigDefaults({
			path: join(root, HOST_CONFIG_FILENAME),
			config: { registry: { source: ["app/**/*.tsx"] } },
		});
		expect(defaults.registrySources).toEqual(["app/**/*.tsx"]);
	});

	it("importMap は --import-map と同じ 1 本の文字列に畳む", () => {
		const defaults = hostConfigDefaults({
			path: join(root, HOST_CONFIG_FILENAME),
			config: { emit: { importMap: ["./app=~", "./lib=@lib"] } },
		});
		expect(defaults.importMap).toBe("./app=~,./lib=@lib");
	});

	it("examples の templatePath も config 基準で解決する", () => {
		const defaults = hostConfigDefaults({
			path: join(root, HOST_CONFIG_FILENAME),
			config: {
				examples: [
					{
						key: "list",
						label: "List screen",
						description: "A list with filters",
						templatePath: "./examples/list.tsx",
						componentName: "ListScreen",
					},
				],
			},
		});
		expect(defaults.examples[0]?.templatePath).toBe(
			join(root, "examples/list.tsx"),
		);
		expect(defaults.examples[0]?.componentName).toBe("ListScreen");
	});
});
