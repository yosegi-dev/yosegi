import {
	type ComponentManifest,
	isSyntheticManifest,
	type PropDefinition,
	type PropKind,
} from "@yosegi/core";

// Measures how much of a prop's JSDoc has actually been written, and names the spots
// where writing it would be worthwhile.
//
// The Manifest mechanically records a prop's name and type, but things the type can't
// express — default values, the caller's responsibilities, what a json prop actually
// expects — live only in JSDoc. From an agent's perspective, a prop without that is just
// a box with a name on it, leaving no choice but to guess what value to fill in during
// implementation. On the other hand, listing all 1,000+ props does nothing actionable,
// so we narrow it down to a short list ordered by "writing this pays off most".

// Prop kinds whose value can't be written declaratively. json is a box with unknown
// contents; function / reactNode simply have no literal that can be placed in Screen
// JSON to begin with. For these kinds, type checking is no help without a description
// either (a third-party type with an empty interface will accept any garbage value).
const OPAQUE_KINDS: readonly PropKind[] = ["json", "function", "reactNode"];

function isOpaque(prop: PropDefinition): boolean {
	return OPAQUE_KINDS.includes(prop.kind);
}

function isDocumented(prop: PropDefinition): boolean {
	return (prop.description ?? "").trim().length > 0;
}

// Documentation coverage of props. Like stats elsewhere, it holds only what's countable.
export type DocCoverageStats = {
	// Total number of props recorded in the Manifest (excluding synthetic primitives).
	props: number;
	// Number of props that have a description.
	documentedProps: number;
	// Number of props whose value can't be written declaratively.
	opaqueProps: number;
	// Number of props that are both required and opaque yet have no description. The combination that blocks implementation the hardest.
	undocumentedRequiredOpaqueProps: number;
	// Number of components carrying one or more of the above.
	withUndocumentedRequiredOpaqueProps: number;
};

// Order in which these should be written, most urgent first — the further up the list,
// the more an agent is simply blocked from implementing without it.
// required-opaque: a value must always be passed, but there's no telling what to pass.
// optional-opaque: passing one should have an effect, but there's no telling what (so the feature silently does nothing).
// required-literal / optional-literal: a literal can already be written from the type, so documentation here is just supplementary meaning.
export const DOC_PRIORITIES = [
	"required-opaque",
	"optional-opaque",
	"required-literal",
	"optional-literal",
] as const;
export type DocPriority = (typeof DOC_PRIORITIES)[number];

function priorityOf(prop: PropDefinition): DocPriority {
	const required = prop.required === true;
	if (isOpaque(prop)) {
		return required ? "required-opaque" : "optional-opaque";
	}
	return required ? "required-literal" : "optional-literal";
}

// A single entry in --report. The host can just work through these from the top.
export type UndocumentedProp = {
	// Component id (module path#exportName).
	component: string;
	prop: string;
	kind: PropKind;
	priority: DocPriority;
	// Whether the component has a Story. Parts the host signaled as "safe to use" are surfaced first.
	recommended: boolean;
	// The shape read one level deep from the type. A hint toward what should be written for a json prop.
	shape?: {
		type: string;
		fields: string[];
	};
};

export type DocCoverageReport = {
	// Total number of props with no description.
	totalCount: number;
	// Of those, the number that are both required and opaque (priority is required-opaque).
	requiredOpaqueCount: number;
	// Number of entries dropped due to the limit. Absent when 0.
	omitted?: number;
	props: UndocumentedProp[];
};

// Default cap on how many entries --report lists. Listing everything would produce a
// JSON dump of hundreds of entries — a plain dump rather than a "work through from the top" list.
export const DEFAULT_UNDOCUMENTED_LIMIT = 100;

// Synthetic primitives are pseudo-components supplied by Yosegi itself, not something
// the host is expected to write JSDoc for. Exclude them from both the coverage denominator and the to-do list.
function hostComponents(components: ComponentManifest[]): ComponentManifest[] {
	return components.filter((c) => !isSyntheticManifest(c));
}

export function summarizeDocCoverage(
	components: ComponentManifest[],
): DocCoverageStats {
	const stats: DocCoverageStats = {
		props: 0,
		documentedProps: 0,
		opaqueProps: 0,
		undocumentedRequiredOpaqueProps: 0,
		withUndocumentedRequiredOpaqueProps: 0,
	};
	for (const component of hostComponents(components)) {
		let offending = 0;
		for (const prop of Object.values(component.props)) {
			stats.props += 1;
			if (isDocumented(prop)) {
				stats.documentedProps += 1;
			}
			if (!isOpaque(prop)) {
				continue;
			}
			stats.opaqueProps += 1;
			if (!isDocumented(prop) && prop.required === true) {
				offending += 1;
			}
		}
		stats.undocumentedRequiredOpaqueProps += offending;
		if (offending > 0) {
			stats.withUndocumentedRequiredOpaqueProps += 1;
		}
	}
	return stats;
}

function shapeHint(prop: PropDefinition): UndocumentedProp["shape"] {
	const shape = prop.shape;
	if (!shape) {
		return undefined;
	}
	// For a discriminated union, fields only holds what's shared across every branch —
	// variants (branch-specific, pick-exactly-one) round out the rest of the hint.
	const fields = [...shape.fields, ...(shape.variants ?? [])];
	return {
		type: shape.array ? `${shape.type}[]` : shape.type,
		fields: fields.map(
			(field) => `${field.name}${field.optional ? "?" : ""}: ${field.type}`,
		),
	};
}

// Orders props with no description by "writing this pays off most".
//
// priority is the primary sort key; within the same priority, components with a Story
// (parts the host intended to expose) come first. The rest are ordered deterministically
// by id / prop name, so the same input always produces the same report.
export function collectUndocumentedProps(
	components: ComponentManifest[],
	options: { limit?: number } = {},
): DocCoverageReport {
	const limit = options.limit ?? DEFAULT_UNDOCUMENTED_LIMIT;
	const entries: UndocumentedProp[] = [];
	for (const component of hostComponents(components)) {
		const recommended = component.curation?.recommended === true;
		for (const [name, prop] of Object.entries(component.props)) {
			if (isDocumented(prop)) {
				continue;
			}
			entries.push({
				component: component.id,
				prop: name,
				kind: prop.kind,
				priority: priorityOf(prop),
				recommended,
				shape: shapeHint(prop),
			});
		}
	}
	entries.sort((a, b) => {
		const byPriority =
			DOC_PRIORITIES.indexOf(a.priority) - DOC_PRIORITIES.indexOf(b.priority);
		if (byPriority !== 0) {
			return byPriority;
		}
		if (a.recommended !== b.recommended) {
			return a.recommended ? -1 : 1;
		}
		return (
			a.component.localeCompare(b.component) || a.prop.localeCompare(b.prop)
		);
	});
	const requiredOpaqueCount = entries.filter(
		(entry) => entry.priority === "required-opaque",
	).length;
	const omitted = Math.max(entries.length - limit, 0);
	return {
		totalCount: entries.length,
		requiredOpaqueCount,
		...(omitted > 0 ? { omitted } : {}),
		props: entries.slice(0, limit),
	};
}
