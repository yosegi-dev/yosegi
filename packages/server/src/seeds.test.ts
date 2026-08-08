import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	isSyntheticManifest,
	parseComponentRegistry,
	parseScreenDefinition,
	validateScreen,
} from "@yosegi/core";

// Guards the consistency of the bundled seed (registry + screens). If this breaks, the sample
// screens shown on first run could end up referencing "unregistered" components, so this locks
// down that seed screens pass validation against the seed registry with no errors, and that
// filenames match ids.
const seedsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "seeds");

async function loadJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

describe("seed data", () => {
	it("seed registry がパースでき、合成プリミティブを含む", async () => {
		const registry = parseComponentRegistry(
			await loadJson(join(seedsDir, "registry.json")),
		);
		const ids = registry.components.map((c) => c.id);
		expect(ids).toContain("Box");
		expect(ids).toContain("Text");
		expect(ids).toContain("Heading");
	});

	// Synthetic primitives are supposed to expand into plain JSX when a Story is generated, and
	// must never be imported from a real package. If the sentinel packageName slips, the generated
	// output ends up depending on Yosegi itself.
	it("seed registry の合成プリミティブが番兵 packageName を保っている", async () => {
		const registry = parseComponentRegistry(
			await loadJson(join(seedsDir, "registry.json")),
		);
		for (const manifest of registry.components) {
			expect(isSyntheticManifest(manifest)).toBe(true);
		}
	});

	it("全 seed 画面が seed registry で検証エラー無しに通り、id とファイル名が一致する", async () => {
		const registry = parseComponentRegistry(
			await loadJson(join(seedsDir, "registry.json")),
		);
		const screensDir = join(seedsDir, "screens");
		const files = (await readdir(screensDir)).filter((f) =>
			f.endsWith(".json"),
		);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const screen = parseScreenDefinition(
				await loadJson(join(screensDir, file)),
			);
			const result = validateScreen(screen, registry);
			// If there are errors, print the details and fail.
			if (result.errors.length > 0) {
				throw new Error(
					`${file} の検証エラー: ${JSON.stringify(result.errors)}`,
				);
			}
			expect(`${screen.id}.json`).toBe(file);
		}
	});
});
