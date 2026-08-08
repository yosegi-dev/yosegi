import { writeFile } from "node:fs/promises";
import { createRuntimeComposer, registryPath } from "../../config.ts";
import { createHttpApp } from "./app.ts";

// The entry point for `bun run http`. Builds a Composer and exposes the Hono app via Bun.serve.
const port = Number(process.env.VC_HTTP_PORT ?? 8787);
const composer = await createRuntimeComposer();
const app = createHttpApp(composer, {
	// Save a client-pushed Registry to data/registry.json.
	persistRegistry: async (registry) => {
		await writeFile(
			registryPath(),
			`${JSON.stringify(registry, null, "\t")}\n`,
		);
	},
});

console.log(`Yosegi HTTP API listening on http://localhost:${port}`);

export default {
	port,
	fetch: app.fetch,
};
