import type {
	ComponentManifest,
	ComponentRegistry,
} from "../domain/component-manifest.ts";
import type {
	EventDefinition,
	ScreenDefinition,
	ScreenNode,
} from "../domain/screen-definition.ts";
import {
	isSyntheticComponentId,
	isSyntheticManifest,
} from "../domain/synthetics.ts";
import {
	planImports,
	renderImportStatement,
	renderImportStatements,
} from "../emit/csf.ts";
import type { ComponentService } from "./component-service.ts";

// The implementation context for coding agents. Bundles everything needed to turn a
// Story (mock) into a real page into a single JSON. The Screen Definition itself only
// states "what was assembled," so this expands that into "how to transcribe it"
// (import statements, props used, slot structure) and "what to wire up" (bindings / events).
//
// The Composer holds no concrete domain logic code, only a declaration of intent (the
// implementation is made concrete locally).

// A node's position from the root. `$` is the root, followed by `<slot>[<index>]` segments.
const ROOT_PATH = "$";
const OUTLINE_INDENT = "  ";

export type ComponentUsage = {
	id: string;
	name: string;
	// A synthetic primitive (Text / Box / Heading). Has no import and expands to plain JSX.
	synthetic: boolean;
	// An id not in the Registry. Needs resolving before implementation (a Story can't be generated either).
	unregistered: boolean;
	// The import statement, ready to paste as-is. null for synthetic primitives and unregistered ones.
	importStatement: string | null;
	// The number of nodes using this on the screen, and their node ids.
	usageCount: number;
	nodeIds: string[];
	// The props actually being passed on the screen (prop name -> list of values used).
	// The Manifest's props are "what can be passed"; this is "what is being passed."
	usedProps: Record<string, unknown[]>;
	// The slot names that actually have children placed on the screen.
	usedSlots: string[];
	// The definition taken from the type. This is the source of truth for props / slots. null if unregistered.
	manifest: ComponentManifest | null;
};

// bindings / events are declarative intent and won't work until the implementation side
// makes them concrete. Passed as a flat task list of "which node wires up what."
export type BindingTask = {
	kind: "binding";
	nodeId: string;
	component: string;
	path: string;
	// The prop name being wired to.
	prop: string;
	// The data expression (the declaration held by the Screen Definition). Reinterpret into the host's implementation.
	expression: string;
};

export type EventTask = {
	kind: "event";
	nodeId: string;
	component: string;
	path: string;
	// The event name being wired to (a prop name).
	event: string;
	action: string;
	arguments: Record<string, unknown> | null;
};

export type ImplementationTask = BindingTask | EventTask;

export type StructureNode = {
	nodeId: string;
	component: string;
	// The slot name as seen from the parent. null for the root.
	slot: string | null;
	path: string;
	depth: number;
	// The prop names that have a value specified.
	props: string[];
	// The slot names that have children placed.
	slots: string[];
	bindings: string[];
	events: string[];
	when: string | null;
	each: string | null;
};

export type ScreenStructure = {
	nodeCount: number;
	// The number of distinct component types used.
	componentCount: number;
	// The maximum depth, with the root as depth 0.
	depth: number;
	// A flat, depth-first-ordered list.
	nodes: StructureNode[];
	// Indented lines for grasping the structure at a glance.
	outline: string[];
};

export type ImplementationContext = {
	screenId: string;
	screenName: string;
	screen: ScreenDefinition;
	// The version of the Registry referenced. A mismatch with the Screen side is a signal to rebuild.
	registryVersion: string;
	structure: ScreenStructure;
	components: ComponentUsage[];
	// Import statements ready to paste at the top of the implementation file as-is (ascending by specifier / member).
	imports: string[];
	// bindings / events flattened into wiring tasks.
	tasks: ImplementationTask[];
	target: {
		route: string | null;
		preferredPath: string | null;
	};
	implementation: {
		// Framework / routing are host-dependent. The default is neutral (null = unspecified).
		framework: string | null;
		routing: string | null;
		allowRawHtml: boolean;
		allowCustomCss: boolean;
	};
	requirements: string[];
};

export type ImplementationContextOptions = {
	target?: { route?: string; preferredPath?: string };
	implementation?: Partial<ImplementationContext["implementation"]>;
	requirements?: string[];
	// Maps the Registry's packageName to the host's import specifier (same transform as emit).
	resolveImport?: (packageName: string) => string;
};

