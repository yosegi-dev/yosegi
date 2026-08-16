import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ComposerError, didYouMean, SERVICE_CODES } from "@yosegi/core";
import { z } from "zod";

// The one file name discovery looks for. Fixed rather than configurable: an agent that has
// to guess which of several names a host uses gains nothing over passing the flags itself.
export const HOST_CONFIG_FILENAME = "yosegi.config.json";

// A whole screen the host already keeps as real, renderable code, offered as a starting
// point to copy. Every field is required: an entry missing any of them cannot be copied, so
// accepting it would only move the failure to the command that reads it. Validated here and
// exported as a type; the command that consumes it lands separately.
const exampleTemplateSchema = z.strictObject({
	// Unique within the config; what the consuming command names an entry by.
	key: z.string().min(1),
	label: z.string().min(1),
	description: z.string(),
	templatePath: z.string().min(1),
	// The identifier in the template that a copy renames.
	componentName: z.string().min(1),
});

export type ExampleTemplate = z.infer<typeof exampleTemplateSchema>;

// Every field is optional, so a config can carry just the one default a host cares about.
// strictObject throughout: a misspelled key is rejected rather than dropped, for the same
// reason COMMAND_FLAGS rejects a misspelled flag — an agent trusts output produced without
// the setting it thought it had asked for.
export const hostConfigSchema = z.strictObject({
	// Accepted so an editor can point at a JSON Schema. Yosegi itself ignores it.
	$schema: z.string().optional(),
	dataDir: z.string().min(1).optional(),
	registry: z
		.strictObject({
			source: z.array(z.string().min(1)).optional(),
			tsconfig: z.string().min(1).optional(),
			metadata: z.string().min(1).optional(),
		})
		.optional(),
	emit: z
		.strictObject({
			importMap: z.array(z.string().min(1)).optional(),
			metaTemplate: z.string().min(1).optional(),
		})
		.optional(),
	examples: z.array(exampleTemplateSchema).optional(),
});

export type HostConfig = z.infer<typeof hostConfigSchema>;

export type LoadedHostConfig = {
	// Absolute path of the file that was read. Reported in errors and used as the base for
	// every relative path inside it.
	path: string;
	config: HostConfig;
};

// The keys each level of the config accepts, so an unrecognized one can be answered with a
// candidate instead of just "not allowed". Kept next to the schema by hand: zod reports the
// keys it rejected, not the ones it would have taken.
const KNOWN_KEYS: Record<string, readonly string[]> = {
	"": ["$schema", "dataDir", "registry", "emit", "examples"],
	registry: ["source", "tsconfig", "metadata"],
	emit: ["importMap", "metaTemplate"],
	examples: ["key", "label", "description", "templatePath", "componentName"],
};

function configError(
	code:
		| typeof SERVICE_CODES.CONFIG_INVALID
		| typeof SERVICE_CODES.CONFIG_NOT_FOUND,
	message: string,
	details: Record<string, unknown>,
	suggestion?: string,
): ComposerError {
	return new ComposerError(code, message, null, {
		suggestion: suggestion ?? null,
		details,
	});
}

// A did-you-mean for the first unrecognized key, matched against the keys its own level
// accepts. Array indices are dropped from the path so examples[3] resolves to "examples".
function unknownKeySuggestion(error: z.ZodError): string | undefined {
	for (const issue of error.issues) {
		if (issue.code !== "unrecognized_keys") {
			continue;
		}
		const level = issue.path
			.filter((segment) => typeof segment === "string")
			.join(".");
		const known = KNOWN_KEYS[level];
		const first = issue.keys[0];
		if (known && first !== undefined) {
			return didYouMean(first, known);
		}
	}
	return undefined;
}

