import { describe, expect, it } from "bun:test";
import type { ComponentRegistry } from "@yosegi/core";
import { parseComponentRegistry, withSyntheticComponents } from "@yosegi/core";
import { emitComponent } from "@yosegi/core/emit";
import * as ts from "typescript";

// Compiles emitted component files with the real TypeScript checker, mirroring
// story-compile.test.ts for the component target. Syntax checks alone cannot see
// duplicate identifiers — `import { ReactElement }` next to a host export of the
// same name parses fine and only dies in the host's build — so every import
// target is stubbed in-memory and the file must type-check clean.

const COMPONENT_FILE = "/host/screen.tsx";

// A minimal react stand-in with the one name the emitted file imports.
const REACT_STUB = "export type ReactElement = { type?: unknown };";

// The emitted output only ever writes div (Box) and h1 (Heading) as intrinsic
// tags. JSX.Element mirrors the react stub's ReactElement so the emitted
// `(): ReactElement` return type actually checks against the rendered JSX.
const GLOBALS_STUB = [
	"declare global {",
	"\tnamespace JSX {",
	"\t\ttype Element = { type?: unknown };",
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

// Type-checks the component file against in-memory stubs; returns the diagnostics as strings.
function compile(source: string, stubs: Record<string, string> = {}): string[] {
	const files = new Map<string, string>([
		[COMPONENT_FILE, source],
		["/host/globals.d.ts", GLOBALS_STUB],
		[
			"/host/node_modules/react/package.json",
			'{ "name": "react", "main": "index.ts", "types": "index.ts" }',
		],
		["/host/node_modules/react/index.ts", REACT_STUB],
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
		[COMPONENT_FILE, "/host/globals.d.ts"],
		options,
		host,
	);
	const componentFile = program.getSourceFile(COMPONENT_FILE);
	return [
		...program.getSyntacticDiagnostics(componentFile),
		...program.getSemanticDiagnostics(componentFile),
	].map(
		(diagnostic) =>
			`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
	);
}

describe("生成したコンポーネントファイルの型検査", () => {
	it("基本形(合成プリミティブとホストコンポーネント)がコンパイルできる", () => {
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
		const source = emitComponent(
			{
				id: "root",
				component: "Box",
				props: { className: "p-6" },
				slots: {
					children: [
						{
							id: "h",
							component: "Heading",
							props: { text: "Customers" },
							slots: {},
						},
						{
							id: "card",
							component: "Card",
							props: { title: "AT&T &amp; more" },
							slots: {},
						},
					],
				},
			},
			registry,
		);

		expect(
			compile(source, { "/host/ui/card.ts": componentStub(["Card"]) }),
		).toEqual([]);
	});

	it("fixtures と fixture を参照する binding を含むファイルがコンパイルできる", () => {
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
		const source = emitComponent(
			{
				id: "n1",
				component: "Table",
				props: {},
				slots: {},
				bindings: { rows: "customers" },
			},
			registry,
			{ fixtures: { customers: [{ name: 'Sa"to', note: "a\nb" }] } },
		);

		expect(
			compile(source, { "/host/ui/table.ts": componentStub(["Table"]) }),
		).toEqual([]);
		expect(source).toContain("rows={customers}");
	});

	// Variants share one file with the base component; the whole thing — several
	// exports, the JSDoc, the shared fixtures — has to type-check as one module.
	it("variants を含むファイルがコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "Table",
						name: "Table",
						import: { packageName: "./ui/table", exportName: "Table" },
						props: {
							loading: { kind: "boolean" },
							rows: { kind: "json", editable: false },
						},
						slots: {},
					},
				],
			}),
		);
		const source = emitComponent(
			{
				id: "root",
				component: "Box",
				props: {},
				slots: {
					children: [
						{
							id: "table",
							component: "Table",
							props: {},
							slots: {},
							bindings: { rows: "customers" },
						},
					],
				},
			},
			registry,
			{
				fixtures: { customers: [{ name: "Sato" }] },
				variants: [
					{
						name: "Loading",
						description: "Rows are being fetched.",
						operations: [
							{ type: "setProps", nodeId: "table", props: { loading: true } },
						],
					},
					{
						name: "Empty",
						operations: [{ type: "removeNode", nodeId: "table" }],
					},
				],
			},
		);

		expect(
			compile(source, { "/host/ui/table.ts": componentStub(["Table"]) }),
		).toEqual([]);
		expect(source).toContain("export function Loading(): ReactElement {");
		expect(source).toContain("export function Empty(): ReactElement {");
	});

	// The file itself imports the ReactElement type and exports the component
	// name; a host export sharing either name must take the suffixed alias or the
	// module declares the identifier twice.
	it("ReactElement / component 名と衝突する export 名でもコンパイルできる", () => {
		const registry: ComponentRegistry = withSyntheticComponents(
			parseComponentRegistry({
				version: "v1",
				components: [
					{
						id: "ReactElement",
						name: "ReactElement",
						import: { packageName: "./ui/re", exportName: "ReactElement" },
						props: {},
						slots: { children: {} },
					},
					{
						id: "Screen",
						name: "Screen",
						import: { packageName: "./ui/screen", exportName: "Screen" },
						props: {},
						slots: {},
					},
				],
			}),
		);
		const source = emitComponent(
			{
				id: "n1",
				component: "ReactElement",
				props: {},
				slots: {
					children: [{ id: "n2", component: "Screen", props: {}, slots: {} }],
				},
			},
			registry,
		);

		expect(
			compile(source, {
				"/host/ui/re.ts": componentStub(["ReactElement"]),
				"/host/ui/screen.ts": componentStub(["Screen"]),
			}),
		).toEqual([]);
	});
});
