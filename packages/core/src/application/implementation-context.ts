import type {
	ComponentManifest,
	ComponentRegistry,
} from "../domain/component-manifest.ts";
import { applyOperationsToRoot } from "../domain/operation.ts";
import type {
	EventDefinition,
	ScreenDefinition,
	ScreenNode,
	ScreenVariant,
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
	// The number of nodes using this on the screen, and their node ids. "The screen"
	// spans the base tree and every variant tree: a variant is another state of the
	// same screen, and the implementation has to cover all of them. A node the
	// variants keep is counted once, so a screen without variants is unaffected.
	usageCount: number;
	nodeIds: string[];
	// The props actually being passed on the screen (prop name -> list of values used).
	// The Manifest's props are "what can be passed"; this is "what is being passed."
	// A value only a variant passes is merged in here too.
	usedProps: Record<string, unknown[]>;
	// The slot names that actually have children placed on the screen.
	usedSlots: string[];
	// The variants whose tree uses this component, in declaration order. Absent when
	// only the base tree does — the variant keys are omitted rather than emitted
	// empty so a screen without variants keeps exactly the output it had.
	variants?: string[];
	// Set when no node in the base tree uses this component: it shows up only in a
	// variant state, so the base Story never renders it. Absent otherwise.
	variantOnly?: true;
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
	// The variant this task comes from. Absent on a base-tree task, which keeps the
	// list byte-identical for a screen that declares no variants.
	variant?: string;
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
	// See BindingTask.variant.
	variant?: string;
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

// A variant is a named diff over the base tree, so repeating its full node list
// would mostly repeat the base's. Only what the base cannot show is carried here:
// the resulting shape as an outline, and the components the state pulls in. The
// diff itself stays readable in `screen.variants[].operations`, and the variant's
// wiring lands in the shared `tasks` list tagged with its name.
export type VariantContext = {
	name: string;
	description: string | null;
	// Indented lines for the applied tree, in the same form as structure.outline.
	outline: string[];
	// Components this state uses that no node in the base tree uses. These are the
	// ones a reader of the base Story alone would never see.
	addedComponents: string[];
};

export type ImplementationContext = {
	screenId: string;
	screenName: string;
	screen: ScreenDefinition;
	// The version of the Registry referenced. A mismatch with the Screen side is a signal to rebuild.
	registryVersion: string;
	// The base tree only. Each variant's shape is under `variants[].outline`.
	structure: ScreenStructure;
	// Every component the screen needs, across the base tree and all variants.
	components: ComponentUsage[];
	// Import statements ready to paste at the top of the implementation file as-is
	// (ascending by specifier / member). Planned over the base and every variant
	// tree together, exactly as emit plans them for the Story file.
	imports: string[];
	// bindings / events flattened into wiring tasks. The base tree's first, then
	// each variant's, tagged with `variant` and limited to what the base does not
	// already state.
	tasks: ImplementationTask[];
	// One entry per declared variant, in declaration order. Absent when the screen
	// declares none.
	variants?: VariantContext[];
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

// A variant's tree, derived once and then reused by imports, usages, tasks and the
// outline. Kept unexpanded (no expandRepeat) for the same reason the base tree is:
// the context reports the Screen JSON's own nodes, with `each` left as a field.
type VariantTree = {
	variant: ScreenVariant;
	root: ScreenNode;
	visited: VisitedNode[];
};

// Applying a variant's operations can fail (an operation targeting a node the base
// no longer has). That throws here rather than being skipped, matching emit: a
// screen whose variant will not apply cannot be generated either, and `screen
// validate` is what reports the failure as VARIANT_OPERATION_FAILED.
function buildVariantTrees(screen: ScreenDefinition): VariantTree[] {
	return (screen.variants ?? []).map((variant) => {
		const root = applyOperationsToRoot(screen.root, variant.operations);
		return { variant, root, visited: visitNodes(root) };
	});
}

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

// The usage under construction. `seenNodeIds` is what keeps a variant from
// inflating the count: variants are diffs, so most of their nodes are the base's
// same nodes under the same ids, and only the props they change are new.
type UsageDraft = {
	usage: ComponentUsage;
	seenNodeIds: Set<string>;
	usedInBase: boolean;
	usedInVariants: string[];
};

function recordUsage(
	draft: UsageDraft,
	node: ScreenNode,
	variant: string | null,
): void {
	if (variant === null) {
		draft.usedInBase = true;
	} else if (!draft.usedInVariants.includes(variant)) {
		draft.usedInVariants.push(variant);
	}
	if (!draft.seenNodeIds.has(node.id)) {
		draft.seenNodeIds.add(node.id);
		draft.usage.usageCount += 1;
		draft.usage.nodeIds.push(node.id);
	}
	for (const [propName, value] of Object.entries(node.props)) {
		const values = draft.usage.usedProps[propName] ?? [];
		draft.usage.usedProps[propName] = values;
		mergePropValue(values, value);
	}
	for (const slotName of filledSlots(node)) {
		if (!draft.usage.usedSlots.includes(slotName)) {
			draft.usage.usedSlots.push(slotName);
		}
	}
}

function buildUsages(
	visited: VisitedNode[],
	variantTrees: VariantTree[],
	registry: ComponentRegistry,
	manifests: Map<string, ComponentManifest>,
	importStatements: Map<string, string>,
): ComponentUsage[] {
	const drafts = new Map<string, UsageDraft>();
	// The base first, so its nodes lead nodeIds and the Registry ordering below sees
	// the base's components before any a variant adds.
	const trees: { nodes: VisitedNode[]; variant: string | null }[] = [
		{ nodes: visited, variant: null },
		...variantTrees.map((tree) => ({
			nodes: tree.visited,
			variant: tree.variant.name,
		})),
	];
	for (const tree of trees) {
		for (const { node } of tree.nodes) {
			let draft = drafts.get(node.component);
			if (!draft) {
				const manifest = manifests.get(node.component) ?? null;
				const synthetic = isSynthetic(node.component, manifest);
				draft = {
					usage: {
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
					},
					seenNodeIds: new Set<string>(),
					usedInBase: false,
					usedInVariants: [],
				};
				drafts.set(node.component, draft);
			}
			recordUsage(draft, node, tree.variant);
		}
	}

	const usages = [...drafts.values()].map(
		({ usage, usedInBase, usedInVariants }) => {
			if (usedInVariants.length > 0) {
				usage.variants = usedInVariants;
			}
			if (!usedInBase) {
				usage.variantOnly = true;
			}
			return usage;
		},
	);
	// Align to the Registry's ordering (ascending by id), pushing anything not in the Registry to the end.
	const order = new Map(registry.components.map((c, index) => [c.id, index]));
	const fallback = registry.components.length;
	return usages.sort(
		(a, b) => (order.get(a.id) ?? fallback) - (order.get(b.id) ?? fallback),
	);
}

// Component id -> the statement that imports just that one component. Kept separate from
// the import statements grouped by specifier so each can be pasted into the implementation
// file one line at a time. Local names (as-aliasing) follow the shared plan.
//
// Planned over every tree at once — the base and each variant's — because the Story
// emit plans them the same way: one file, one set of imports, one local name per
// component. A component only a variant reaches still has to be imported.
function buildPerComponentImports(
	roots: readonly ScreenNode[],
	registry: ComponentRegistry,
	resolveImport?: (packageName: string) => string,
): { statements: string[]; byComponent: Map<string, string> } {
	const plan = planImports(roots, registry, resolveImport);
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

function treeTasks(visited: VisitedNode[]): ImplementationTask[] {
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

// What identifies a task as the same piece of wiring: the node, the component
// rendered there, the prop or event name, and the value being wired. `path` is left
// out on purpose — a variant that only moves a node has not changed the work, so
// re-listing the task under the variant would be noise.
function taskKey(task: ImplementationTask): string {
	const fields =
		task.kind === "binding"
			? [task.kind, task.nodeId, task.component, task.prop, task.expression]
			: [
					task.kind,
					task.nodeId,
					task.component,
					task.event,
					task.action,
					JSON.stringify(task.arguments),
				];
	return fields.join(" ");
}

// The base's tasks, then whatever each variant adds on top of them. A variant that
// leaves the wiring alone contributes nothing, so the list stays as short as the
// screen actually requires.
function buildTasks(
	visited: VisitedNode[],
	variantTrees: VariantTree[],
): ImplementationTask[] {
	const tasks = treeTasks(visited);
	const seen = new Set(tasks.map(taskKey));
	for (const tree of variantTrees) {
		for (const task of treeTasks(tree.visited)) {
			const key = taskKey(task);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			tasks.push({ ...task, variant: tree.variant.name });
		}
	}
	return tasks;
}

function toVariantContext(
	tree: VariantTree,
	baseComponents: ReadonlySet<string>,
): VariantContext {
	const added: string[] = [];
	for (const { node } of tree.visited) {
		if (
			!baseComponents.has(node.component) &&
			!added.includes(node.component)
		) {
			added.push(node.component);
		}
	}
	return {
		name: tree.variant.name,
		description: tree.variant.description ?? null,
		outline: tree.visited.map(toStructureNode).map(toOutlineLine),
		addedComponents: added,
	};
}

export function buildImplementationContext(
	screen: ScreenDefinition,
	components: ComponentService,
	options: ImplementationContextOptions = {},
): ImplementationContext {
	const registry = components.getRegistry();
	const manifests = new Map(registry.components.map((c) => [c.id, c]));
	const visited = visitNodes(screen.root);
	const variantTrees = buildVariantTrees(screen);
	const imports = buildPerComponentImports(
		[screen.root, ...variantTrees.map((tree) => tree.root)],
		registry,
		options.resolveImport,
	);
	const baseComponents = new Set(visited.map(({ node }) => node.component));

	return {
		screenId: screen.id,
		screenName: screen.name,
		screen,
		registryVersion: registry.version,
		structure: buildStructure(visited),
		// Spread rather than assigned so a screen without variants keeps the key out
		// of the JSON entirely, instead of gaining an empty array.
		...(variantTrees.length > 0
			? {
					variants: variantTrees.map((tree) =>
						toVariantContext(tree, baseComponents),
					),
				}
			: {}),
		components: buildUsages(
			visited,
			variantTrees,
			registry,
			manifests,
			imports.byComponent,
		),
		imports: imports.statements,
		tasks: buildTasks(visited, variantTrees),
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
