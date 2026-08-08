import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	findSkillDrift,
	listSkillFiles,
	SKILLS_SOURCE_DIR,
	SKILLS_TARGET_DIR,
	syncSkills,
} from "./sync-skills.ts";

describe("skills の同期", () => {
	it("root の skills/ に Agent Skill がある", () => {
		expect(existsSync(join(SKILLS_SOURCE_DIR, "yosegi", "SKILL.md"))).toBe(
			true,
		);
	});

	it("同期後は root と複製が完全に一致する", () => {
		syncSkills();

		expect(listSkillFiles(SKILLS_TARGET_DIR)).toEqual(
			listSkillFiles(SKILLS_SOURCE_DIR),
		);
		expect(findSkillDrift()).toEqual([]);
	});

	it("複製側の内容書き換えを drift として検出する", () => {
		syncSkills();
		const skill = join(SKILLS_TARGET_DIR, "yosegi", "SKILL.md");
		writeFileSync(skill, `${readFileSync(skill, "utf8")}\ndrift\n`);

		expect(findSkillDrift()).toEqual(["content differs: yosegi/SKILL.md"]);

		// Restores it so the copy used by later tests and by publish doesn't stay broken.
		syncSkills();
	});

	it("root に無いファイルが複製に残っていたら drift として検出する", () => {
		syncSkills();
		writeFileSync(join(SKILLS_TARGET_DIR, "yosegi", "stale.md"), "stale\n");

		expect(findSkillDrift()).toEqual(["stale in package: yosegi/stale.md"]);

		syncSkills();
		expect(findSkillDrift()).toEqual([]);
	});
});
