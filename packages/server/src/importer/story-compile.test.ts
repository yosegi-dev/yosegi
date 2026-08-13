import { describe, expect, it } from "bun:test";
import type { ComponentRegistry } from "@yosegi/core";
import { parseComponentRegistry, withSyntheticComponents } from "@yosegi/core";
import { emitCsf } from "@yosegi/core/emit";
import * as ts from "typescript";

// Compiles emitted Stories with the real TypeScript checker instead of only parsing
// them. Syntax checks alone cannot see duplicate identifiers — `import { meta }`
// next to `const meta` parses fine and only dies in the host's build — so every
// import target is stubbed in-memory and the Story must type-check clean.

const STORY_FILE = "/host/story.stories.tsx";

// A minimal @storybook/react stand-in with the two names the emitted file imports.
const STORYBOOK_STUB = [
	"export type Meta = { title?: string };",
	"export type StoryObj = { render?: () => unknown };",
].join("\n");

// The emitted output only ever writes div (Box) and h1 (Heading) as intrinsic tags.
// Everything else — e.g. <meta> from an unaliased lowercase local name — must fail.
const GLOBALS_STUB = [
	"declare global {",
	"\tnamespace JSX {",
	"\t\ttype Element = unknown;",
	"\t\tinterface IntrinsicElements {",
	"\t\t\tdiv: { className?: string; children?: unknown };",
	"\t\t\th1: { className?: string; children?: unknown };",
	"\t\t}",
	"\t}",
	"}",
	"export {};",
].join("\n");

function componentStub(exportNames: string[]): string {
	return exportNames
		.map(
			(name) =>
				`export function ${name}(props: Record<string, unknown>): null { return null; }`,
		)
		.join("\n");
}

