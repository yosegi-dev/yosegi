import { beforeEach, describe, expect, it } from "bun:test";
import { SERVICE_CODES } from "../domain/errors.ts";
import { sampleRegistry, sampleScreen } from "../test-fixtures.ts";
import { agentActor, systemActor } from "./actor.ts";
import { ComponentService } from "./component-service.ts";
import { InMemoryScreenRepository } from "./screen-repository.ts";
import { ScreenService, ValidationFailedError } from "./screen-service.ts";

function setup(): { service: ScreenService; repo: InMemoryScreenRepository } {
	const repo = new InMemoryScreenRepository();
	const components = new ComponentService(sampleRegistry());
	return { service: new ScreenService(repo, components), repo };
}

async function seed(service: ScreenService): Promise<void> {
	const screen = sampleScreen();
	await service.createScreen({
		id: screen.id,
		name: screen.name,
		root: screen.root,
	});
}

describe("ScreenService.createScreen", () => {
	it("revision 1・現在の Registry Version で作成する", async () => {
		const { service } = setup();
		const { screen } = await service.createScreen({
			id: "s1",
			name: "画面1",
			root: sampleScreen().root,
		});
		expect(screen.revision).toBe(1);
		expect(screen.componentRegistryVersion).toBe("test:v1");
	});

	it("fixtures と variants を保存し、省略時はキー自体を持たない", async () => {
		const { service, repo } = setup();
		const variants = [
			{
				name: "Loading",
				operations: [
					{
						type: "setProps" as const,
						nodeId: "node-table",
						props: { loading: true },
					},
				],
			},
		];
		const { screen } = await service.createScreen({
			id: "s1",
			name: "画面1",
			root: sampleScreen().root,
			fixtures: { customers: [] },
			variants,
		});
		expect(screen.fixtures).toEqual({ customers: [] });
		expect(screen.variants).toEqual(variants);
		// The stored copy carries them too, not just the returned value.
		const stored = await repo.get("s1");
		expect(stored?.variants).toEqual(variants);

		const { screen: bare } = await service.createScreen({
			id: "s2",
			name: "画面2",
			root: sampleScreen().root,
		});
		expect(Object.hasOwn(bare, "fixtures")).toBe(false);
		expect(Object.hasOwn(bare, "variants")).toBe(false);
	});

	it("不正な構成は ValidationFailedError で拒否する", async () => {
		const { service } = setup();
		expect(
			service.createScreen({
				id: "bad",
				name: "bad",
				root: {
					id: "r",
					component: "NotRegistered",
					props: {},
					slots: {},
				},
			}),
		).rejects.toBeInstanceOf(ValidationFailedError);
	});

	it("screens:create 権限がなければ FORBIDDEN", async () => {
		const { service } = setup();
		const viewer = {
			id: "viewer",
			isAgent: false,
			permissions: new Set(["screens:read"] as const),
		};
		expect(
			service.createScreen(
				{ id: "s", name: "s", root: sampleScreen().root },
				viewer,
			),
		).rejects.toMatchObject({ code: SERVICE_CODES.FORBIDDEN });
	});
});

describe("ScreenService.applyOperations", () => {
	beforeEach(() => {});

	it("Operation を適用し revision を +1 する", async () => {
		const { service } = setup();
		await seed(service);
		const { screen } = await service.applyOperations(
			"customer-list",
			[
				{
					type: "setProps",
					nodeId: "node-header",
					props: { title: "新しい顧客一覧" },
				},
			],
			1,
		);
		expect(screen.revision).toBe(2);
		expect(screen.root.slots.header[0]?.props.title).toBe("新しい顧客一覧");
	});

	it("baseRevision 不一致は REVISION_CONFLICT", async () => {
		const { service } = setup();
		await seed(service);
		expect(
			service.applyOperations(
				"customer-list",
				[{ type: "removeNode", nodeId: "node-table" }],
				99,
			),
		).rejects.toMatchObject({
			code: SERVICE_CODES.REVISION_CONFLICT,
		});
	});

	it("適用結果が不正なら保存せず拒否する", async () => {
		const { service, repo } = setup();
		await seed(service);
		await expect(
			service.applyOperations(
				"customer-list",
				[{ type: "setProps", nodeId: "node-header", props: { bogus: 1 } }],
				1,
			),
		).rejects.toBeInstanceOf(ValidationFailedError);
		// The revision stays unchanged after rejection.
		expect((await repo.get("customer-list"))?.revision).toBe(1);
	});

	it("存在しない画面は SCREEN_NOT_FOUND", async () => {
		const { service } = setup();
		expect(service.applyOperations("nope", [], 1)).rejects.toMatchObject({
			code: SERVICE_CODES.SCREEN_NOT_FOUND,
		});
	});

	it("Operation 適用は現在の Registry Version を再スタンプする", async () => {
		const repo = new InMemoryScreenRepository();
		const components = new ComponentService(sampleRegistry());
		const service = new ScreenService(repo, components);
		const screen = sampleScreen();
		await service.createScreen({
			id: screen.id,
			name: screen.name,
			root: screen.root,
		});
		components.replaceRegistry({ ...sampleRegistry(), version: "test:v2" });
		const { screen: updated } = await service.applyOperations(
			"customer-list",
			[{ type: "setProps", nodeId: "node-header", props: { title: "z" } }],
			1,
		);
		expect(updated.componentRegistryVersion).toBe("test:v2");
	});

	it("同一 baseRevision の並行更新は一方のみ成功し lost update を起こさない", async () => {
		const { service, repo } = setup();
		await seed(service);
		const results = await Promise.allSettled([
			service.applyOperations(
				"customer-list",
				[{ type: "setProps", nodeId: "node-header", props: { title: "A" } }],
				1,
			),
			service.applyOperations(
				"customer-list",
				[{ type: "setProps", nodeId: "node-header", props: { title: "B" } }],
				1,
			),
		]);
		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
			code: SERVICE_CODES.REVISION_CONFLICT,
		});
		// Only the one successful update is applied, and revision settles at 2.
		expect((await repo.get("customer-list"))?.revision).toBe(2);
	});
});

