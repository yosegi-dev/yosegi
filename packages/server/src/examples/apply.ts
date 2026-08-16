import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { ComposerError, SERVICE_CODES } from "@yosegi/core";
import type * as ts from "typescript";
import { loadTypeScript } from "../typescript.ts";
import type { ExampleEntry, LoadedCatalog } from "./catalog.ts";

// Copy an example template into the host's tree and rename its export.
//
// The transformation is a file copy plus an identifier replace, and nothing else. A
// templating engine was the obvious alternative and is rejected on purpose: placeholders
// would stop the template from compiling and rendering on its own, and a template nobody can
// run is a template nobody notices has rotted. Keeping it real code means the same file is
// both the copy source and something the host's Storybook renders.
//
// The compiler API is only reached for the post-copy guidance, and is picked up through
// loadTypeScript() so a host without one still gets the copy. See src/typescript.ts.

// What an identifier may look like. --name is substituted into source text, so a value that
// is not an identifier would produce a file that cannot parse.
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
	// A componentName the template does not contain means the catalog and the template have
	// drifted apart. The copy still succeeds — it is a valid file — but it keeps the
	// template's own export name, which is exactly the thing the caller asked to change.
	if (!template.includes(example.componentName)) {
		warnings.push(
			`Warning: the template does not contain "${example.componentName}", so nothing was renamed. Check componentName for "${example.key}" in ${catalog.path}.`,
		);
	}

	const header = provenanceHeader(example, catalog.path);
	const body = template.replaceAll(example.componentName, componentName);
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
