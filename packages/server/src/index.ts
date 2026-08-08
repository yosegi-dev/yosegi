// The public API of @yosegi/yosegi. Import from here when embedding the HTTP app or MCP server
// into a host's own Bun/Node server. For running the CLI or starting standalone, see the
// scripts (http / mcp / cli) in package.json.
export { runCli } from "./adapters/cli/cli.ts";
export {
	type ErrorResponse,
	toErrorResponse,
} from "./adapters/error-response.ts";
export { createHttpApp, type HttpAppOptions } from "./adapters/http/app.ts";
export { createMcpServer } from "./adapters/mcp/server.ts";
export {
	createRuntimeComposer,
	DEFAULT_DATA_DIR,
	loadRegistry,
	registryPath,
	screensDir,
	seedDataDir,
} from "./config.ts";
