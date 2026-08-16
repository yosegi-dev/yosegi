import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { ComposerError, SERVICE_CODES } from "@yosegi/core";
import type * as ts from "typescript";
import { loadTypeScript, type TypeScriptModule } from "../typescript.ts";
import type { ExampleEntry, LoadedCatalog } from "./catalog.ts";

// Copy an example template into the host's tree and rename its export.
//
// The transformation is a file copy plus an identifier replace, and nothing else. A
// templating engine was the obvious alternative and is rejected on purpose: placeholders
// would stop the template from compiling and rendering on its own, and a template nobody can
// run is a template nobody notices has rotted. Keeping it real code means the same file is
// both the copy source and something the host's Storybook renders.
//
// The compiler API is picked up through loadTypeScript() rather than imported, so a host
// without one still gets a copy. See src/typescript.ts.

// What an identifier may look like. Both --name and the catalog's componentName are put into
// source text, so a value that is not an identifier would produce a file that cannot parse.
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type TemplateImport = {
	specifier: string;
	// 1-based line in the written file, not in the template: the reader opens the copy.
	line: number;
};

export type TemplateMockData = {
	name: string;
	kind: "array" | "object";
	line: number;
};

// The two things a copied screen always needs work on: the imports decide what the host has
// to have, and the inline literals are the mock data that has to become real data. Reported
// rather than acted on — Yosegi cannot know which of them the host wants to keep.
export type TemplateSurvey = {
	imports: TemplateImport[];
	mockData: TemplateMockData[];
};

export type ApplyResult = {
	out: string;
	key: string;
	componentName: string;
	template: string;
	// null when the survey could not run (a host without the TypeScript compiler API). The
	// copy itself has still happened, so this is a degraded field rather than a failure.
	nextSteps: TemplateSurvey | null;
	warnings: string[];
};

// Top-level imports and top-level array/object consts, with their positions.
//
// Read through the AST rather than by matching lines, because both targets routinely span
// several lines in a real template — an import list broken across lines, and a mock data
// array that is the bulk of the file.
export function surveyTemplate(
	source: string,
	fileName: string,
): TemplateSurvey {
	const tsApi = loadTypeScript();
	const sourceFile = tsApi.createSourceFile(
		fileName,
		source,
		tsApi.ScriptTarget.Latest,
		true,
		tsApi.ScriptKind.TSX,
	);
	const lineOf = (node: ts.Node): number =>
		sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
		1;

	const imports: TemplateImport[] = [];
	const mockData: TemplateMockData[] = [];
	for (const statement of sourceFile.statements) {
		if (
			tsApi.isImportDeclaration(statement) &&
			tsApi.isStringLiteral(statement.moduleSpecifier)
		) {
			imports.push({
				specifier: statement.moduleSpecifier.text,
				line: lineOf(statement),
			});
			continue;
		}
		if (!tsApi.isVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			const { initializer, name } = declaration;
			if (!initializer || !tsApi.isIdentifier(name)) {
				continue;
			}
			// Only literals: a const holding a call or a component is not mock data.
			const kind = tsApi.isArrayLiteralExpression(initializer)
				? "array"
				: tsApi.isObjectLiteralExpression(initializer)
					? "object"
					: null;
			if (kind !== null) {
				mockData.push({ name: name.text, kind, line: lineOf(declaration) });
			}
		}
	}
	return { imports, mockData };
}

export type RenameResult = {
	source: string;
	// Whether the template actually declares the name the catalog says it does. False means
	// the catalog and the template have drifted apart.
	declared: boolean;
	// Whether the rename went through the parser. False means the fallback below ran, which
	// cannot tell an identifier from the same word inside a string or a comment.
	structural: boolean;
	occurrences: number;
};

