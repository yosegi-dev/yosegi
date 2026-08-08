import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DATA_DIR, screensDir, seedDataDir } from "./config.ts";

// The default save location must be on the host side. Moving it back inside the package would
// wipe the user's screens on reinstall, and would also fail to write in environments where
// node_modules is read-only.
describe("DEFAULT_DATA_DIR", () => {
	it("パッケージ内ではなく cwd 配下を指す", () => {
		expect(DEFAULT_DATA_DIR).toBe(join(process.cwd(), ".yosegi"));
		expect(DEFAULT_DATA_DIR).not.toContain("node_modules");
	});
});

// Verifies seedDataDir's first-run seeding and its "deleted screens don't come back" behavior.
describe("seedDataDir", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "vc-config-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("初回はシード画面をコピーする", async () => {
		await seedDataDir(dir);
		const files = await readdir(screensDir(dir));
		expect(files.some((f) => f.endsWith(".json"))).toBe(true);
	});

	it("全画面を削除して再実行しても復活しない", async () => {
		await seedDataDir(dir);
		// Reproduces the situation where the user deleted every screen.
		for (const file of await readdir(screensDir(dir))) {
			await rm(join(screensDir(dir), file));
		}
		// Equivalent to a second startup. The sentinel is present, so it isn't reseeded.
		await seedDataDir(dir);
		const files = await readdir(screensDir(dir));
		expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
	});

	it("既存ユーザーデータがある場合はシードで上書きしない", async () => {
		// The case where only user screens exist, with no sentinel yet.
		await mkdir(screensDir(dir), { recursive: true });
		await writeFile(join(screensDir(dir), "mine.json"), "{}");
		await seedDataDir(dir);
		const files = await readdir(screensDir(dir));
		expect(files).toContain("mine.json");
		// The seed screens are not applied (the sentinel is set, so future runs skip it).
		expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
	});
});
