import {
	isJsIdentifier,
	type ScreenVariant,
} from "../domain/screen-definition.ts";

// Document-level helpers shared by the emit targets (the CSF module in csf.ts and
// the component module in component.ts). Both targets wrap the same rendered JSX
// in a different document shape, but the parts below — fixture consts, JSDoc
// escaping, and the export/fixture/variant name checks — must not drift between
// them, so they live here instead of being duplicated per target.

// Reduces the fixtures to `const <name> = <JSON>;` lines. Values are always
// written through JSON.stringify — the standing policy that an externally
// supplied string never lands in a code position — and the tab indentation of a
// multi-line value matches the rest of the output.
export function renderFixtures(fixtures: Record<string, unknown>): string[] {
	return Object.entries(fixtures).flatMap(([name, value]) => {
		const serialized = JSON.stringify(value, null, "\t");
		// undefined / functions have no JSON form. A schema-parsed screen never
		// carries them, so this only guards direct API callers.
		if (serialized === undefined) {
			throw new Error(`Fixture "${name}" has no JSON representation.`);
		}
		return `const ${name} = ${serialized};`.split("\n");
	});
}

// A description as a JSDoc directly above an export. `*/` inside the text would
// close the comment and spill the rest into a code position, so it is defused
// the same way intent comments are.
export function renderJsdoc(description: string): string[] {
	const safe = description.replaceAll("*/", "*\\/");
	const bodyLines = safe.split("\n");
	if (bodyLines.length === 1) {
		return [`/** ${bodyLines[0]} */`];
	}
	return ["/**", ...bodyLines.map((line) => ` * ${line}`), " */"];
}

export type EmitNameOptions = {
	// The base export's name (the Story export, or the component function).
	exportName: string;
	// How error messages name the export: "Story" for CSF, "component" for the
	// component target. Interpolated mid-sentence, so only "Story" is capitalised.
	exportKind: string;
	fixtures: Record<string, unknown>;
	variants: ScreenVariant[];
	// Identifiers the document form itself always declares (type imports,
	// `const meta`, ...). A fixture or variant may not take one of these names.
	reservedIdentifiers: readonly string[];
};

function capitalize(word: string): string {
	return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

// The export name, the fixture consts, and the variant exports all declare their
// identifier verbatim in the generated file, with no aliasing escape hatch, so an
// unwritable or colliding name has to be rejected before anything is emitted.
// The fixtures / variants schemas reject most of these before a screen is ever
// saved; this is the second safety net for direct API callers, and the only net
// for collisions with the export name, which is chosen per emit rather than
// stored on the screen.
export function assertEmittableNames(options: EmitNameOptions): void {
	const { exportName, exportKind, fixtures, variants, reservedIdentifiers } =
		options;
	// The export name becomes an identifier in the generated output. Since
	// arbitrary strings can arrive from the CLI / MCP, only accept a form that's
	// writable as an identifier (otherwise arbitrary code could get mixed into
	// the generated output).
	if (!isJsIdentifier(exportName)) {
		throw new Error(
			`${capitalize(exportKind)} name "${exportName}" is not a valid JavaScript identifier. Use letters, digits, "_" or "$", do not start with a digit, and avoid reserved words.`,
		);
	}
	for (const name of Object.keys(fixtures)) {
		if (!isJsIdentifier(name) || reservedIdentifiers.includes(name)) {
			throw new Error(
				`Fixture name "${name}" is not writable as a top-level const (it must be a JavaScript identifier other than ${reservedIdentifiers.join(" / ")}).`,
			);
		}
		if (name === exportName) {
			throw new Error(
				`Fixture name "${name}" collides with the ${exportKind} export name. Rename the fixture or pass a different ${exportKind.toLowerCase()} name.`,
			);
		}
	}
	const seenVariantNames = new Set<string>();
	for (const variant of variants) {
		const name = variant.name;
		if (!isJsIdentifier(name) || reservedIdentifiers.includes(name)) {
			throw new Error(
				`Variant name "${name}" is not writable as a ${exportKind} export (it must be a JavaScript identifier other than ${reservedIdentifiers.join(" / ")}).`,
			);
		}
		if (name === exportName) {
			throw new Error(
				`Variant name "${name}" collides with the ${exportKind} export name. Rename the variant or pass a different ${exportKind.toLowerCase()} name.`,
			);
		}
		if (Object.hasOwn(fixtures, name)) {
			throw new Error(
				`Variant name "${name}" collides with a fixture name. Rename one of them.`,
			);
		}
		if (seenVariantNames.has(name)) {
			throw new Error(
				`Variant name "${name}" is used more than once. Each variant becomes its own ${exportKind} export, so names must be unique.`,
			);
		}
		seenVariantNames.add(name);
	}
}
