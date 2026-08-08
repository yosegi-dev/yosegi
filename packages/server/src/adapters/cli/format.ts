import type {
	ComponentManifest,
	ComponentRegistry,
	PropDefinition,
	PropField,
	PropShape,
	RegistryBuildInputs,
} from "@yosegi/core";
import {
	renderImportStatement,
	resolveComponentSpecifier,
} from "@yosegi/core/emit";

// Builds the default (text) output for component list / inspect.
//
// The reader is an agent, so the point of formatting isn't visual polish — it's making the
// next move decidable from a single output. list keeps the density to 3 lines per
// component, including a prop summary, so it stays readable even for a host whose registry
// has hundreds of entries. Anything needing full detail falls through to --json or inspect.

// The cap on props listed in list. Beyond this, only the count is shown, pointing to inspect.
const LIST_PROP_LIMIT = 8;

// Represent a prop's type as a single token. For enum, showing the option count signals
// "pick from this set".
export function summarizePropKind(def: PropDefinition): string {
	if (def.kind === "enum") {
		return `enum(${(def.options ?? []).length})`;
	}
	return def.kind;
}

// Required props first, then alphabetical. Overlooking a required prop leads straight to a
// validation error, so ordering makes it stand out.
function sortedProps(manifest: ComponentManifest): [string, PropDefinition][] {
	return Object.entries(manifest.props).sort(([nameA, defA], [nameB, defB]) => {
		const requiredDiff =
			Number(defB.required ?? false) - Number(defA.required ?? false);
		return requiredDiff !== 0 ? requiredDiff : nameA.localeCompare(nameB);
	});
}

function sortedSlots(manifest: ComponentManifest): string[] {
	// children is the special slot that becomes JSX children, so it's always first.
	return Object.keys(manifest.slots).sort((a, b) => {
		if (a === "children") return -1;
		if (b === "children") return 1;
		return a.localeCompare(b);
	});
}

// The annotations attached to the id line (category, recommended, deprecated).
function badges(manifest: ComponentManifest): string {
	const parts: string[] = [];
	if (manifest.category) {
		parts.push(`[${manifest.category}]`);
	}
	if (manifest.curation?.recommended) {
		parts.push("recommended");
	}
	if (manifest.constraints?.deprecated) {
		parts.push("deprecated");
	}
	return parts.join(" ");
}

function formatListEntry(manifest: ComponentManifest): string {
	const header = [manifest.id, badges(manifest)].filter(Boolean).join(" ");

	const props = sortedProps(manifest);
	const shown = props
		.slice(0, LIST_PROP_LIMIT)
		.map(
			([name, def]) =>
				`${name}:${summarizePropKind(def)}${def.required ? "*" : ""}`,
		);
	if (props.length > LIST_PROP_LIMIT) {
		shown.push(`(+${props.length - LIST_PROP_LIMIT} more)`);
	}

	const slots = sortedSlots(manifest).map((name) =>
		manifest.slots[name].required ? `${name}*` : name,
	);

	return [
		header,
		`    props: ${shown.length > 0 ? shown.join(" ") : "-"}`,
		`    slots: ${slots.length > 0 ? slots.join(" ") : "-"}`,
	].join("\n");
}

export type RegistryProvenance = {
	version: string;
	generatedAt: string | null;
	inputs: RegistryBuildInputs | null;
	// Absolute path of the CLI entry that built the registry. Absent on registries built
	// before this was recorded.
	cliPath?: string | null;
};

export type ComponentListSummary = {
	// Count after filtering, and the total count in the registry. Lets the reader judge
	// whether the filter is over-narrowing.
	shown: number;
	total: number;
	// The filters that were applied (for display).
	filters: string[];
	// Where the registry came from.
	registry: RegistryProvenance;
};

