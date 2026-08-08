import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared pack path used by both release and CI. Running `npm publish` from a
// package's own directory ships a tarball with Bun's `catalog:` / `workspace:`
// still unresolved, and every consumer's install then fails with
// EUNSUPPORTEDPROTOCOL. `npm publish --dry-run` doesn't warn about this.
// `bun pm pack` resolves them, so we leave packing to Bun and publish by
// pointing at the tarball it produces. Keeping this the single entry point
// guarantees what CI verifies is exactly what release ships.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Publish order follows the dependency order. @yosegi/yosegi requires an exact
// version of @yosegi/core, so publishing in the reverse order would let an
// install that lands between the two publishes fail to resolve.
export const PUBLISH_ORDER = ["packages/core", "packages/server"] as const;

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

// Bun workspace-only protocols that npm cannot interpret.
const WORKSPACE_ONLY_PROTOCOLS = ["catalog:", "workspace:"];

type Manifest = {
	name: string;
	version: string;
	main?: string;
	types?: string;
	bin?: Record<string, string> | string;
	exports?: unknown;
} & Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

// Lists any `catalog:` / `workspace:` protocols left in the tarball. An empty
// array means it's safe to publish.
export function findUnresolvedProtocols(manifest: Manifest): string[] {
	const found: string[] = [];
	for (const field of DEPENDENCY_FIELDS) {
		for (const [name, range] of Object.entries(manifest[field] ?? {})) {
			if (WORKSPACE_ONLY_PROTOCOLS.some((p) => range.startsWith(p))) {
				found.push(`${field}.${name} = ${range}`);
			}
		}
	}
	return found;
}

// Flattens the paths referenced by exports / bin / main / types. exports can
// be a nested conditional map, so we only collect the string leaves.
function entryPointPaths(manifest: Manifest): string[] {
	const paths: string[] = [];
	const collect = (value: unknown): void => {
		if (typeof value === "string") {
			if (value.startsWith("./")) paths.push(value.slice(2));
			return;
		}
		if (value && typeof value === "object") {
			for (const nested of Object.values(value)) collect(nested);
		}
	};
	collect(manifest.exports);
	collect(manifest.bin);
	collect(manifest.main);
	collect(manifest.types);
	return [...new Set(paths)];
}

// Lists files the manifest references but the tarball doesn't contain.
// `files` silently skips directories that don't exist, so a tarball from a
// forgotten build "installs fine and then fails on the first import." That
// doesn't surface as an error on its own, which is why we check for it here.
export function findMissingEntryPoints(
	manifest: Manifest,
	entries: string[],
): string[] {
	const packed = new Set(
		entries
			.filter((e) => e.startsWith("package/"))
			.map((e) => e.slice("package/".length)),
	);
	return entryPointPaths(manifest).filter((p) => !packed.has(p));
}

function run(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
		);
	}
	return result.stdout;
}

function readPackedManifest(tarball: string): Manifest {
	return JSON.parse(
		run("tar", ["-xzOf", tarball, "package/package.json"], REPO_ROOT),
	);
}

function listPackedEntries(tarball: string): string[] {
	return run("tar", ["-tzf", tarball], REPO_ROOT)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

// Packs every package and returns the tarball paths in publish order. Throws
// if any problems are found.
export function packAll(destination: string): string[] {
	mkdirSync(destination, { recursive: true });
	// Leaving a previous tarball behind lets a stale version sneak in when CI or
	// publish picks files up via `*.tgz`. We only ever delete `.tgz` files here
	// (destination is caller-supplied, so wiping the whole directory would turn
	// a wrong argument into data loss).
	for (const file of readdirSync(destination)) {
		if (file.endsWith(".tgz")) rmSync(join(destination, file));
	}

	const tarballs: string[] = [];
	for (const pkg of PUBLISH_ORDER) {
		const before = new Set(readdirSync(destination));
		// prepack runs the build, so packing here works even from a clean tree.
		run(
			"bun",
			["pm", "pack", "--destination", destination],
			join(REPO_ROOT, pkg),
		);
		const produced = readdirSync(destination).filter((f) => !before.has(f));
		if (produced.length !== 1) {
			throw new Error(
				`${pkg}: expected exactly one new tarball, got ${produced.length ? produced.join(", ") : "none"}`,
			);
		}
		tarballs.push(join(destination, produced[0] as string));
	}

	const problems: string[] = [];
	for (const tarball of tarballs) {
		const manifest = readPackedManifest(tarball);
		for (const unresolved of findUnresolvedProtocols(manifest)) {
			problems.push(
				`${manifest.name}: ${unresolved} would ship unresolved; npm cannot install it`,
			);
		}
		for (const missing of findMissingEntryPoints(
			manifest,
			listPackedEntries(tarball),
		)) {
			problems.push(
				`${manifest.name}: ${missing} is referenced but not packed`,
			);
		}
	}
	if (problems.length > 0) {
		throw new Error(
			`Packed output is not publishable:\n  ${problems.join("\n  ")}`,
		);
	}
	return tarballs;
}

if (import.meta.main) {
	const destination = resolve(process.argv[2] ?? join(REPO_ROOT, ".pack"));
	const tarballs = packAll(destination);
	for (const tarball of tarballs) console.log(tarball);
}
