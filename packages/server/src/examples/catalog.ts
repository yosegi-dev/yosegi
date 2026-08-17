import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ComposerError, didYouMean, SERVICE_CODES } from "@yosegi/core";
import { z } from "zod";
import { HOST_CONFIG_FILENAME } from "../host-config.ts";

// The host's catalog of screen templates that `example apply` copies from.
//
// This is deliberately not the component Registry. A Registry entry is a component to
// assemble a screen out of; a catalog entry is a whole screen already assembled, kept as
// real renderable code rather than as a file full of placeholders. Copying it and renaming
// the export is the entire transformation — the copy owns itself from that point on and
// keeps no link back, which is what makes editing it afterwards unremarkable.
//
// Prior art for the shape: a host that drives the same copy through plop, keyed the same way
// (key / label / description / templatePath / componentName), so a host already doing this by
// hand can hand Yosegi the list it already maintains.

export const exampleEntrySchema = z.object({
	// Unique within the catalog; what `example apply <key>` names.
	key: z.string().min(1),
	label: z.string().min(1),
	description: z.string(),
	// Resolved against the catalog's root (see exampleCatalogSchema.root).
	templatePath: z.string().min(1),
	// The identifier replaced with --name on copy. The template's default export.
	componentName: z.string().min(1),
});

export const exampleCatalogSchema = z.object({
	// The base for every templatePath, itself relative to the catalog file. Defaults to the
	// catalog's own directory, which is the case where a host drops examples.json at the
	// package root its template paths were already written against. A host that keeps the
	// catalog somewhere else (Yosegi's --data-dir, say) sets this rather than rewriting
	// every path.
	root: z.string().optional(),
	examples: z.array(exampleEntrySchema),
});

export type ExampleEntry = z.infer<typeof exampleEntrySchema>;

// Which of the three declarations the catalog in hand came from. Carried on the value
// rather than re-derived from the path, because the config case is not a catalog file at
// all — its entries live inside yosegi.config.json — and the output has to say so.
export type CatalogSource = "flag" | "config" | "data-dir";

export type LoadedCatalog = {
	// Absolute path the catalog was read from. Echoed in output so a reader never has to
	// guess which of --catalog, the config, and the --data-dir default was consulted.
	path: string;
	// Absolute base for templatePath.
	root: string;
	source: CatalogSource;
	examples: ExampleEntry[];
};

export async function loadExampleCatalog(
	catalogPath: string,
	source: Exclude<CatalogSource, "config">,
): Promise<LoadedCatalog> {
	const path = resolve(catalogPath);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		// A coded error rather than a bare ENOENT, for the same reason loadRegistry uses
		// REGISTRY_NOT_FOUND: the fix is always the same, and the path belongs in a field
		// instead of only inside the message.
		throw new ComposerError(
			SERVICE_CODES.EXAMPLE_CATALOG_NOT_FOUND,
			`Example catalog not found at ${path}. Pass --catalog <path>, add an "examples" section to ${HOST_CONFIG_FILENAME}, or place the catalog at <data-dir>/examples.json.`,
			null,
			{ details: { path } },
		);
	}
	// Invalid JSON and a schema mismatch both fall through to the adapter, which already
	// reports them as INVALID_JSON / INVALID_REQUEST against a file.
	const parsed = exampleCatalogSchema.parse(JSON.parse(raw));

	// Duplicate keys would make lookup depend on array order, and the second entry could
	// never be reached. Catching it here names the offending key instead of leaving the
	// host wondering why `example apply` copied the wrong template.
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const example of parsed.examples) {
		if (seen.has(example.key)) {
			duplicates.add(example.key);
		}
		seen.add(example.key);
	}
	if (duplicates.size > 0) {
		throw new ComposerError(
			SERVICE_CODES.INVALID_ARGUMENT,
			`Example catalog ${path} has duplicate keys: ${[...duplicates].join(", ")}. Each key must be unique.`,
			null,
			{ details: { path, duplicateKeys: [...duplicates] } },
		);
	}

	return {
		path,
		root: resolve(dirname(path), parsed.root ?? "."),
		source,
		examples: parsed.examples,
	};
}

// The same catalog, declared in yosegi.config.json's `examples` section instead of in a
// file of its own. The entries arrive with templatePath already resolved against the
// config's directory (hostConfigDefaults does it, as it does for every other path in the
// file), so root is that directory: resolving an absolute path against it is a no-op, and
// it is the base the `template:` line in apply's output is relative to.
export function exampleCatalogFromConfig(
	configPath: string,
	examples: ExampleEntry[],
): LoadedCatalog {
	return {
		path: configPath,
		root: dirname(configPath),
		source: "config",
		examples,
	};
}

// Look up one entry, or fail with the candidates. Mirrors requireComponent: an agent that
// guessed a key gets the correction in the same response rather than having to run list.
export function requireExample(
	catalog: LoadedCatalog,
	key: string,
): ExampleEntry {
	const found = catalog.examples.find((example) => example.key === key);
	if (found) {
		return found;
	}
	const keys = catalog.examples.map((example) => example.key);
	throw new ComposerError(
		SERVICE_CODES.EXAMPLE_NOT_FOUND,
		`No example named "${key}" in ${catalog.path}. Run "yosegi example list" to see the ${keys.length} available.`,
		null,
		{
			suggestion: didYouMean(key, keys) ?? null,
			details: { key, catalog: catalog.path, availableKeys: keys },
		},
	);
}
