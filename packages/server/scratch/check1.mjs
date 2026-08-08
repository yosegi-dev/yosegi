import { join } from "node:path";
import { indexRegistry } from "@yosegi/core";
import { buildRegistryFromSource } from "../src/registry/source-registry.ts";

const FIXTURE_ROOT = join(process.cwd(), "src/registry/__shape-fixtures__");
const registry = buildRegistryFromSource({
	projectRoot: FIXTURE_ROOT,
	sources: ["**/*.tsx"],
	tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
}).registry;
const manifest = indexRegistry(registry).get("opaque-props#OpaqueProps");
console.log(JSON.stringify(manifest.props.reexportedValidator, null, 2));