// Reads and validates one config file. Every failure carries the path, so the reader never
// has to work out which of several candidate files was actually consulted.
async function readHostConfig(path: string): Promise<LoadedHostConfig> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw configError(
				SERVICE_CODES.CONFIG_NOT_FOUND,
				`No config file at ${path}.`,
				{ path },
			);
		}
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw configError(
			SERVICE_CODES.CONFIG_INVALID,
			`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			{ path },
		);
	}
	const result = hostConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw configError(
			SERVICE_CODES.CONFIG_INVALID,
			`${path} failed schema validation.`,
			{ path, issues: result.error.issues },
			unknownKeySuggestion(result.error),
		);
	}
	// Duplicate example keys would make a lookup depend on array order, leaving the second
	// entry unreachable. The schema cannot express it, and finding it here names the key
	// rather than leaving the host wondering why the wrong template was copied.
	const duplicates = [
		...new Set(
			(result.data.examples ?? [])
				.map((example) => example.key)
				.filter((key, index, keys) => keys.indexOf(key) !== index),
		),
	];
	if (duplicates.length > 0) {
		throw configError(
			SERVICE_CODES.CONFIG_INVALID,
			`${path} has duplicate examples keys: ${duplicates.join(", ")}. Each key must be unique.`,
			{ path, duplicateKeys: duplicates },
		);
	}
	return { path, config: result.data };
}

// Walks up from `from` looking for the config, the way tsconfig resolution does, and stops
// at the filesystem root. A host whose commands run from a workspace package therefore
// picks up the config at the repository root without every invocation naming it.
async function discoverHostConfig(
	from: string,
): Promise<LoadedHostConfig | null> {
	let directory = resolve(from);
	for (;;) {
		const candidate = resolve(directory, HOST_CONFIG_FILENAME);
		try {
			return await readHostConfig(candidate);
		} catch (error) {
			// Only "there is no file here" continues the walk. A file that exists but is
			// broken stops it: silently climbing past it would hand the caller a different
			// config than the one they wrote.
			if (
				!(error instanceof ComposerError) ||
				error.code !== SERVICE_CODES.CONFIG_NOT_FOUND
			) {
				throw error;
			}
		}
		const parent = dirname(directory);
		if (parent === directory) {
			return null;
		}
		directory = parent;
	}
}

// The host config in effect, or null when there is none. An explicit path must exist;
// discovery finding nothing is not an error, since running without a config is supported.
export async function loadHostConfig(
	options: { explicitPath?: string | null; cwd?: string } = {},
): Promise<LoadedHostConfig | null> {
	const cwd = options.cwd ?? process.cwd();
	if (options.explicitPath) {
		return await readHostConfig(resolve(cwd, options.explicitPath));
	}
	return await discoverHostConfig(cwd);
}

// The defaults a config contributes, with every path already resolved. Null means "the
// config says nothing about this", which is what lets the CLI express the precedence chain
// as `flag ?? config ?? built-in default`.
export type HostConfigDefaults = {
	dataDir: string | null;
	registrySources: string[];
	tsconfig: string | null;
	metadata: string | null;
	// Joined into the one comma-separated string --import-map takes, so both sources of the
	// value reach buildImportMapResolver in the same form.
	importMap: string | null;
	metaTemplate: string | null;
	examples: ExampleTemplate[];
};

export const NO_HOST_CONFIG: HostConfigDefaults = {
	dataDir: null,
	registrySources: [],
	tsconfig: null,
	metadata: null,
	importMap: null,
	metaTemplate: null,
	examples: [],
};

export function hostConfigDefaults(
	loaded: LoadedHostConfig | null,
): HostConfigDefaults {
	if (!loaded) {
		return NO_HOST_CONFIG;
	}
	// Relative paths are read against the config's own directory rather than the cwd. That
	// is the point of the file: the same command means the same thing from anywhere in the
	// host, so a config committed to a repository works for everyone who checks it out.
	const base = dirname(loaded.path);
	const at = (value: string | undefined): string | null =>
		value === undefined ? null : resolve(base, value);
	const { config } = loaded;
	return {
		dataDir: at(config.dataDir),
		// The one exception to config-relative resolution: --source globs are matched
		// against --project-root (which defaults to the tsconfig's directory), and that base
		// is also what component ids are derived from. Rewriting them here would make the
		// same glob mean two different things depending on where it was written.
		registrySources: config.registry?.source ?? [],
		tsconfig: at(config.registry?.tsconfig),
		metadata: at(config.registry?.metadata),
		importMap: config.emit?.importMap?.join(",") ?? null,
		metaTemplate: at(config.emit?.metaTemplate),
		examples: (config.examples ?? []).map((example) => ({
			...example,
			templatePath: resolve(base, example.templatePath),
		})),
	};
}
