import {
	type ComponentRegistry,
	indexRegistry,
} from "../domain/component-manifest.ts";
import { applyOperationsToRoot } from "../domain/operation.ts";
import { expandRepeat } from "../domain/repeat.ts";
import type { ScreenNode, ScreenVariant } from "../domain/screen-definition.ts";
import { planImports, renderImportStatements } from "./csf.ts";
import {
	assertEmittableNames,
	renderFixtures,
	renderJsdoc,
} from "./document.ts";
import { type RenderContext, renderRoot } from "./render.ts";

// Converts a Screen Definition tree into a plain React component file — the
// second emit target, for hosts that have no Storybook to drop a Story into.
// The JSX rendering lives in render.ts; this module owns only the component
// document around it: the import plan, the fixture consts, and the exported
// function components. Everything CSF-specific — meta, meta templates,
// frameworkPackage — has no counterpart here on purpose: this file carries no
// Storybook coordinates because nothing reads them.
//
// The emitted component takes no props. Screen JSON carries no information
// about which values cross a component boundary, so there is nothing to decide
// which mock values should be lifted into parameters — every value stays
// internal and the screen is emitted as one self-contained unit. That is the
// settled position in docs/ROADMAP.md: props lifting waits until Screen JSON
// can express boundaries.

const DEFAULT_COMPONENT_NAME = "Screen";
// The local name the emitted file's own type import declares. A component
// import must never take it, or the file declares the identifier twice.
const COMPONENT_DECLARED_LOCAL_NAMES: readonly string[] = ["ReactElement"];

export type EmitComponentOptions = {
	// The exported function's name. Defaults to "Screen".
	componentName?: string;
	// Converts the Registry's packageName to the host's import specifier. Defaults to the identity function.
	resolveImport?: (packageName: string) => string;
	// Mock data emitted as top-level `const <name> = <JSON>;` declarations,
	// exactly as the CSF target emits them.
	fixtures?: Record<string, unknown>;
	// Screen states emitted as additional `export function <name>()` blocks
	// after the base component, each rendered from the base tree with the
	// variant's operations applied — symmetric with the CSF target's extra
	// Story exports.
	variants?: ScreenVariant[];
};

export function emitComponent(
	root: ScreenNode,
	registry: ComponentRegistry,
	options: EmitComponentOptions = {},
): string {
	const manifests = indexRegistry(registry);
	const componentName = options.componentName ?? DEFAULT_COMPONENT_NAME;
	const fixtures = options.fixtures ?? {};
	const variants = options.variants ?? [];
	assertEmittableNames({
		exportName: componentName,
		exportKind: "component",
		fixtures,
		variants,
		reservedIdentifiers: COMPONENT_DECLARED_LOCAL_NAMES,
	});
	// Same pipeline as emitCsf: repeat expands after validation and before import
	// planning, and a variant's operations apply to the unexpanded base tree.
	const expandedRoot = expandRepeat(root);
	const variantRoots = variants.map((variant) =>
		expandRepeat(applyOperationsToRoot(root, variant.operations)),
	);
	// planImports also reserves the CSF target's own names (meta / Meta /
	// StoryObj). Harmless here — and deliberate, because it keeps the local
	// names, and therefore the JSX, identical across the two targets for the
	// same screen.
	const plan = planImports(
		[expandedRoot, ...variantRoots],
		registry,
		options.resolveImport,
		[
			...COMPONENT_DECLARED_LOCAL_NAMES,
			componentName,
			...variants.map((variant) => variant.name),
			...Object.keys(fixtures),
		],
	);
	const context: RenderContext = {
		manifests,
		localNames: plan.localNames,
		fixtureNames: new Set(Object.keys(fixtures)),
	};

	const lines: string[] = [
		// ReactElement rather than JSX.Element: React 19 removed the global JSX
		// namespace, while the type import resolves the same on every React the
		// hosts run.
		'import type { ReactElement } from "react";',
		...renderImportStatements(plan),
	];
	const fixtureLines = renderFixtures(fixtures);
	if (fixtureLines.length > 0) {
		lines.push("");
		lines.push(...fixtureLines);
	}
	lines.push(
		"",
		...renderComponentExport(componentName, expandedRoot, context),
	);
	variants.forEach((variant, index) => {
		lines.push("");
		if (variant.description !== undefined) {
			lines.push(...renderJsdoc(variant.description));
		}
		lines.push(
			...renderComponentExport(variant.name, variantRoots[index], context),
		);
	});
	return `${lines.join("\n")}\n`;
}

// One `export function <name>()` block. The base component and every variant go
// through the same function so their shape can't drift.
function renderComponentExport(
	name: string,
	root: ScreenNode,
	context: RenderContext,
): string[] {
	return [
		`export function ${name}(): ReactElement {`,
		"\treturn (",
		...renderRoot(root, context).map((line) => `\t\t${line}`),
		"\t);",
		"}",
	];
}