// Build a command that rebuilds the same registry, from the recorded inputs.
// "What this was built from" is shorter shown as a single line that can be typed verbatim,
// rather than explained in prose. Every recorded input is written out here without
// exception — dropping even one produces a rebuild line that makes a different registry
// (e.g. dropping storybook-url loses the deep links and even changes the version hash).
// Output destinations like --data-dir / --out aren't printed, since the reader is already
// supplying that value right now.
function renderRebuildCommand(
	inputs: RegistryBuildInputs | null,
): string | null {
	if (!inputs) {
		return null;
	}
	const args = [
		// A glob without quotes gets eaten by the shell. Print it in a form that can be
		// copied verbatim.
		...(inputs.sources ?? []).map(
			(source) => `--source ${JSON.stringify(source)}`,
		),
		inputs.tsconfig ? `--tsconfig ${inputs.tsconfig}` : null,
		inputs.projectRoot ? `--project-root ${inputs.projectRoot}` : null,
		inputs.index ? `--index ${inputs.index}` : null,
		inputs.storybookUrl ? `--storybook-url ${inputs.storybookUrl}` : null,
		inputs.version ? `--version ${inputs.version}` : null,
		inputs.metadata ? `--metadata ${inputs.metadata}` : null,
		inputs.report ? `--report ${inputs.report}` : null,
	].filter((arg): arg is string => arg !== null);
	return args.length > 0 ? `yosegi registry build ${args.join(" ")}` : null;
}

// A minimal rebuild scaffold for registries with no recorded inputs. The actual glob / path
// is unknown, so placeholders are shown instead.
const REBUILD_FALLBACK =
	"yosegi registry build --source <glob> --tsconfig <path>";

// The warning text for when the Yosegi that built the registry and the currently running
// CLI's version disagree. Neither the version itself (a content hash) nor generatedAt can
// detect "an older Yosegi failed to emit newer fields". Since this is the only freshness
// signal that can say that, any difference at all (including no record) prompts a rebuild.
// Stays silent (null) when they match.
export function formatRegistryVersionWarning(
	registry: {
		builtWith?: ComponentRegistry["builtWith"];
		inputs?: RegistryBuildInputs | null;
	},
	runningVersion: string,
): string | null {
	const built = registry.builtWith;
	if (built === runningVersion) {
		return null;
	}
	const rebuild =
		renderRebuildCommand(registry.inputs ?? null) ?? REBUILD_FALLBACK;
	const reason = built
		? `built by Yosegi ${built}, but this CLI is ${runningVersion}`
		: `built by an unrecorded (older) Yosegi version; this CLI is ${runningVersion}`;
	return [
		`Warning: this registry was ${reason}. It may be missing fields newer versions emit (for example a function prop's call signatures), which no other freshness signal will show. Rebuild it:`,
		`  ${rebuild}`,
	].join("\n");
}

// Whether the host's current --source content still matches what the registry recorded.
// Recomputing requires re-running extraction with the same inputs, which is I/O the
// formatter itself can't do — the caller (cli.ts) performs the recompute and hands back
// one of these. Deliberately independent of --index: an unreachable Storybook must never
// turn this into "unknown" or a false "current".
export type RegistrySourceCheck =
	| { checked: true; current: boolean }
	// checked: false covers every reason a comparison couldn't be made (no recorded
	// inputs, a pinned --version that doesn't track content, or the recompute itself failing).
	| { checked: false; reason: string };

// Whether the Storybook-derived layer (curation / recommended / story links) still
// matches what the registry recorded. Separate from RegistrySourceCheck because the two
// can fail independently — most commonly, Storybook being down (or on a different port)
// makes this "couldn't check" while the source verdict above is unaffected.
export type RegistryIndexCheck =
	| { checked: true; current: boolean }
	| { checked: false; reason: string };