// Declarations that count as "the template declares this name". A screen template's export
// is a function in practice, but a `const X = () => ...` and a class are the same claim.
function declaresName(
	tsApi: TypeScriptModule,
	node: ts.Node,
	name: string,
): boolean {
	// Written as the positive form because that is the one that narrows to the union; the
	// negated version leaves `node` as a bare Node with no `name`.
	if (
		tsApi.isFunctionDeclaration(node) ||
		tsApi.isClassDeclaration(node) ||
		tsApi.isVariableDeclaration(node)
	) {
		const declared = node.name;
		return declared !== undefined && tsApi.isIdentifier(declared)
			? declared.text === name
			: false;
	}
	return false;
}

// Rename by rewriting identifier tokens, not by matching text.
//
// A plain replaceAll is what the host's own plop generator does, and it is wrong in a way
// that only shows up later: a template importing `FooExampleProps` alongside `FooExample`
// has that import rewritten to `BarProps`, which the module it comes from does not export,
// so the copy no longer compiles. Rewriting only Identifier nodes leaves substrings, string
// literals, and comments alone, because none of them are identifier tokens.
//
// This is a token-level rename, not a scope-aware one — every identifier with this exact
// text is rewritten, including an unrelated object property that happens to share the name.
// Distinguishing those needs a full Program and a TypeChecker, which would mean resolving
// the host's whole tsconfig to copy one file. The narrower guarantee is the one that matters
// here: nothing that is not an identifier is ever touched.
// The rename a host without the compiler API gets.
//
// Identifier boundaries still rule out the substring case that motivated all of this —
// `(?<![$\w])Foo(?![$\w])` does not match inside `FooProps` — so the copy still compiles.
// What it cannot do is tell code from prose, so a string literal or a comment holding the
// same word is rewritten too. That is a visible, harmless difference rather than a broken
// import, and the caller turns `structural: false` into a warning naming the file to read.
//
// Kept separate from renameComponent so it can be tested without a host that lacks the
// compiler. `from` is validated as an identifier before it gets here, so it carries no
// regular-expression metacharacters.
export function renameByIdentifierBoundary(
	source: string,
	from: string,
	to: string,
): RenameResult {
	const pattern = new RegExp(`(?<![$\\w])${from}(?![$\\w])`, "g");
	const occurrences = source.match(pattern)?.length ?? 0;
	return {
		source: source.replace(pattern, to),
		// Without a parser there is no declaration to confirm, only presence.
		declared: occurrences > 0,
		structural: false,
		occurrences,
	};
}

export function renameComponent(
	source: string,
	fileName: string,
	from: string,
	to: string,
): RenameResult {
	let tsApi: TypeScriptModule;
	try {
		tsApi = loadTypeScript();
	} catch {
		return renameByIdentifierBoundary(source, from, to);
	}

	const sourceFile = tsApi.createSourceFile(
		fileName,
		source,
		tsApi.ScriptTarget.Latest,
		true,
		tsApi.ScriptKind.TSX,
	);
	const spans: { start: number; end: number }[] = [];
	let declared = false;
	const visit = (node: ts.Node): void => {
		if (tsApi.isIdentifier(node) && node.text === from) {
			spans.push({ start: node.getStart(sourceFile), end: node.getEnd() });
		}
		if (declaresName(tsApi, node, from)) {
			declared = true;
		}
		tsApi.forEachChild(node, visit);
	};
	tsApi.forEachChild(sourceFile, visit);

	// Applied back to front so an earlier edit never shifts a later span's offsets.
	let renamed = source;
	for (const span of [...spans].reverse()) {
		renamed = renamed.slice(0, span.start) + to + renamed.slice(span.end);
	}
	return {
		source: renamed,
		declared,
		structural: true,
		occurrences: spans.length,
	};
}

// The two lines written above the copy. Short on purpose: it says where the file came from
// and that the link is one-way, which is the whole of what a reader of the copy needs.
function provenanceHeader(
	example: ExampleEntry,
	catalogPath: string,
): string[] {
	return [
		`// Copied from the "${example.key}" example (${example.templatePath}) by \`yosegi example apply\`.`,
		`// Catalog: ${catalogPath}. This file is yours to edit; it does not track later changes to the template.`,
	];
}

