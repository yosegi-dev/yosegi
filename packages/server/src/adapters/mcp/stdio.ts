import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntimeComposer, DEFAULT_DATA_DIR } from "../../config.ts";
import { createMcpServer } from "./server.ts";

// Exposes the Composer as MCP over stdio, so an MCP client such as Claude Code can connect
// locally. The entry point is `yosegi mcp`, dynamically imported from the CLI side.
//
// Returns a Promise that doesn't resolve until the connection closes. Since the caller
// calls process.exit with the return value, resolving right after connect would shut the
// server down immediately.
export async function serveMcpOverStdio(
	dataDir: string = DEFAULT_DATA_DIR,
): Promise<void> {
	const composer = await createRuntimeComposer(dataDir);
	const server = createMcpServer(composer);
	const closed = new Promise<void>((resolve) => {
		server.server.onclose = resolve;
		// StdioServerTransport only fires onclose when close() is called; a client
		// disconnect merely ends stdin. Without catching that, we'd keep waiting, the event
		// loop would go empty, the process would die, and Node would print an unsettled
		// top-level await warning to stderr. Since MCP clients pipe stderr into their logs,
		// that warning would linger after every disconnect.
		process.stdin.once("end", resolve);
	});
	await server.connect(new StdioServerTransport());
	await closed;
	await server.close();
}