// The default implementation constraints. Framework/routing are host-dependent, so they're
// neutral (null), and the host overrides them via options.implementation. Disallowing
// arbitrary code is a shared safety default.
const DEFAULT_IMPLEMENTATION: ImplementationContext["implementation"] = {
	framework: null,
	routing: null,
	allowRawHtml: false,
	allowCustomCss: false,
};

// General-purpose guidelines for agents (host-independent).
const DEFAULT_REQUIREMENTS = [
	"Do not change the components or props specified in the Screen Definition.",
	"Make bindings and events concrete by following the host's existing implementation (API client, state management).",
	"Follow the host's naming and testing conventions, then run type checking, lint, and the related tests.",
];

type VisitedNode = {
	node: ScreenNode;
	slot: string | null;
	path: string;
	depth: number;
};

// Starting from the root, enumerate each node depth-first, attaching a path and depth.
function visitNodes(root: ScreenNode): VisitedNode[] {
	const result: VisitedNode[] = [];
	const visit = (
		node: ScreenNode,
		slot: string | null,
		path: string,
		depth: number,
	): void => {
		result.push({ node, slot, path, depth });
		for (const [slotName, children] of Object.entries(node.slots)) {
			children.forEach((child, index) => {
				visit(child, slotName, `${path}.${slotName}[${index}]`, depth + 1);
			});
		}
	};
	visit(root, null, ROOT_PATH, 0);
	return result;
}

// Returns only slots with one or more children placed (slots with an empty array don't appear in the structure).
function filledSlots(node: ScreenNode): string[] {
	return Object.entries(node.slots)
		.filter(([, children]) => children.length > 0)
		.map(([slotName]) => slotName);
}

function toStructureNode({
	node,
	slot,
	path,
	depth,
}: VisitedNode): StructureNode {
	return {
		nodeId: node.id,
		component: node.component,
		slot,
		path,
		depth,
		props: Object.keys(node.props),
		slots: filledSlots(node),
		bindings: Object.keys(node.bindings ?? {}),
		events: Object.keys(node.events ?? {}),
		when: node.when ?? null,
		each: node.each ?? null,
	};
}

// A single line like `body: Table #node-table props=loading bindings=rows,loading`.
// Lets you grasp the screen's skeleton and wiring points without reading through the JSON.
function toOutlineLine(structure: StructureNode): string {
	const parts = [structure.component, `#${structure.nodeId}`];
	if (structure.props.length > 0) {
		parts.push(`props=${structure.props.join(",")}`);
	}
	if (structure.bindings.length > 0) {
		parts.push(`bindings=${structure.bindings.join(",")}`);
	}
	if (structure.events.length > 0) {
		parts.push(`events=${structure.events.join(",")}`);
	}
	const label = structure.slot === null ? "" : `${structure.slot}: `;
	return `${OUTLINE_INDENT.repeat(structure.depth)}${label}${parts.join(" ")}`;
}

function buildStructure(visited: VisitedNode[]): ScreenStructure {
	const nodes = visited.map(toStructureNode);
	return {
		nodeCount: nodes.length,
		componentCount: new Set(nodes.map((n) => n.component)).size,
		depth: nodes.reduce((max, n) => Math.max(max, n.depth), 0),
		nodes,
		outline: nodes.map(toOutlineLine),
	};
}

// Listing the same value repeatedly isn't useful for implementation, so values are deduplicated by their JSON representation.
function mergePropValue(values: unknown[], value: unknown): void {
	const serialized = JSON.stringify(value) ?? "undefined";
	if (
		!values.some(
			(existing) => (JSON.stringify(existing) ?? "undefined") === serialized,
		)
	) {
		values.push(value);
	}
}

function isSynthetic(
	componentId: string,
	manifest: ComponentManifest | null,
): boolean {
	return manifest
		? isSyntheticManifest(manifest)
		: isSyntheticComponentId(componentId);
}

