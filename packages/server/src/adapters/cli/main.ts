import { runCli } from "./cli.ts";

// The entry point for running the source directly (`bun run src/adapters/cli/main.ts <command>`).
//
// The startup logic could instead live in cli.ts, wrapped in an `import.meta.main` check,
// but that would leave a top-level await in the module body. Since cli.ts is re-exported
// from index.ts, requiring the published package from CommonJS via
// `require("@yosegi/yosegi")` would then hit ERR_REQUIRE_ASYNC_MODULE. Only this file owns startup.
process.exit(await runCli(process.argv.slice(2)));
