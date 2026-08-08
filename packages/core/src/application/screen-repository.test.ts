import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_CODES } from "../domain/errors.ts";
import type { ScreenDefinition } from "../domain/screen-definition.ts";
import { sampleScreen } from "../test-fixtures.ts";
import {
	FileScreenRepository,
	InMemoryScreenRepository,
} from "./screen-repository.ts";

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

async function makeFileRepo(): Promise<FileScreenRepository> {
	const dir = await mkdtemp(join(tmpdir(), "vc-repo-"));
	tempDirs.push(dir);
	return new FileScreenRepository(dir);
}

for (const [label, make] of [
	["InMemory", async () => new InMemoryScreenRepository()],
	["File", makeFileRepo],
] as const) {
	describe(`ScreenRepository (${label})`, () => {
		it("作成・取得・一覧・削除できる", async () => {
			const repo = await make();
			await repo.create(sampleScreen());
			expect((await repo.get("customer-list"))?.name).toBe("Customer list");
			const list = await repo.list();
			expect(list.map((s) => s.id)).toContain("customer-list");
			await repo.delete("customer-list");
			expect(await repo.exists("customer-list")).toBe(false);
		});

		it("存在しない画面は null", async () => {
			const repo = await make();
			expect(await repo.get("nope")).toBe(null);
		});

		it("重複作成は SCREEN_ALREADY_EXISTS", async () => {
			const repo = await make();
			await repo.create(sampleScreen());
			expect(repo.create(sampleScreen())).rejects.toMatchObject({
				code: SERVICE_CODES.SCREEN_ALREADY_EXISTS,
			});
		});

		it("save は上書きする", async () => {
			const repo = await make();
			await repo.create(sampleScreen());
			const updated = { ...sampleScreen(), name: "更新後" };
			await repo.save(updated);
			expect((await repo.get("customer-list"))?.name).toBe("更新後");
		});

		it("expectedRevision 不一致の save は RevisionConflictError", async () => {
			const repo = await make();
			await repo.create(sampleScreen());
			expect(
				repo.save({ ...sampleScreen(), name: "x", revision: 2 }, 99),
			).rejects.toMatchObject({ code: SERVICE_CODES.REVISION_CONFLICT });
		});

		it("同一 expectedRevision の並行 save は一方のみ成功する（CAS）", async () => {
			const repo = await make();
			await repo.create(sampleScreen());
			const results = await Promise.allSettled([
				repo.save({ ...sampleScreen(), name: "A", revision: 2 }, 1),
				repo.save({ ...sampleScreen(), name: "B", revision: 2 }, 1),
			]);
			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
				code: SERVICE_CODES.REVISION_CONFLICT,
			});
		});

		// If the existence check isn't inside the same lock as the write, both could see
		// "not there yet" and one would silently get overwritten.
		it("同じ id への並行 create は一方だけ成功する", async () => {
			const repo = await make();
			const results = await Promise.allSettled([
				repo.create({ ...sampleScreen(), name: "先" }),
				repo.create({ ...sampleScreen(), name: "後" }),
			]);
			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
				code: SERVICE_CODES.SCREEN_ALREADY_EXISTS,
			});
			expect((await repo.get("customer-list"))?.name).toBe(
				(fulfilled[0] as PromiseFulfilledResult<ScreenDefinition>).value.name,
			);
		});
	});
}

// id becomes the file name, so it must not be able to point outside the storage dir. The
// Screen Definition schema also rejects this, but get / exists accept an id without going through the schema.
describe("FileScreenRepository: 保存先の外を指す id", () => {
	const escapingIds = [
		"../../victim/target",
		"../outside",
		"nested/child",
		"/etc/passwd",
	];

	it("読み書きのどの入口でも INVALID_SCREEN_ID で拒否する", async () => {
		const repo = await makeFileRepo();
		for (const id of escapingIds) {
			const rejected = { code: SERVICE_CODES.INVALID_SCREEN_ID };
			expect(repo.get(id)).rejects.toMatchObject(rejected);
			expect(repo.exists(id)).rejects.toMatchObject(rejected);
			expect(repo.delete(id)).rejects.toMatchObject(rejected);
			expect(repo.create({ ...sampleScreen(), id })).rejects.toMatchObject(
				rejected,
			);
			expect(repo.save({ ...sampleScreen(), id })).rejects.toMatchObject(
				rejected,
			);
		}
	});

	it("保存先の外にファイルを作らない", async () => {
		const dir = await mkdtemp(join(tmpdir(), "vc-repo-"));
		tempDirs.push(dir);
		const repo = new FileScreenRepository(join(dir, "screens"));
		await repo
			.create({ ...sampleScreen(), id: "../escaped" })
			.catch(() => undefined);
		expect(existsSync(join(dir, "escaped.json"))).toBe(false);
	});
});
