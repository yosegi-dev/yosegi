import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Composer, InMemoryScreenRepository } from "@yosegi/core/app";
import { sampleRegistry, sampleScreen } from "@yosegi/core/testing";
import { createMcpServer } from "./server.ts";

// Returns an in-memory client paired with a server.
async function connect(): Promise<Client> {
	const composer = new Composer(
		sampleRegistry(),
		new InMemoryScreenRepository(),
	);
	// Seed one screen.
	const screen = sampleScreen();
	await composer.screens.createScreen({
		id: screen.id,
		name: screen.name,
		root: screen.root,
	});
	const server = createMcpServer(composer);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientTransport);
	return client;
}

function textOf(result: {
	content: Array<{ type: string; text?: string }>;
}): string {
	return result.content.map((c) => c.text ?? "").join("");
}

describe("MCP server", () => {
	it("tools を列挙できる", async () => {
		const client = await connect();
		const tools = await client.listTools();
		const names = tools.tools.map((t) => t.name);
		expect(names).toContain("search_components");
		expect(names).toContain("apply_screen_operations");
		expect(names).toContain("generate_implementation_context");
		expect(names).toContain("generate_story");
	});

	it("search_components が結果を返す", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "search_components",
			arguments: { query: "button" },
		});
		expect(textOf(result as never)).toContain("Button");
	});

	it("apply_screen_operations で画面を更新できる", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "apply_screen_operations",
			arguments: {
				screenId: "customer-list",
				baseRevision: 1,
				operations: [
					{
						type: "setProps",
						nodeId: "node-header",
						props: { title: "MCP 更新" },
					},
				],
			},
		});
		expect(textOf(result as never)).toContain("MCP 更新");
	});

	it("get_component の未登録は COMPONENT_NOT_FOUND（INTERNAL_ERROR にしない）", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "get_component",
			arguments: { componentId: "Nope" },
		});
		const text = textOf(result as never);
		expect(text).toContain("COMPONENT_NOT_FOUND");
		expect(text).not.toContain("INTERNAL_ERROR");
	});

	it("validate_screen で検証結果を返す", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "validate_screen",
			arguments: { screenId: "customer-list" },
		});
		expect(textOf(result as never)).toContain('"valid": true');
	});

	it("get_screen の未登録は SCREEN_NOT_FOUND", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "get_screen",
			arguments: { screenId: "nope" },
		});
		expect(textOf(result as never)).toContain("SCREEN_NOT_FOUND");
	});

	// Since MCP input is determined externally via a prompt, an id that points outside the
	// storage directory must be rejected at the tool's entry point.
	it("保存先の外を指す screenId を拒否する", async () => {
		const client = await connect();
		const read = await client.callTool({
			name: "get_screen",
			arguments: { screenId: "../../victim/target" },
		});
		expect(read.isError).toBe(true);

		const write = await client.callTool({
			name: "create_screen",
			arguments: {
				id: "../../victim/NEWFILE",
				name: "traversal",
				root: { id: "n1", component: "Text", props: { text: "x" }, slots: {} },
			},
		});
		expect(write.isError).toBe(true);
	});

	it("create_screen で Draft 画面を作成する", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "create_screen",
			arguments: {
				id: "new-screen",
				name: "新規",
				root: sampleScreen().root,
			},
		});
		const text = textOf(result as never);
		expect(text).toContain("new-screen");
		expect(text).toContain('"status": "draft"');
	});

	it("duplicate_screen で複製する", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "duplicate_screen",
			arguments: {
				screenId: "customer-list",
				newId: "copy",
				newName: "複製",
			},
		});
		expect(textOf(result as never)).toContain("copy");
	});

	it("generate_story が CSF ソースを返す", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "generate_story",
			arguments: {
				root: sampleScreen().root,
				title: "Examples/顧客一覧",
				storyName: "Wide",
				importMap: "~/components=@host/ui",
				framework: "@storybook/react-vite",
			},
		});
		const text = textOf(result as never);
		expect(text).toContain(
			'import type { Meta, StoryObj } from \\"@storybook/react-vite\\";',
		);
		expect(text).toContain('from \\"@host/ui/layout\\";');
		expect(text).toContain('title: \\"Examples/顧客一覧\\",');
		expect(text).toContain("export const Wide: StoryObj = {");
	});

	it("generate_story は合成プリミティブを import せず展開する", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "generate_story",
			arguments: {
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
				title: "Examples/合成",
			},
		});
		const text = textOf(result as never);
		expect(text).toContain('<div className=\\"p-6\\">');
		expect(text).toContain("見出し");
		expect(text).not.toContain("@yosegi/synthetic");
	});

	it("generate_story は検証エラーを VALIDATION_FAILED で返す", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "generate_story",
			arguments: {
				root: {
					id: "root",
					component: "NotRegistered",
					props: {},
					slots: {},
				},
				title: "Examples/未登録",
			},
		});
		const text = textOf(result as never);
		expect(text).toContain("VALIDATION_FAILED");
		expect(text).toContain("COMPONENT_NOT_FOUND");
	});

	it("generate_implementation_context は import 文と結線タスクを含む", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "generate_implementation_context",
			arguments: { screenId: "customer-list" },
		});
		const text = textOf(result as never);
		expect(text).toContain("import { Page, PageHeader } from");
		expect(text).toContain('"kind": "binding"');
		expect(text).toContain("outline");
	});

	it("generate_implementation_context は importMap をホストの alias へ反映する", async () => {
		const client = await connect();
		const result = await client.callTool({
			name: "generate_implementation_context",
			arguments: {
				screenId: "customer-list",
				importMap: "~/components=@host/ui",
			},
		});
		expect(textOf(result as never)).toContain('from \\"@host/ui/layout\\"');
	});
});