// Type-checks the Story against in-memory stubs; returns the diagnostics as strings.
function compile(source: string, stubs: Record<string, string> = {}): string[] {
	const files = new Map<string, string>([
		[STORY_FILE, source],
		["/host/globals.d.ts", GLOBALS_STUB],
		[
			"/host/node_modules/@storybook/react/package.json",
			'{ "name": "@storybook/react", "main": "index.ts", "types": "index.ts" }',
		],
		["/host/node_modules/@storybook/react/index.ts", STORYBOOK_STUB],
		...Object.entries(stubs),
	]);
	// Module resolution asks for the directories around each candidate file, so the
	// virtual tree's directories have to exist too.
	const directories = new Set<string>(["/"]);
	for (const file of files.keys()) {
		let dir = file;
		while (dir.includes("/", 1)) {
			dir = dir.slice(0, dir.lastIndexOf("/"));
			directories.add(dir);
		}
	}
	const options: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		// preserve keeps type checking without demanding a react/jsx-runtime module.
		jsx: ts.JsxEmit.Preserve,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		target: ts.ScriptTarget.ESNext,
		skipLibCheck: true,
	};
	// The default host serves lib.d.ts; the in-memory map takes priority over it.
	const base = ts.createCompilerHost(options);
	const host: ts.CompilerHost = {
		...base,
		fileExists: (fileName) => files.has(fileName) || base.fileExists(fileName),
		readFile: (fileName) => files.get(fileName) ?? base.readFile(fileName),
		directoryExists: (directoryName) =>
			directories.has(directoryName) ||
			(base.directoryExists?.(directoryName) ?? false),
		realpath: (path) =>
			files.has(path) || directories.has(path)
				? path
				: (base.realpath?.(path) ?? path),
		getSourceFile: (fileName, languageVersion) => {
			const content = files.get(fileName);
			return content !== undefined
				? ts.createSourceFile(fileName, content, languageVersion, true)
				: base.getSourceFile(fileName, languageVersion);
		},
	};
	const program = ts.createProgram(
		[STORY_FILE, "/host/globals.d.ts"],
		options,
		host,
	);
	const storyFile = program.getSourceFile(STORY_FILE);
	return [
		...program.getSyntacticDiagnostics(storyFile),
		...program.getSemanticDiagnostics(storyFile),
	].map(
		(diagnostic) =>
			`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
	);
}

describe("生成した Story の型検査", () => {
	it("meta / Meta と衝突する export 名でもコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Meta",
						name: "Meta",
						import: { packageName: "./ui/meta", exportName: "Meta" },
						props: {},
						slots: {},
					},
					{
						id: "meta",
						name: "meta",
						import: { packageName: "./ui/m", exportName: "meta" },
						props: {},
						slots: { children: {} },
					},
				],
			}),
		);
		const source = emitCsf(
			{
				id: "n1",
				component: "meta",
				props: {},
				slots: {
					children: [{ id: "n2", component: "Meta", props: {}, slots: {} }],
				},
			},
			registry,
			{ title: "T" },
		);

		expect(
			compile(source, {
				"/host/ui/meta.ts": componentStub(["Meta"]),
				"/host/ui/m.ts": componentStub(["meta"]),
			}),
		).toEqual([]);
	});

	it("HTML エンティティを含む値でもコンパイルでき、生の JSX テキストに残らない", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Card",
						name: "Card",
						import: { packageName: "./ui/card", exportName: "Card" },
						props: { title: { kind: "string" } },
						slots: { children: {} },
					},
				],
			}),
		);
		const source = emitCsf(
			{
				id: "n1",
				component: "Card",
				props: { title: "AT&T &amp; more" },
				slots: {
					children: [
						{
							id: "t1",
							component: "Text",
							props: { text: "5 &lt; 10 &amp; up" },
							slots: {},
						},
					],
				},
			},
			registry,
			{ title: "T" },
		);

		expect(
			compile(source, { "/host/ui/card.ts": componentStub(["Card"]) }),
		).toEqual([]);
		// Both values sit in expression containers, where no entity decoding happens.
		expect(source).toContain('{"5 &lt; 10 &amp; up"}');
		expect(source).toContain('title={"AT&T &amp; more"}');
	});

	it("fixtures と fixture を参照する binding を含む Story がコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Table",
						name: "Table",
						import: { packageName: "./ui/table", exportName: "Table" },
						props: { rows: { kind: "json", editable: false } },
						slots: {},
					},
				],
			}),
		);
		const source = emitCsf(
			{
				id: "n1",
				component: "Table",
				props: {},
				slots: {},
				bindings: { rows: "customers" },
			},
			registry,
			{
				title: "T",
				fixtures: {
					customers: [{ name: 'Sa"to', note: "a\nb" }],
					pageSize: 20,
				},
			},
		);

		expect(
			compile(source, { "/host/ui/table.ts": componentStub(["Table"]) }),
		).toEqual([]);
		expect(source).toContain("rows={customers}");
	});

	// A fixture const cannot be renamed, so the colliding component import must
	// take the alias — otherwise the file declares the identifier twice.
	it("fixture 名と衝突する export 名があってもコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Card",
						name: "Card",
						import: { packageName: "./ui/card", exportName: "Card" },
						props: {},
						slots: {},
					},
				],
			}),
		);
		const source = emitCsf(
			{ id: "n1", component: "Card", props: {}, slots: {} },
			registry,
			{ title: "T", fixtures: { Card: { label: "x" } } },
		);

		expect(
			compile(source, { "/host/ui/card.ts": componentStub(["Card"]) }),
		).toEqual([]);
		expect(source).toContain('import { Card as Card2 } from "./ui/card";');
	});

	it("Story の export 名と衝突する export 名でもコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Default",
						name: "Default",
						import: { packageName: "./ui/default", exportName: "Default" },
						props: {},
						slots: {},
					},
				],
			}),
		);
		const source = emitCsf(
			{ id: "n1", component: "Default", props: {}, slots: {} },
			registry,
			{ title: "T" },
		);

		expect(
			compile(source, { "/host/ui/default.ts": componentStub(["Default"]) }),
		).toEqual([]);
	});
});