function buildUsages(
	visited: VisitedNode[],
	registry: ComponentRegistry,
	manifests: Map<string, ComponentManifest>,
	importStatements: Map<string, string>,
): ComponentUsage[] {
	const usages = new Map<string, ComponentUsage>();
	for (const { node } of visited) {
		const manifest = manifests.get(node.component) ?? null;
		let usage = usages.get(node.component);
		if (!usage) {
			const synthetic = isSynthetic(node.component, manifest);
			usage = {
				id: node.component,
				name: manifest?.name ?? node.component,
				synthetic,
				unregistered: manifest === null && !synthetic,
				importStatement: importStatements.get(node.component) ?? null,
				usageCount: 0,
				nodeIds: [],
				usedProps: {},
				usedSlots: [],
				manifest,
			};
			usages.set(node.component, usage);
		}
		usage.usageCount += 1;
		usage.nodeIds.push(node.id);
		for (const [propName, value] of Object.entries(node.props)) {
			const values = usage.usedProps[propName] ?? [];
			usage.usedProps[propName] = values;
			mergePropValue(values, value);
		}
		for (const slotName of filledSlots(node)) {
			if (!usage.usedSlots.includes(slotName)) {
				usage.usedSlots.push(slotName);
			}
		}
	}
	// Align to the Registry's ordering (ascending by id), pushing anything not in the Registry to the end.
	const order = new Map(registry.components.map((c, index) => [c.id, index]));
	const fallback = registry.components.length;
	return [...usages.values()].sort(
		(a, b) => (order.get(a.id) ?? fallback) - (order.get(b.id) ?? fallback),
	);
}

// Component id -> the statement that imports just that one component. Kept separate from
// the import statements grouped by specifier so each can be pasted into the implementation
// file one line at a time. Local names (as-aliasing) follow the shared plan.
function buildPerComponentImports(
	root: ScreenNode,
	registry: ComponentRegistry,
	resolveImport?: (packageName: string) => string,
): { statements: string[]; byComponent: Map<string, string> } {
	const plan = planImports(root, registry, resolveImport);
	// Local names are unique across the whole plan, so the specifier and export name can be looked back up from them.
	const byLocalName = new Map<string, string>();
	for (const [specifier, bindings] of plan.specifiers) {
		for (const binding of bindings) {
			byLocalName.set(
				binding.localName,
				renderImportStatement(specifier, [binding]),
			);
		}
	}

	const byComponent = new Map<string, string>();
	for (const [componentId, localName] of plan.localNames) {
		const statement = byLocalName.get(localName);
		if (statement) {
			byComponent.set(componentId, statement);
		}
	}
	return { statements: renderImportStatements(plan), byComponent };
}

function toEventTask(
	visited: VisitedNode,
	event: string,
	definition: EventDefinition,
): EventTask {
	return {
		kind: "event",
		nodeId: visited.node.id,
		component: visited.node.component,
		path: visited.path,
		event,
		action: definition.action,
		arguments: definition.arguments ?? null,
	};
}

function buildTasks(visited: VisitedNode[]): ImplementationTask[] {
	const tasks: ImplementationTask[] = [];
	for (const entry of visited) {
		for (const [prop, expression] of Object.entries(
			entry.node.bindings ?? {},
		)) {
			tasks.push({
				kind: "binding",
				nodeId: entry.node.id,
				component: entry.node.component,
				path: entry.path,
				prop,
				expression,
			});
		}
		for (const [event, definition] of Object.entries(entry.node.events ?? {})) {
			tasks.push(toEventTask(entry, event, definition));
		}
	}
	return tasks;
}

export function buildImplementationContext(
	screen: ScreenDefinition,
	components: ComponentService,
	options: ImplementationContextOptions = {},
): ImplementationContext {
	const registry = components.getRegistry();
	const manifests = new Map(registry.components.map((c) => [c.id, c]));
	const visited = visitNodes(screen.root);
	const imports = buildPerComponentImports(
		screen.root,
		registry,
		options.resolveImport,
	);

	return {
		screenId: screen.id,
		screenName: screen.name,
		screen,
		registryVersion: registry.version,
		structure: buildStructure(visited),
		components: buildUsages(visited, registry, manifests, imports.byComponent),
		imports: imports.statements,
		tasks: buildTasks(visited),
		target: {
			route: options.target?.route ?? null,
			preferredPath: options.target?.preferredPath ?? null,
		},
		implementation: {
			...DEFAULT_IMPLEMENTATION,
			...options.implementation,
		},
		requirements: options.requirements ?? DEFAULT_REQUIREMENTS,
	};
}
