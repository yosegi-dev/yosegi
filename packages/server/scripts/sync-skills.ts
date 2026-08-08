import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The source of truth for Agent Skills is skills/ at the repo root. This matches the convention
// that `npx skills add <owner>/<repo>`-style installers read skills/<name>/SKILL.md directly from the repo.
//
// For npm, they're distributed bundled inside @yosegi/yosegi (so users can copy them out of
// node_modules). Since files outside the package can't be listed in `files`, this copies them
// here right before pack. The copy destination is gitignored; the source of truth is always the root.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SKILLS_SOURCE_DIR = resolve(PACKAGE_ROOT, "..", "..", "skills");
export const SKILLS_TARGET_DIR = join(PACKAGE_ROOT, "skills");

// Lists every file under a directory by relative path (sorted to keep comparisons stable).
export function listSkillFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.sort();
}

// Re-copies skills/ from the root from scratch. This rebuilds rather than diff-updates so that a
// file deleted at the root can't linger in the copy and end up in the published package.
export function syncSkills(): string[] {
	if (!existsSync(SKILLS_SOURCE_DIR)) {
		throw new Error(`Skills source not found at ${SKILLS_SOURCE_DIR}.`);
	}
	rmSync(SKILLS_TARGET_DIR, { recursive: true, force: true });
	cpSync(SKILLS_SOURCE_DIR, SKILLS_TARGET_DIR, { recursive: true });
	return listSkillFiles(SKILLS_TARGET_DIR);
}

// Returns the places where the copy doesn't match the root. An empty array means it's in sync.
export function findSkillDrift(): string[] {
	const source = listSkillFiles(SKILLS_SOURCE_DIR);
	const target = listSkillFiles(SKILLS_TARGET_DIR);
	const drift: string[] = [];

	for (const file of source) {
		if (!target.includes(file)) {
			drift.push(`missing in package: ${file}`);
			continue;
		}
		const from = readFileSync(join(SKILLS_SOURCE_DIR, file));
		const to = readFileSync(join(SKILLS_TARGET_DIR, file));
		if (!from.equals(to)) drift.push(`content differs: ${file}`);
	}
	for (const file of target) {
		if (!source.includes(file)) drift.push(`stale in package: ${file}`);
	}
	return drift;
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		const drift = findSkillDrift();
		if (drift.length > 0) {
			console.error(
				`packages/server/skills is out of sync with skills/:\n  ${drift.join("\n  ")}\nRun: bun run sync:skills`,
			);
			process.exit(1);
		}
		console.log("packages/server/skills is in sync with skills/.");
	} else {
		const files = syncSkills();
		console.log(
			`Synced ${files.length} skill file(s) into packages/server/skills.`,
		);
	}
}
