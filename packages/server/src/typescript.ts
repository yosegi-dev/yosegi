import { createRequire } from "node:module";

// The one place the TypeScript compiler API is loaded at runtime.
//
// Every module that reads the host's types imports the namespace with `import type`, which
// erases, and calls loadTypeScript() inside the functions that need the API. Two reasons it
// is not a plain `import * as ts from "typescript"`:
//
// - TypeScript 7.0 ships no compiler API — `require("typescript")` returns
//   `{ version, versionMajorMinor }`. A top-level import puts every `ts.` dereference one
//   module evaluation away from a raw TypeError that names neither the cause nor the fix,
//   and because the CLI imports those modules to reach a single command, it took down
//   `yosegi --help` along with them. Loading here instead keeps the commands that never
//   touch the compiler working, and gives the ones that do the same fix-it message
//   docgen.ts prints for the extractor (both are the same host state).
// - The compiler is 23MB of JavaScript and costs ~130ms to evaluate. Commands that only
//   read a Screen or the Registry JSON no longer pay it.
//
// `createRequire` rather than `await import(...)` because the call sites
// (buildRegistryFromSource, importStory, parseMetaTemplate) are synchronous, and making
// them async to improve an error message would ripple through the CLI and its tests.
export type TypeScriptModule = typeof import("typescript");

const requireFromHere = createRequire(import.meta.url);

// A member the 6.x API has and the 7.0 stub does not. Checked before the module is handed
// out, so the failure is reported here rather than as `undefined.StringLike` deep inside a
// caller.
const API_MEMBER = "createSourceFile";

let cached: TypeScriptModule | null = null;

// Whether a loaded `typescript` actually carries the compiler API. The 7.0 stub is a plain
// object with a version on it, so the check is for the API itself rather than for a version
// range — an alias or a shim that reports any version at all is judged by what it exports.
export function hasCompilerApi(loaded: unknown): boolean {
	if (typeof loaded !== "object" || loaded === null) {
		return false;
	}
	return typeof (loaded as Record<string, unknown>)[API_MEMBER] === "function";
}

// The `typescript` Yosegi itself resolves, as name@version. The name matters as much as the
// version: an alias (`typescript@npm:@typescript/typescript6`) reports the package it points
// at, which is what tells a reader the side-by-side install took effect.
export function resolveTypeScript(): string | null {
	try {
		const manifest = requireFromHere("typescript/package.json") as {
			name?: unknown;
			version?: unknown;
		};
		if (
			typeof manifest.name !== "string" ||
			typeof manifest.version !== "string"
		) {
			return null;
		}
		return `${manifest.name}@${manifest.version}`;
	} catch {
		return null;
	}
}

function majorOf(identifier: string | null): number | null {
	if (identifier === null) {
		return null;
	}
	const major = Number(identifier.split("@").pop()?.split(".")[0]);
	return Number.isInteger(major) ? major : null;
}

// The fix for a host whose `typescript` is 7.x, or nothing when it is not. TypeScript 7.0
// ships no compiler API, and 7.1 is expected to introduce a new and different one. Until
// then Yosegi needs the 6.x API, which the TypeScript team publishes as a compatibility
// package. Both entries are required: aliasing `typescript` alone would take `tsc` with it,
// since the compatibility package ships `tsc6` and no `tsc`.
//
// Shared with docgen.ts because the extractor fails on exactly the same host state, and one
// of the two printing stale advice would send the reader down the wrong path.
//
// The bun line is not an aside: bun redirects the compatibility package's own
// `npm:typescript@^6` dependency back to the compatibility package, so `typescript`
// re-exports itself and extraction dies on `ts.TypeFlags` being undefined. A bun host that
// followed the first command alone would land on a second, more obscure failure, so the
// direct dependency is named here rather than left to docs/registry.md.
export function compilerApiFix(resolved: string | null): string[] {
	if ((majorOf(resolved) ?? 0) < 7) {
		return [];
	}
	return [
		"TypeScript 7.0 ships no compiler API, so Yosegi needs the 6.x one. Install 6 and 7 side by side:",
		"  npm install -D @typescript/native@npm:typescript typescript@npm:@typescript/typescript6",
		"That keeps tsc on 7 and gives tools back the 6.x API.",
		"On bun, alias resolution sends the compatibility package back to itself, so depend on the 6.x compiler directly:",
		"  bun add -d @typescript/native@npm:typescript typescript@^6",
	];
}

export function formatTypeScriptLoadFailure(
	resolved: string | null,
	cause: string,
): string {
	return [
		"Failed to load the TypeScript compiler API, which Yosegi uses to read the host's types.",
		resolved === null
			? 'Yosegi could not resolve "typescript" from its own installation.'
			: `Yosegi resolved "typescript" to ${resolved}.`,
		...compilerApiFix(resolved),
		`Underlying error: ${cause}`,
	].join("\n");
}

export function loadTypeScript(): TypeScriptModule {
	if (cached !== null) {
		return cached;
	}
	let loaded: unknown;
	try {
		loaded = requireFromHere("typescript");
	} catch (error) {
		throw new Error(
			formatTypeScriptLoadFailure(
				resolveTypeScript(),
				error instanceof Error ? error.message : String(error),
			),
		);
	}
	if (!hasCompilerApi(loaded)) {
		throw new Error(
			formatTypeScriptLoadFailure(
				resolveTypeScript(),
				`the module exports no ${API_MEMBER}, so it carries no compiler API`,
			),
		);
	}
	cached = loaded as TypeScriptModule;
	return cached;
}