// "When, from what, and is it still current." Answers the question `registry status`
// exists for: everything list's provenance line already shows (built at / by which
// Yosegi / from which inputs), plus the two things no other command can say — whether the
// recorded --source still produces this exact content, and separately whether the
// Storybook-derived curation layer still matches.
export function formatRegistryStatus(
	registry: {
		version: string;
		generatedAt?: string | null;
		builtWith?: string;
		builtWithCliPath?: string | null;
		inputs?: RegistryBuildInputs | null;
	},
	runningVersion: string,
	sourceCheck: RegistrySourceCheck,
	indexCheck: RegistryIndexCheck,
): string {
	const lines = [
		`registry ${registry.version}`,
		registry.generatedAt
			? `  built: ${registry.generatedAt}`
			: "  built: not recorded",
		registry.builtWith
			? `  built by Yosegi: ${registry.builtWith}${registry.builtWith === runningVersion ? "" : ` (running ${runningVersion})`}`
			: `  built by Yosegi: unrecorded (running ${runningVersion})`,
	];
	if (registry.builtWithCliPath) {
		lines.push(`  cli: ${registry.builtWithCliPath}`);
	}
	const inputs = registry.inputs;
	const inputLines = inputs
		? [
				...(inputs.sources ?? []).map((source) => `    source: ${source}`),
				inputs.tsconfig ? `    tsconfig: ${inputs.tsconfig}` : null,
				inputs.projectRoot ? `    projectRoot: ${inputs.projectRoot}` : null,
				inputs.index ? `    index: ${inputs.index}` : null,
				inputs.storybookUrl ? `    storybookUrl: ${inputs.storybookUrl}` : null,
				inputs.version ? `    version: ${inputs.version}` : null,
				inputs.metadata ? `    metadata: ${inputs.metadata}` : null,
				inputs.report ? `    report: ${inputs.report}` : null,
			].filter((line): line is string => line !== null)
		: [];
	lines.push(
		"  inputs:",
		...(inputLines.length > 0 ? inputLines : ["    (not recorded)"]),
	);
	lines.push(
		sourceCheck.checked
			? sourceCheck.current
				? "  source: current"
				: "  source: stale — source changed since this registry was built"
			: `  source: unknown — ${sourceCheck.reason}`,
	);
	lines.push(
		indexCheck.checked
			? indexCheck.current
				? "  index: current"
				: "  index: stale — the Storybook-derived layer (recommended / story links) changed since this registry was built"
			: `  index: unknown — ${indexCheck.reason}`,
	);
	// A single rebuild line covers both — printing it once per stale check would just
	// repeat the same command twice.
	const stale =
		(sourceCheck.checked && !sourceCheck.current) ||
		(indexCheck.checked && !indexCheck.current);
	if (stale) {
		const rebuild = renderRebuildCommand(inputs ?? null) ?? REBUILD_FALLBACK;
		lines.push("  rebuild:", `    ${rebuild}`);
	}
	const versionWarning = formatRegistryVersionWarning(registry, runningVersion);
	if (versionWarning) {
		lines.push("", versionWarning);
	}
	return lines.join("\n");
}

// "When and from what was this registry built." version is a content hash, so a matching
// value only tells you the content matches — it can't say whether the registry has drifted
// from the host's current state. Since list is also the command used to check "does a
// registry exist", make that single output enough to judge freshness too.
function formatRegistryProvenance(provenance: RegistryProvenance): string[] {
	const built = provenance.generatedAt
		? `built ${provenance.generatedAt}`
		: "built: not recorded (rebuild to record it)";
	const lines = [`registry ${provenance.version}  ${built}`];
	// In an environment spanning multiple checkouts (multiple clones, CI vs. local, etc.),
	// the reader can't tell which path the `yosegi` in the rebuild line refers to. State it
	// outright here whenever it's known.
	if (provenance.cliPath) {
		lines.push(`  cli: ${provenance.cliPath}`);
	}
	const rebuild = renderRebuildCommand(provenance.inputs);
	if (rebuild) {
		lines.push(`  rebuild: ${rebuild}`);
	}
	return lines;
}

// The registry provenance block shown at the top of `component list` (count / hash /
// cli / rebuild lines). Exposed separately so `component inspect` can print the same
// block once above several components, instead of `list --query` per id being the only
// way to see it (the workaround this was written to replace).
export function formatRegistryHeader(provenance: RegistryProvenance): string {
	return formatRegistryProvenance(provenance).join("\n");
}

export function formatComponentList(
	components: ComponentManifest[],
	summary: ComponentListSummary,
	options: { quiet?: boolean } = {},
): string {
	const filterNote =
		summary.filters.length > 0 ? ` matching ${summary.filters.join(" ")}` : "";
	const countLine = `${summary.shown} of ${summary.total} components${filterNote}`;
	// --quiet drops the whole provenance block (count included), for a caller that's
	// already read it once and just wants the entries.
	const head = options.quiet
		? null
		: [countLine, formatRegistryHeader(summary.registry)].join("\n");
	if (components.length === 0) {
		const note =
			"No matches. Loosen --query / --category, or rebuild the registry.";
		return head ? `${head}\n\n${note}` : note;
	}
	// The trailing "* = required" legend, so the meaning of the symbol doesn't have to be
	// asked about every time.
	const body = [
		...components.map(formatListEntry),
		"",
		"* = required. Run component inspect <id> for details, or --json for everything.",
	].join("\n");
	return head ? `${head}\n\n${body}` : body;
}

