#!/usr/bin/env node
// The entry point for the `yosegi` command, run as a single command via npx / bunx / from within the repo.
//
// This points directly at the CLI module in dist rather than the package's exports ("."),
// because the public API (index.js) also re-exports the HTTP adapter and the MCP server —
// running the CLI once would otherwise pull in hono and @modelcontextprotocol/sdk as well.
//
// Requires dist to exist (inside the repo, run `bun run build` first). When developing and
// running the source directly, use `bun --filter '@yosegi/yosegi' cli <command>` instead.
import { runCli } from "../dist/adapters/cli/cli.js";

process.exit(await runCli(process.argv.slice(2)));
