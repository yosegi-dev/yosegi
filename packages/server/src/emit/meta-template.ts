import type { MetaTemplate } from "@yosegi/core/emit";
import * as ts from "typescript";

// Reads the boilerplate a host requires in a Story's meta from a TypeScript file the host wrote itself.
//
// The meta that `screen generate` produces has only `title` — host-specific requirements like
// `tags: ["autodocs"]`, a Docs page setting, or JSDoc design references never make it in.
// Neither the formatter nor the linter catches this, so convention violations only surface at
// review time. The host-side template fills that gap.
//
// A template just needs to be "an ordinary TypeScript file with one meta." Whether it's a
// bare-bones boilerplate written as a fragment or an existing Story used as a copy source, both
// take the same shape, so both can be read through the same path.
//
// Values are carried through as raw source fragments, not interpreted, because assembling them
// on the Yosegi side would leave room to fabricate "information that doesn't exist," like a
// Figma URL that doesn't actually apply. Conversely, a URL written in a copy-source Story can't
// possibly belong to the screen being built, so any carried-over URL gets called out as a warning.

// Properties Yosegi itself writes, so the template's values for them are never used.
// title comes from `--title`; component is skipped because a screen isn't a single component.
const OWNED_PROPERTIES = new Set(["title", "component"]);
// Type imports the CSF emitter writes on its own. Not carried over from the template to avoid duplicates.
const FRAMEWORK_TYPE_IMPORTS = new Set(["Meta", "StoryObj"]);
const META_VARIABLE_NAME = "meta";
const JSDOC_PREFIX = "/**";
const URL_PATTERN = /https?:\/\/[^\s"'`)]+/g;

export type ParsedMetaTemplate = {
	template: MetaTemplate;
	// Notes about what wasn't carried over, or what was carried over but is questionable.
	warnings: string[];
};

// Strips a wrapper like `const meta: Meta<typeof X> = { ... } satisfies Meta`.
function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isParenthesizedExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

type MetaDeclaration = {
	// The contents of meta.
	object: ts.ObjectLiteralExpression;
	// The statement to use as the starting point for finding JSDoc.
	statement: ts.Statement;
};

// Prefers `const meta = {...}`, falling back to `export default {...}` if absent.
function findMetaDeclaration(
	sourceFile: ts.SourceFile,
): MetaDeclaration | null {
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (
				!ts.isIdentifier(declaration.name) ||
				declaration.name.text !== META_VARIABLE_NAME ||
				!declaration.initializer
			) {
				continue;
			}
			const object = unwrapExpression(declaration.initializer);
			if (ts.isObjectLiteralExpression(object)) {
				return { object, statement };
			}
		}
	}
	for (const statement of sourceFile.statements) {
		if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
			continue;
		}
		const object = unwrapExpression(statement.expression);
		if (ts.isObjectLiteralExpression(object)) {
			return { object, statement };
		}
	}
	return null;
}

// The JSDoc directly above meta. Some hosts write design references (Figma / Notion) here, so we pick it up.
function readJsDoc(
	source: string,
	statement: ts.Statement,
): string | undefined {
	const ranges = ts.getLeadingCommentRanges(source, statement.getFullStart());
	const jsdoc = (ranges ?? [])
		.filter((range) => source.slice(range.pos, range.pos + 3) === JSDOC_PREFIX)
		.at(-1);
	return jsdoc ? source.slice(jsdoc.pos, jsdoc.end) : undefined;
}

// Strips the indentation of the line a property starts on, since the output side re-indents it by exactly one level.
function dedent(
	source: string,
	sourceFile: ts.SourceFile,
	node: ts.Node,
): string {
	const start = node.getStart();
	const { line } = sourceFile.getLineAndCharacterOfPosition(start);
	const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
	const indent = /^[\t ]*/.exec(source.slice(lineStart, start))?.[0] ?? "";
	const text = node.getText();
	if (indent === "") {
		return text;
	}
	const [head, ...rest] = text.split("\n");
	return [
		head,
		...rest.map((entry) =>
			entry.startsWith(indent) ? entry.slice(indent.length) : entry,
		),
	].join("\n");
}

type ImportCandidate = {
	statement: string;
	// Local names. Empty means a side-effect import (always kept).
	localNames: string[];
};

function collectImportBindings(declaration: ts.ImportDeclaration): string[] {
	const clause = declaration.importClause;
	if (!clause) {
		return [];
	}
	const names: string[] = [];
	if (clause.name) {
		names.push(clause.name.text);
	}
	const bindings = clause.namedBindings;
	if (bindings && ts.isNamespaceImport(bindings)) {
		names.push(bindings.name.text);
	}
	if (bindings && ts.isNamedImports(bindings)) {
		for (const specifier of bindings.elements) {
			names.push(specifier.name.text);
		}
	}
	return names;
}

// The same import the CSF emitter always writes: `import type { Meta, StoryObj } from ...`.
function isFrameworkTypeImport(declaration: ts.ImportDeclaration): boolean {
	const names = collectImportBindings(declaration);
	return (
		names.length > 0 && names.every((name) => FRAMEWORK_TYPE_IMPORTS.has(name))
	);
}

function isReferenced(name: string, text: string): boolean {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

export function parseMetaTemplate(
	source: string,
	fileName: string,
): ParsedMetaTemplate {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const meta = findMetaDeclaration(sourceFile);
	if (!meta) {
		throw new Error(
			`Meta template "${fileName}" has no meta object. Write it as "const meta: Meta = { ... };" (an existing Story file works as-is).`,
		);
	}

	const warnings: string[] = [];
	const properties: string[] = [];
	for (const property of meta.object.properties) {
		const name = property.name?.getText();
		if (name && OWNED_PROPERTIES.has(name)) {
			warnings.push(
				`Ignored "${name}" from the meta template (Yosegi derives it from the screen).`,
			);
			continue;
		}
		properties.push(dedent(source, sourceFile, property));
	}

	const jsdoc = readJsDoc(source, meta.statement);
	// Whether an import is kept is decided by "is it referenced from the carried-over content?"
	// Using a copy-source Story as the template would otherwise drag in that component's own import too.
	const retained = [jsdoc ?? "", ...properties].join("\n");
	const candidates: ImportCandidate[] = [];
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			isFrameworkTypeImport(statement)
		) {
			continue;
		}
		candidates.push({
			statement: statement.getText(),
			localNames: collectImportBindings(statement),
		});
	}
	const imports = candidates
		.filter((candidate) => {
			if (candidate.localNames.length === 0) {
				return true;
			}
			const used = candidate.localNames.some((name) =>
				isReferenced(name, retained),
			);
			if (!used) {
				warnings.push(
					`Dropped the meta template import "${candidate.localNames.join(", ")}" because the carried-over meta does not reference it.`,
				);
			}
			return used;
		})
		.map((candidate) => candidate.statement);

	// If a copy-source Story was given, its URL doesn't belong to the screen being built.
	// Dropping it would silently ignore that reference, so we keep it and call it out instead.
	const urls = [...retained.matchAll(URL_PATTERN)].map((match) => match[0]);
	if (urls.length > 0) {
		warnings.push(
			`Carried these URLs over verbatim from the meta template. Check that they belong to this screen: ${[...new Set(urls)].join(", ")}`,
		);
	}

	return { template: { imports, jsdoc, properties }, warnings };
}
