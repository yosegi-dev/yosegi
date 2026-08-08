import { describe, expect, it } from "bun:test";
import { findMissingEntryPoints, findUnresolvedProtocols } from "./pack.ts";

describe("findUnresolvedProtocols", () => {
	it("解決済みのバージョンとレンジは通す", () => {
		expect(
			findUnresolvedProtocols({
				name: "@yosegi/core",
				version: "0.1.0",
				dependencies: { zod: "^4.4.3" },
				devDependencies: { "@types/react": "19.2.18" },
			}),
		).toEqual([]);
	});

	it("catalog: を残した依存を報告する", () => {
		expect(
			findUnresolvedProtocols({
				name: "@yosegi/yosegi",
				version: "0.1.0",
				dependencies: { zod: "catalog:", hono: "4.13.1" },
			}),
		).toEqual(["dependencies.zod = catalog:"]);
	});

	it("workspace: を残した依存を報告する", () => {
		expect(
			findUnresolvedProtocols({
				name: "@yosegi/yosegi",
				version: "0.1.0",
				dependencies: { "@yosegi/core": "workspace:*" },
			}),
		).toEqual(["dependencies.@yosegi/core = workspace:*"]);
	});

	// Only checking dependencies would miss unresolved protocols left in other fields.
	it("dependencies 以外のフィールドも見る", () => {
		expect(
			findUnresolvedProtocols({
				name: "@yosegi/yosegi",
				version: "0.1.0",
				peerDependencies: { typescript: "catalog:" },
			}),
		).toEqual(["peerDependencies.typescript = catalog:"]);
	});
});

describe("findMissingEntryPoints", () => {
	const manifest = {
		name: "@yosegi/yosegi",
		version: "0.1.0",
		bin: { yosegi: "./bin/yosegi.js" },
		exports: {
			".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
		},
	};

	it("全ての入口が入っていれば何も返さない", () => {
		expect(
			findMissingEntryPoints(manifest, [
				"package/package.json",
				"package/bin/yosegi.js",
				"package/dist/index.d.ts",
				"package/dist/index.js",
			]),
		).toEqual([]);
	});

	// A tarball from a forgotten build installs successfully but fails on the first import.
	it("dist が丸ごと欠けている tarball を報告する", () => {
		expect(
			findMissingEntryPoints(manifest, [
				"package/package.json",
				"package/bin/yosegi.js",
			]).sort(),
		).toEqual(["dist/index.d.ts", "dist/index.js"]);
	});
});