function formatPropDetail(name: string, def: PropDefinition): string {
	const flags: string[] = [summarizePropKind(def)];
	if (def.required) {
		flags.push("required");
	}
	if (def.nullable) {
		flags.push("nullable");
	}
	if (def.editable === false) {
		// Make it explicit that a written value won't be validated (it's filled in at
		// implementation time).
		flags.push("not-editable");
	}
	if (def.defaultValue !== undefined) {
		flags.push(`default: ${JSON.stringify(def.defaultValue)}`);
	}
	const lines = [`  ${name}  ${flags.join("  ")}`];
	if (def.kind === "enum") {
		lines.push(
			`      options: ${(def.options ?? []).map((option) => JSON.stringify(option)).join(" | ")}`,
		);
	}
	if (def.signatures) {
		lines.push(...formatSignatures(def.signatures));
	}
	if (def.shape) {
		lines.push(...formatPropShape(def.shape));
	}
	if (def.description) {
		lines.push(...indentDescription(def.description));
	}
	return lines.join("\n");
}

// The hanging indent position for a prop's description.
const DETAIL_INDENT = "      ";
// Indented one level deeper than props, to show that a shape's fields nest under it.
const FIELD_INDENT = "        ";

// Align every line of a multi-line description to the same depth. If only the first line
// were indented and the rest fell back to column 0, it would become unreadable which lines
// belong to which prop. Blank lines are paragraph breaks, so they're kept, just turned into
// an empty string so no trailing whitespace is left behind.
function indentDescription(description: string): string[] {
	return description
		.split("\n")
		.map((line) => line.trim())
		.map((line) => (line ? `${DETAIL_INDENT}${line}` : ""));
}

// The call signature for a function prop. A single signature gets one line following the
// prop line; overloads state the count up front before listing them, so it isn't missed
// that multiple call shapes are possible.
function formatSignatures(signatures: string[]): string[] {
	if (signatures.length === 1) {
		return [`${DETAIL_INDENT}signature: ${signatures[0]}`];
	}
	return [
		`${DETAIL_INDENT}signatures (${signatures.length} overloads):`,
		...signatures.map((signature) => `${FIELD_INDENT}${signature}`),
	];
}

// One level deeper than FIELD_INDENT, since a variant field nests under the "exactly one
// of:" line the way a field nests under "shape:".
const VARIANT_INDENT = `${FIELD_INDENT}  `;

// Renders one column-aligned block of fields (name [+ "?"], type, description). Shared
// between a shape's plain fields and, separately, its variant fields — each block gets
// its own column widths, since lining up two unrelated groups would only coincidentally align.
function renderFieldBlock(fields: PropField[], indent: string): string[] {
	const names = fields.map(
		(field) => `${field.name}${field.optional ? "?" : ""}`,
	);
	const nameWidth = Math.max(...names.map((name) => name.length));
	const typeWidth = Math.max(...fields.map((field) => field.type.length));
	return fields.map((field, index) => {
		const type = field.description ? field.type.padEnd(typeWidth) : field.type;
		const description = field.description ? `  ${field.description}` : "";
		return `${indent}${names[index].padEnd(nameWidth)}  ${type}${description}`;
	});
}

// The first-level shape of props flattened to json. Names, types, and descriptions are
// column-aligned, one field per line.
function formatPropShape(shape: PropShape): string[] {
	const suffix = shape.package ? ` (${shape.package})` : "";
	// A type whose "name" is actually a list of union members gets wrapped in parentheses
	// before appending `[]`. Otherwise `string | number[]` reads as "string or an array of number".
	const base =
		shape.array && shape.type.includes("|") ? `(${shape.type})` : shape.type;
	// fields holds only what every branch of a discriminated union shares; variants holds
	// what's exclusive to one branch. Naming both explicitly in the header is what makes
	// "you must pick exactly one" unmissable, instead of a single note buried at the end
	// of the line that a flat, all-fields-look-equally-optional list could contradict.
	const hasVariants = (shape.variants?.length ?? 0) > 0;
	const unionNote = shape.union
		? hasVariants
			? " (each item: fields below + exactly one of the variants)"
			: " (union)"
		: "";
	const header = `${DETAIL_INDENT}shape: ${base}${shape.array ? "[]" : ""}${suffix}${unionNote}`;
	if (shape.members) {
		// A union of literals / primitives shows the selectable values themselves, not fields.
		const members = shape.members.join(" | ");
		if (members === shape.type) {
			// The type name is the members themselves (a short, unnamed union). Splitting
			// into two lines would just say the same thing twice.
			return [header];
		}
		const more = shape.truncated ? ` (+${shape.truncated} more)` : "";
		return [header, `${FIELD_INDENT}${members}${more}`];
	}
	if (shape.fields.length === 0 && !hasVariants) {
		// A type that wasn't expanded (a union, or a third-party type) shows only its name.
		// It's not a substitute for the shape, but it's a lead for digging into the host's
		// source or type definitions.
		return [header];
	}
	const lines =
		shape.fields.length > 0 ? renderFieldBlock(shape.fields, FIELD_INDENT) : [];
	if (hasVariants) {
		// No field here carries a misleading `?` from being merged across branches — each
		// is required within the one branch it belongs to, unless it's genuinely optional
		// there too (still marked `?` in that case).
		lines.push(
			`${FIELD_INDENT}exactly one of:`,
			...renderFieldBlock(shape.variants ?? [], VARIANT_INDENT),
		);
	}
	if (shape.truncated) {
		lines.push(`${FIELD_INDENT}(+${shape.truncated} more)`);
	}
	return [header, ...lines];
}

