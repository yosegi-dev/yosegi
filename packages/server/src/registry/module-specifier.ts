import { relative } from "node:path";

// Turns a host source file into "the import specifier the host would actually write".
//
// The relative path the Manifest holds (`./app/components/data-table.tsx`) can't be
// written as an import statement on a host that has aliases set up via tsconfig's
// paths. inspect passes that line straight to the agent as source material, so leaving
// the alias unresolved would make the Manifest output a lie. The only material used for
// the conversion is tsconfig's paths — no guessing involved.

// Extensions stripped from the import specifier.
const EXTENSION_PATTERN = /\.(tsx|ts)$/;
// A directory's index is never written in the specifier (`~/components/foo`, not `~/components/foo/index`).
const INDEX_SUFFIX = "/index";
// The leading `./` on a paths substitution target. Dropped so relative paths compare uniformly.
const LEADING_DOT_SLASH = /^\.\//;

export type ModuleSpecifierResolverOptions = {
	// tsconfig's compilerOptions.paths.
	paths: Record<string, string[]> | undefined;
	// Base directory paths substitutions are resolved against (baseUrl, or the tsconfig's directory if absent).
	basePath: string;
};

// Turns a file's absolute path into a specifier. Null if it can't be resolved.
export type ModuleSpecifierResolver = (filePath: string) => string | null;

type PathRule = {
	// Prefix/suffix on the replacement side (what the host actually writes).
	aliasPrefix: string;
	aliasSuffix: string;
	// Prefix/suffix on the file path side, relative to basePath.
	targetPrefix: string;
	targetSuffix: string;
	// Whether this is an exact-match entry with no `*`.
	exact: boolean;
};

function toPosix(path: string): string {
	return path.split("\\").join("/");
}

// Strips the extension and `./`, normalizing into a form that can be compared.
function normalize(path: string): string {
	return toPosix(path)
		.replace(LEADING_DOT_SLASH, "")
		.replace(EXTENSION_PATTERN, "");
}

// `~/components/foo/index` becomes `~/components/foo`. An index directly under an alias
// (`~/index` → `~`) is left alone, since collapsing it would make it indistinguishable from the alias itself.
function dropIndexSuffix(specifier: string): string {
	if (!specifier.endsWith(INDEX_SUFFIX)) {
		return specifier;
	}
	const withoutIndex = specifier.slice(0, -INDEX_SUFFIX.length);
	return withoutIndex.includes("/") ? withoutIndex : specifier;
}

function buildRules(paths: Record<string, string[]>): PathRule[] {
	const rules: PathRule[] = [];
	for (const [pattern, substitutions] of Object.entries(paths)) {
		const patternStar = pattern.indexOf("*");
		for (const rawSubstitution of substitutions) {
			const substitution = normalize(rawSubstitution);
			const substitutionStar = substitution.indexOf("*");
			if (patternStar === -1) {
				// An entry fixed to a single file, like `"~/test-setup": ["./test-setup.ts"]`.
				rules.push({
					aliasPrefix: pattern,
					aliasSuffix: "",
					targetPrefix: substitution,
					targetSuffix: "",
					exact: true,
				});
				continue;
			}
			// An entry with `*` on only one side can't have its replacement determined, so skip it.
			if (substitutionStar === -1) {
				continue;
			}
			rules.push({
				aliasPrefix: pattern.slice(0, patternStar),
				aliasSuffix: pattern.slice(patternStar + 1),
				targetPrefix: substitution.slice(0, substitutionStar),
				targetSuffix: substitution.slice(substitutionStar + 1),
				exact: false,
			});
		}
	}
	// Check more specific entries first. On a host where both `"~/*": ["./app/*"]` and
	// `"*": ["./*"]` match, the one with the deeper substitution (`app/`) is the one that matches how the host actually writes it.
	return rules.sort((a, b) => {
		const byTarget = b.targetPrefix.length - a.targetPrefix.length;
		if (byTarget !== 0) {
			return byTarget;
		}
		const byAlias = b.aliasPrefix.length - a.aliasPrefix.length;
		return byAlias !== 0 ? byAlias : a.aliasPrefix.localeCompare(b.aliasPrefix);
	});
}

// Applies a single rule. Null if it doesn't match.
function applyRule(rule: PathRule, target: string): string | null {
	if (rule.exact) {
		return target === rule.targetPrefix ? rule.aliasPrefix : null;
	}
	if (
		!target.startsWith(rule.targetPrefix) ||
		!target.endsWith(rule.targetSuffix) ||
		target.length < rule.targetPrefix.length + rule.targetSuffix.length
	) {
		return null;
	}
	const star = target.slice(
		rule.targetPrefix.length,
		target.length - rule.targetSuffix.length,
	);
	return `${rule.aliasPrefix}${star}${rule.aliasSuffix}`;
}

export function buildModuleSpecifierResolver({
	paths,
	basePath,
}: ModuleSpecifierResolverOptions): ModuleSpecifierResolver {
	const rules = paths ? buildRules(paths) : [];
	if (rules.length === 0) {
		return () => null;
	}
	return (filePath) => {
		const target = normalize(relative(basePath, filePath));
		for (const rule of rules) {
			const specifier = applyRule(rule, target);
			if (specifier !== null) {
				return dropIndexSuffix(specifier);
			}
		}
		return null;
	};
}
