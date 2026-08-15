import { createRequire } from "node:module";

// react-docgen-typescript reads the TypeScript compiler API at import time (its module
// body dereferences `ts.JsxEmit`). TypeScript 7.0 ships no compiler API at all —
// `require("typescript")` returns `{ version, versionMajorMinor }` — so on a host that
// installed 7, that import dies with a TypeError naming neither the cause nor the fix.
// It happens at module load, which took down every command including `yosegi` with no
// arguments.
//
// So the module is loaded on demand rather than at the top of source-registry.ts, and the
// failure is translated into the compatibility package the TypeScript team publishes for
// exactly this case. `createRequire` rather than `await import(...)` because
// buildRegistryFromSource is synchronous, and making it async to improve an error message
// would ripple through the CLI and its tests.
type DocgenModule = typeof import("react-docgen-typescript");

const requireFromHere = createRequire(import.meta.url);

// The `typescript` react-docgen-typescript itself resolves, which is not necessarily the
// one Yosegi resolves: a package manager hoists react-docgen-typescript to the top of the
// host's tree, where it finds the host's TypeScript rather than the copy nested under
// @yosegi/yosegi. That difference is the entire failure, so the message has to report the
// version the extractor saw rather than the one we did.
export function resolveExtractorTypeScript(): string | null {
	try {
		const docgenPath = requireFromHere.resolve("react-docgen-typescript");
		const manifest = createRequire(docgenPath)("typescript/package.json") as {
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

export function formatDocgenLoadFailure(
	resolved: string | null,
	cause: string,
): string {
	const lines = [
		"Failed to load react-docgen-typescript, which Yosegi uses to read props from types.",
		resolved === null
			? "It reads the TypeScript compiler API when it loads."
			: `It reads the TypeScript compiler API when it loads, and resolved "typescript" to ${resolved}.`,
	];
	// TypeScript 7.0 ships no compiler API, and 7.1 is expected to introduce a new and
	// different one. Until then the extractor needs the 6.x API, which the TypeScript team
	// publishes as a compatibility package. Both entries are required: aliasing `typescript`
	// alone would take `tsc` with it, since the compatibility package ships `tsc6` and no `tsc`.
	if ((majorOf(resolved) ?? 0) >= 7) {
		lines.push(
			"TypeScript 7.0 ships no compiler API, so Yosegi needs the 6.x one. Install 6 and 7 side by side:",
			"  npm install -D @typescript/native@npm:typescript typescript@npm:@typescript/typescript6",
			"That keeps tsc on 7 and gives tools back the 6.x API.",
		);
	}
	lines.push(`Underlying error: ${cause}`);
	return lines.join("\n");
}

export function loadDocgen(): DocgenModule {
	try {
		return requireFromHere("react-docgen-typescript") as DocgenModule;
	} catch (error) {
		throw new Error(
			formatDocgenLoadFailure(
				resolveExtractorTypeScript(),
				error instanceof Error ? error.message : String(error),
			),
		);
	}
}