export function formatComponentInspect(manifest: ComponentManifest): string {
	const lines: string[] = [
		[manifest.id, badges(manifest)].filter(Boolean).join(" "),
	];
	if (manifest.description) {
		lines.push(manifest.description);
	}
	// Print the specifier the host actually writes, not the registry's raw path. An agent
	// copies this line verbatim, so printing it without resolving the alias would hand out a
	// relative path that doesn't exist. Built with the same function used by the generator,
	// so it doesn't disagree about whether a default export needs braces either.
	lines.push(
		"",
		renderImportStatement(resolveComponentSpecifier(manifest), [
			{
				exportName: manifest.import.exportName,
				localName: manifest.import.exportName,
				kind: manifest.import.kind,
			},
		]),
	);
	if (manifest.curation?.storyTitle) {
		const count = manifest.curation.storyCount;
		lines.push(
			`story: ${manifest.curation.storyTitle}${count ? ` (${count})` : ""}`,
		);
	}
	if (manifest.references?.storybook) {
		lines.push(`storybook: ${manifest.references.storybook}`);
	}
	// The URL only points at the first Story. Confirming a specific behavior requires
	// opening the Story file directly, so give its coordinates (file and Story name) too.
	if (manifest.curation?.storyFile) {
		lines.push(`story file: ${manifest.curation.storyFile}`);
	}
	const storyNames = manifest.curation?.storyNames ?? [];
	if (storyNames.length > 0) {
		lines.push(`stories: ${storyNames.join(", ")}`);
	}

	const props = sortedProps(manifest);
	lines.push("", `props (${props.length})`);
	lines.push(
		props.length > 0
			? props.map(([name, def]) => formatPropDetail(name, def)).join("\n")
			: "  -",
	);
	// A single note rather than an enumeration: the inherited props themselves aren't
	// listed here (a thin wrapper around a third-party primitive can carry hundreds), just
	// that they exist and are safe to pass.
	if (manifest.passthrough) {
		lines.push(`also accepts: ${manifest.passthrough}`);
	}

	const slots = sortedSlots(manifest);
	lines.push("", `slots (${slots.length})`);
	lines.push(
		slots.length > 0
			? slots
					.map((name) => {
						const def = manifest.slots[name];
						const flags = [
							def.required ? "required" : null,
							def.maxItems ? `maxItems: ${def.maxItems}` : null,
							def.allowedComponents
								? `allowed: ${def.allowedComponents.join(", ")}`
								: null,
						].filter(Boolean);
						return `  ${name}${flags.length > 0 ? `  ${flags.join("  ")}` : ""}`;
					})
					.join("\n")
			: "  -",
	);

	// For a component where type extraction failed, the handful of props listed can look
	// like the real API. To avoid inviting a guess at the props, point toward reading the
	// source and the supplementation options instead. A registry without propsFromTypes
	// (built from index.json) has no argTypes, so props stays empty unless explicit
	// metadata fills it in — in that case, print the same note.
	const unreadable =
		manifest.propsFromTypes === false ||
		(manifest.propsFromTypes === undefined && props.length === 0);
	if (unreadable) {
		lines.push(
			"",
			"Note: props could not be read from the types. This list is not the real API, so read the host's source directly.",
			`Writing a prop that exists in the source into Screen JSON will still be rejected as UNKNOWN_PROP. Supply the props for "${manifest.id}" via registry build --metadata.`,
		);
	}

	return lines.join("\n");
}
