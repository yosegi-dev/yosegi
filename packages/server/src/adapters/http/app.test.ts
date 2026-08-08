import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Composer,
	FileScreenRepository,
	InMemoryScreenRepository,
} from "@yosegi/core/app";
import { sampleRegistry, sampleScreen } from "@yosegi/core/testing";
import { createHttpApp } from "./app.ts";

function app() {
	const composer = new Composer(
		sampleRegistry(),
		new InMemoryScreenRepository(),
	);
	return createHttpApp(composer);
}

async function seed(a: ReturnType<typeof app>): Promise<void> {
	const screen = sampleScreen();
	await a.request("/api/screens", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: screen.id,
			name: screen.name,
			root: screen.root,
		}),
	});
}

describe("HTTP API: components", () => {
	it("GET /api/components 一覧", async () => {
		const res = await app().request("/api/components");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { components: unknown[] };
		expect(body.components.length).toBeGreaterThan(0);
	});

	it("GET /api/components?query=button で検索", async () => {
		const res = await app().request("/api/components?query=button");
		const body = (await res.json()) as { components: { id: string }[] };
		expect(body.components.map((c) => c.id)).toContain("Button");
	});

	it("GET /api/components/:id 単体取得", async () => {
		const res = await app().request("/api/components/Button");
		expect(res.status).toBe(200);
	});

	it("未登録コンポーネントは 404", async () => {
		const res = await app().request("/api/components/Nope");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("COMPONENT_NOT_FOUND");
	});
});

// Since screenId comes from the URL path, confirm on both reads and writes that even an
// encoded `..` can't reach outside the storage directory.
describe("HTTP API: 保存先の外を指す screenId", () => {
	it("エンコードした traversal の GET は 400 で拒否する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "vc-http-"));
		const composer = new Composer(
			sampleRegistry(),
			new FileScreenRepository(join(dir, "screens")),
		);
		await writeFile(
			join(dir, "victim.json"),
			JSON.stringify({ ...sampleScreen(), id: "victim" }),
		);

		const res = await createHttpApp(composer).request(
			`/api/screens/${encodeURIComponent("../victim")}`,
		);

		expect(res.status).toBe(400);
		expect((await res.json()) as { error: { code: string } }).toMatchObject({
			error: { code: "INVALID_SCREEN_ID" },
		});
		await rm(dir, { recursive: true, force: true });
	});

	it("traversal な id の POST は 400 で拒否する", async () => {
		const res = await app().request("/api/screens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "../../victim/HTTP_WRITE",
				name: "http",
				root: { id: "n1", component: "Text", props: { text: "x" }, slots: {} },
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()) as { error: { code: string } }).toMatchObject({
			error: { code: "INVALID_REQUEST" },
		});
	});
});

describe("HTTP API: screens", () => {
	it("作成 → 取得 → 一覧", async () => {
		const a = app();
		await seed(a);
		const get = await a.request("/api/screens/customer-list");
		expect(get.status).toBe(200);
		const list = await a.request("/api/screens");
		const body = (await list.json()) as { screens: { id: string }[] };
		expect(body.screens.map((s) => s.id)).toContain("customer-list");
	});

	it("Operation 適用で revision が上がる", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list/operations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				baseRevision: 1,
				operations: [
					{ type: "setProps", nodeId: "node-header", props: { title: "更新" } },
				],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { screen: { revision: number } };
		expect(body.screen.revision).toBe(2);
	});

	it("revision 競合は 409", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list/operations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ baseRevision: 99, operations: [] }),
		});
		expect(res.status).toBe(409);
	});

	it("不正な Operation 結果は 422 + validation", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list/operations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				baseRevision: 1,
				operations: [
					{ type: "setProps", nodeId: "node-header", props: { bogus: 1 } },
				],
			}),
		});
		expect(res.status).toBe(422);
		const body = (await res.json()) as { validation: { valid: boolean } };
		expect(body.validation.valid).toBe(false);
	});

	it("存在しない画面は 404", async () => {
		const res = await app().request("/api/screens/nope");
		expect(res.status).toBe(404);
	});

	it("validate エンドポイント", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list/validate", {
			method: "POST",
		});
		const body = (await res.json()) as { valid: boolean };
		expect(body.valid).toBe(true);
	});

	it("implementation-context を返す", async () => {
		const a = app();
		await seed(a);
		const res = await a.request(
			"/api/screens/customer-list/implementation-context",
		);
		const body = (await res.json()) as {
			components: unknown[];
			implementation: unknown;
		};
		expect(body.components.length).toBeGreaterThan(0);
		expect(body.implementation).toBeDefined();
	});

	it("PATCH 全置換で revision が上がる", async () => {
		const a = app();
		await seed(a);
		const current = (await (
			await a.request("/api/screens/customer-list")
		).json()) as { name: string; [key: string]: unknown };
		const res = await a.request("/api/screens/customer-list", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				baseRevision: 1,
				screen: { ...current, name: "改名" },
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { screen: { revision: number } };
		expect(body.screen.revision).toBe(2);
	});

	it("PATCH の baseRevision 欠落は 400（500 にしない）", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ screen: {} }),
		});
		expect(res.status).toBe(400);
	});

	it("不正な JSON ボディは 400", async () => {
		const a = app();
		const res = await a.request("/api/screens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{ not json",
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_JSON");
	});

	it("DELETE で削除し、以後 404", async () => {
		const a = app();
		await seed(a);
		const del = await a.request("/api/screens/customer-list", {
			method: "DELETE",
		});
		expect(del.status).toBe(204);
		const get = await a.request("/api/screens/customer-list");
		expect(get.status).toBe(404);
	});

	it("POST duplicate で複製する", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens/customer-list/duplicate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ newId: "copy", newName: "複製" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { screen: { id: string } };
		expect(body.screen.id).toBe("copy");
	});

	it("同一 id の作成は 409", async () => {
		const a = app();
		await seed(a);
		const res = await a.request("/api/screens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "customer-list",
				name: "重複",
				root: sampleScreen().root,
			}),
		});
		expect(res.status).toBe(409);
	});

	it("未登録コンポーネントを含む作成は 422", async () => {
		const a = app();
		const res = await a.request("/api/screens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "bad",
				name: "bad",
				root: { id: "r", component: "NotRegistered", props: {}, slots: {} },
			}),
		});
		expect(res.status).toBe(422);
	});
});

describe("HTTP API: 認可", () => {
	it("エージェントは公開画面を変更できず 403", async () => {
		const a = app();
		await a.request("/api/screens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "pub",
				name: "公開",
				status: "published",
				root: sampleScreen().root,
			}),
		});
		const res = await a.request("/api/screens/pub/operations", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-composer-actor": "agent",
			},
			body: JSON.stringify({
				baseRevision: 1,
				operations: [
					{ type: "setProps", nodeId: "node-header", props: { title: "x" } },
				],
			}),
		});
		expect(res.status).toBe(403);
	});
});