describe("ScreenService: エージェントと公開画面", () => {
	it("エージェントは公開画面を変更できない", async () => {
		const { service } = setup();
		await service.createScreen({
			id: "pub",
			name: "公開画面",
			root: sampleScreen().root,
			status: "published",
		});
		expect(
			service.applyOperations(
				"pub",
				[{ type: "setProps", nodeId: "node-header", props: { title: "x" } }],
				1,
				agentActor(),
			),
		).rejects.toMatchObject({ code: SERVICE_CODES.PUBLISHED_SCREEN_LOCKED });
	});

	it("エージェントは Draft 画面を変更できる", async () => {
		const { service } = setup();
		await seed(service);
		const { screen } = await service.applyOperations(
			"customer-list",
			[{ type: "setProps", nodeId: "node-header", props: { title: "y" } }],
			1,
			agentActor(),
		);
		expect(screen.revision).toBe(2);
	});
});

describe("ScreenService.duplicateScreen / deleteScreen", () => {
	it("複製は新 id・Draft・revision 1", async () => {
		const { service } = setup();
		await seed(service);
		const { screen } = await service.duplicateScreen(
			"customer-list",
			"customer-list-copy",
			"顧客一覧（複製）",
		);
		expect(screen.id).toBe("customer-list-copy");
		expect(screen.status).toBe("draft");
		expect(screen.revision).toBe(1);
	});

	// Treat duplication the same as other writes. If the source is saved still pointing at an
	// old Registry, "just-duplicated" screens that fail validation pile up.
	it("複製は現在の Registry Version を再スタンプする", async () => {
		const { service, repo } = setup();
		await seed(service);
		await repo.save({ ...sampleScreen(), componentRegistryVersion: "old:v0" });

		const { screen, validation } = await service.duplicateScreen(
			"customer-list",
			"copy",
			"複製",
		);

		expect(screen.componentRegistryVersion).toBe("test:v1");
		expect(
			validation.warnings.some((w) => w.code === "REGISTRY_VERSION_MISMATCH"),
		).toBe(false);
	});

	it("検証に通らない複製は保存せず拒否する", async () => {
		const { service, repo } = setup();
		await seed(service);
		await repo.save({
			...sampleScreen(),
			root: {
				id: "r",
				component: "NotRegistered",
				props: {},
				slots: {},
			},
		});

		expect(
			service.duplicateScreen("customer-list", "copy", "複製"),
		).rejects.toBeInstanceOf(ValidationFailedError);
		expect(await repo.exists("copy")).toBe(false);
	});

	it("削除できる", async () => {
		const { service, repo } = setup();
		await seed(service);
		await service.deleteScreen("customer-list");
		expect(await repo.exists("customer-list")).toBe(false);
	});
});

describe("ScreenService.updateScreen: publish 権限", () => {
	it("systemActor は公開できる", async () => {
		const { service } = setup();
		await seed(service);
		const current = await service.getScreen("customer-list");
		const { screen } = await service.updateScreen(
			"customer-list",
			{ ...current, status: "published" },
			1,
			systemActor(),
		);
		expect(screen.status).toBe("published");
	});

	it("publish 権限がなければ公開は FORBIDDEN", async () => {
		const { service } = setup();
		await seed(service);
		const current = await service.getScreen("customer-list");
		expect(
			service.updateScreen(
				"customer-list",
				{ ...current, status: "published" },
				1,
				agentActor(),
			),
		).rejects.toMatchObject({ code: SERVICE_CODES.FORBIDDEN });
	});

	it("全置換はクライアント供給の Registry Version を無視し再スタンプする", async () => {
		const { service } = setup();
		await seed(service);
		const current = await service.getScreen("customer-list");
		const { screen } = await service.updateScreen(
			"customer-list",
			{ ...current, componentRegistryVersion: "client:tampered" },
			1,
			systemActor(),
		);
		expect(screen.componentRegistryVersion).toBe("test:v1");
	});

	it("baseRevision 不一致の全置換は REVISION_CONFLICT", async () => {
		const { service } = setup();
		await seed(service);
		const current = await service.getScreen("customer-list");
		expect(
			service.updateScreen(
				"customer-list",
				{ ...current, name: "改名" },
				99,
				systemActor(),
			),
		).rejects.toMatchObject({ code: SERVICE_CODES.REVISION_CONFLICT });
	});
});