export async function applyExample(options: {
	catalog: LoadedCatalog;
	example: ExampleEntry;
	componentName: string;
	out: string;
}): Promise<ApplyResult> {
	const { catalog, example, componentName } = options;
	const out = resolve(options.out);
	if (!IDENTIFIER_PATTERN.test(componentName)) {
		throw new ComposerError(
			SERVICE_CODES.INVALID_ARGUMENT,
			`--name "${componentName}" is not a valid identifier, so substituting it would produce a file that cannot parse. Pass a name like "GuestListRoute".`,
		);
	}
	// The catalog's side of the rename gets the same check. A componentName that is not an
	// identifier can never name a component, and it reaches a RegExp in the no-compiler
	// fallback, where a metacharacter would otherwise change what the pattern matches.
	if (!IDENTIFIER_PATTERN.test(example.componentName)) {
		throw new ComposerError(
			SERVICE_CODES.INVALID_ARGUMENT,
			`componentName "${example.componentName}" for "${example.key}" in ${catalog.path} is not a valid identifier.`,
			null,
			{ details: { key: example.key, catalog: catalog.path } },
		);
	}

	const templatePath = resolve(catalog.root, example.templatePath);
	let template: string;
	try {
		template = await readFile(templatePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		throw new ComposerError(
			SERVICE_CODES.EXAMPLE_TEMPLATE_NOT_FOUND,
			`Example "${example.key}" points at ${templatePath}, which does not exist. Fix templatePath in ${catalog.path}, or its root (paths resolve against ${catalog.root}).`,
			null,
			{
				details: {
					key: example.key,
					templatePath,
					catalog: catalog.path,
					root: catalog.root,
				},
			},
		);
	}

	const warnings: string[] = [];
	const rename = renameComponent(
		template,
		templatePath,
		example.componentName,
		componentName,
	);
	// The catalog naming a component the template does not declare means the two have
	// drifted apart. The copy still succeeds — it is a valid file — but it keeps the
	// template's own export name, which is exactly the thing the caller asked to change.
	if (!rename.declared) {
		warnings.push(
			`Warning: the template declares no "${example.componentName}", so its export was not renamed. Check componentName for "${example.key}" in ${catalog.path}.`,
		);
	}
	// Without the parser the rename cannot tell code from prose, so say which file to read
	// rather than leaving a silently different result behind.
	if (!rename.structural) {
		warnings.push(
			`Warning: the TypeScript compiler API was unavailable, so "${example.componentName}" was renamed by identifier boundary instead of by parsing. Occurrences inside string literals and comments were renamed too; review ${out}.`,
		);
	}

	const header = provenanceHeader(example, catalog.path);
	const body = rename.source;
	const content = [...header, body].join("\n");

	await mkdir(dirname(out), { recursive: true });
	try {
		// "wx" rather than an existsSync check: the destination is a file the host owns and
		// may already have edited, and the flag refuses without a window between the two.
		await writeFile(out, content, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
		throw new ComposerError(
			SERVICE_CODES.EXAMPLE_OUTPUT_EXISTS,
			`${out} already exists. example apply never overwrites; delete it or pass a different --out.`,
			null,
			{ details: { out } },
		);
	}

	let nextSteps: TemplateSurvey | null = null;
	try {
		const survey = surveyTemplate(body, out);
		// Positions are shifted past the header so they address the file just written.
		nextSteps = {
			imports: survey.imports.map((entry) => ({
				...entry,
				line: entry.line + header.length,
			})),
			mockData: survey.mockData.map((entry) => ({
				...entry,
				line: entry.line + header.length,
			})),
		};
	} catch (error) {
		// Guidance is a bonus on top of a copy that already succeeded, so a host without the
		// compiler API loses the survey rather than the command.
		warnings.push(
			`Warning: could not survey the copied file, so no next steps are listed. ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return {
		out,
		key: example.key,
		componentName,
		template: relative(catalog.root, templatePath),
		nextSteps,
		warnings,
	};
}
