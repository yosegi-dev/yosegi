import {
	type ComponentManifest,
	type ComponentRegistry,
	indexRegistry,
	type PropDefinition,
} from "./component-manifest.ts";
import { VALIDATION_CODES, type ValidationCode } from "./errors.ts";
import {
	isEmittableBindingExpression,
	type ScreenDefinition,
	type ScreenNode,
	walkNodes,
} from "./screen-definition.ts";
import { didYouMean } from "./suggest.ts";
import { isSyntheticComponentId, isSyntheticManifest } from "./synthetics.ts";

// A single validation result item. Shared shape for both error and warning.
export type ValidationIssue = {
	nodeId: string | null;
	// Where the node sits in the tree (`$.children[0].children[1]`), the same shape as
	// the implementation context's StructureNode.path. nodeId alone cannot locate a node
	// once ids collide, and an agent editing the JSON navigates by position anyway.
	path?: string;
	code: ValidationCode;
	message: string;
	suggestion?: string;
};

export type ValidationResult = {
	valid: boolean;
	errors: ValidationIssue[];
	warnings: ValidationIssue[];
};

// Kinds whose value shape can't be declared. Since their contents aren't validated,
// null passes through unchecked too — rejecting null here would also reject
// legitimately valid values like `{ a: number } | null`.
const UNCHECKED_PROP_KINDS = new Set(["json", "reactNode", "function"]);

// Prop names emit never writes as JSX attributes: children is a Slot, and key / ref
// are managed by React. A value written under one of these would be silently dropped
// from the generated Story, so the validator rejects it up front. Emit shares this
// set so the two sides can't drift apart.
export const RESERVED_PROP_NAMES = new Set(["children", "key", "ref"]);

// Manifests are plain objects, so a bracket lookup keyed by a screen-supplied name
// still walks the prototype chain — a slot or prop named "toString" would resolve to
// Object.prototype and count as defined. Every name-keyed lookup goes through this guard.
function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

// ScreenNode fields that live next to props, not inside them. Writing them inside
// props passes the schema (props is a free-form record), so the mistake surfaces here
// as UNKNOWN_PROP and deserves a pointed fix rather than a fuzzy-match miss.
const NODE_LEVEL_FIELDS = new Set(["bindings", "events", "when", "each"]);

// Enum options rendered with their type visible ("primary" vs 1 vs true) — the same
// JSON.stringify rendering component inspect uses for options.
function formatEnumOptions(options: readonly unknown[] | undefined): string {
	return (options ?? []).map((option) => JSON.stringify(option)).join(", ");
}

// Whether a prop value is consistent with its definition's kind. Kinds that aren't
// editable (function/reactNode) are not validated.
function isPropValueValid(def: PropDefinition, value: unknown): boolean {
	if (UNCHECKED_PROP_KINDS.has(def.kind)) {
		return true;
	}
	if (value === null) {
		return def.nullable === true;
	}
	switch (def.kind) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "boolean":
			return typeof value === "boolean";
		case "enum":
			return (def.options ?? []).some((option) => option === value);
		default:
			return false;
	}
}

// Validates a parent component's Slot constraints (allowedComponents / maxItems).
function validateSlots(
	node: ScreenNode,
	manifest: ComponentManifest,
	errors: ValidationIssue[],
	warnings: ValidationIssue[],
): void {
	for (const [slotName, children] of Object.entries(node.slots)) {
		const slotDef = ownEntry(manifest.slots, slotName);
		if (!slotDef) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.SLOT_NOT_FOUND,
				message: `Component "${manifest.id}" has no slot "${slotName}".`,
			});
			continue;
		}
		if (slotDef.maxItems !== undefined && children.length > slotDef.maxItems) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.SLOT_MAX_ITEMS_EXCEEDED,
				message: `Slot "${slotName}" allows at most ${slotDef.maxItems} items but has ${children.length}.`,
			});
		}
		if (slotDef.allowedComponents) {
			for (const child of children) {
				if (!slotDef.allowedComponents.includes(child.component)) {
					errors.push({
						nodeId: child.id,
						code: VALIDATION_CODES.SLOT_COMPONENT_NOT_ALLOWED,
						message: `Component "${child.component}" is not allowed in slot "${slotName}" of "${manifest.id}".`,
						suggestion: `Allowed: ${slotDef.allowedComponents.join(", ")}`,
					});
				}
			}
		}
	}
	// A required Slot that's empty or missing is a warning.
	for (const [slotName, slotDef] of Object.entries(manifest.slots)) {
		if (slotDef.required && (node.slots[slotName]?.length ?? 0) === 0) {
			warnings.push({
				nodeId: node.id,
				code: VALIDATION_CODES.MISSING_REQUIRED_SLOT,
				message: `Slot "${slotName}" of "${manifest.id}" is required but empty.`,
			});
		}
	}
}

function validateProps(
	node: ScreenNode,
	manifest: ComponentManifest,
	errors: ValidationIssue[],
	warnings: ValidationIssue[],
): void {
	const boundProps = new Set(Object.keys(node.bindings ?? {}));
	// A binding is a declaration that gets wired into a prop at implementation time,
	// so if the target doesn't exist there's nothing to wire it to. This is the same
	// mistake as writing a value directly (UNKNOWN_PROP), so it's an error too.
	for (const propName of boundProps) {
		if (!ownEntry(manifest.props, propName)) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.UNKNOWN_BINDING_TARGET,
				message: `Component "${manifest.id}" has no prop "${propName}" to bind to.`,
				suggestion: didYouMean(propName, Object.keys(manifest.props)),
			});
		}
	}
	// The Manifest doesn't hold a list of events — a handler only shows up as a
	// function-typed prop. A Registry not built from types has no way to catch this
	// case, so it stays a warning rather than an error.
	for (const eventName of Object.keys(node.events ?? {})) {
		if (!ownEntry(manifest.props, eventName)) {
			warnings.push({
				nodeId: node.id,
				code: VALIDATION_CODES.UNKNOWN_EVENT_TARGET,
				message: `Component "${manifest.id}" has no prop "${eventName}" to attach the event to.`,
				suggestion: didYouMean(eventName, Object.keys(manifest.props)),
			});
		}
	}
	for (const [propName, value] of Object.entries(node.props)) {
		// Checked before the manifest lookup: even when the manifest declares e.g. a
		// children prop, emit still never writes it, so the value is lost either way.
		if (RESERVED_PROP_NAMES.has(propName)) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.RESERVED_PROP,
				message: `Prop "${propName}" of "${manifest.id}" is never written into the Story, so its value would be silently lost.`,
				suggestion:
					propName === "children"
						? `Move the content to "slots": { "children": [...] } — plain text becomes a Text node: { "component": "Text", "props": { "text": "..." } }.`
						: `Remove it. "${propName}" is managed by React and cannot be set from a Screen Definition.`,
			});
			continue;
		}
		const def = ownEntry(manifest.props, propName);
		if (!def) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.UNKNOWN_PROP,
				message: `Component "${manifest.id}" has no prop "${propName}".`,
				// A node-level field written inside props is a frequent mistake, and the
				// fuzzy matcher would never suggest the fix (no prop resembles "bindings"),
				// so it gets its own suggestion instead.
				suggestion: NODE_LEVEL_FIELDS.has(propName)
					? `"${propName}" is not a prop. Move it out of "props" and place it directly on the node: { "id": ..., "component": ..., "props": { ... }, "${propName}": ... }.`
					: didYouMean(propName, Object.keys(manifest.props)),
			});
			continue;
		}
		// Functions can't be represented in the Screen JSON. Writing a handler name as
		// a string would emit it verbatim in the output, e.g.
		// `onPageChange="handlePageChange"`, producing a Story with a string sitting
		// in a function's position. This is a wrong-place-for-the-declaration mistake,
		// so it's an error.
		if (def.kind === "function") {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.FUNCTION_PROP_VALUE,
				message: `Prop "${manifest.id}.${propName}" is a function, so it cannot be given a value in "props".`,
				suggestion: `Declare it on the node instead: "events": { "${propName}": { "action": "..." } }, or "bindings": { "${propName}": "<expression>" } when it comes from an existing handler.`,
			});
			continue;
		}
		// editable=false (a prop whose type couldn't be reduced to string / number /
		// boolean / enum) goes into the generated output with its value shape
		// unvalidated. Writing it is allowed, but there's no guarantee the type
		// matches, so it doesn't pass silently.
		if (def.editable === false) {
			warnings.push({
				nodeId: node.id,
				code: VALIDATION_CODES.NOT_EDITABLE_PROP_VALUE,
				message: `Prop "${manifest.id}.${propName}" is not editable (kind "${def.kind}"), so the value is written into the Story as-is and is not checked against the component's type.`,
				suggestion: `Declare it as "bindings": { "${propName}": "<expression>" } if the value comes from data, or drop it if the Story renders without it.`,
			});
		}
		if (!isPropValueValid(def, value)) {
			// The received value rides along so the fix is decidable from the error alone —
			// without it, "primary" vs primary vs 1 all read the same and the reader can't
			// tell a wrong value from a wrong type.
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.INVALID_PROP_VALUE,
				message: `Value for "${manifest.id}.${propName}" does not match kind "${def.kind}" (received: ${JSON.stringify(value)}).`,
				suggestion:
					def.kind === "enum"
						? `Use one of: ${formatEnumOptions(def.options)}`
						: undefined,
			});
		}
	}
	for (const [propName, def] of Object.entries(manifest.props)) {
		if (!def.required || Object.hasOwn(node.props, propName)) {
			continue;
		}
		// A reserved name can never be satisfied through props (emit drops it), so
		// requiring a value here would contradict RESERVED_PROP. children is
		// expressed through slots instead.
		if (RESERVED_PROP_NAMES.has(propName)) {
			continue;
		}
		validateRequiredProp(node, manifest, propName, def, errors, warnings);
	}
}

// Sorts a required prop with no value by whether it can be filled into the generated
// output from a declaration (bindings / events). This mirrors emit's
// requiredPropExpression check, and only blocks generation when it can't be filled.
function validateRequiredProp(
	node: ScreenNode,
	manifest: ComponentManifest,
	propName: string,
	def: PropDefinition,
	errors: ValidationIssue[],
	warnings: ValidationIssue[],
): void {
	const declared =
		ownEntry(node.bindings ?? {}, propName) !== undefined ||
		ownEntry(node.events ?? {}, propName) !== undefined;
	// Handlers can't be written into props, so if a declaration exists, emit fills it
	// with a no-op function.
	if (def.kind === "function" && declared) {
		return;
	}
	const expression = ownEntry(node.bindings ?? {}, propName);
	if (expression !== undefined && isEmittableBindingExpression(expression)) {
		warnings.push({
			nodeId: node.id,
			code: VALIDATION_CODES.BOUND_REQUIRED_PROP,
			message: `Required prop "${propName}" of "${manifest.id}" only has a binding, so the Story is emitted as \`${propName}={${expression}}\` and will not type-check until "${expression}" exists in it.`,
			suggestion: `Set props.${propName} to a mock value to make the Story render; the binding stays as the implementation intent.`,
		});
		return;
	}
	// The kind (and, for an enum, the options) ride along so supplying the value doesn't
	// require a component inspect round-trip first.
	errors.push({
		nodeId: node.id,
		code: VALIDATION_CODES.MISSING_REQUIRED_PROP,
		message: `Required prop "${propName}" of "${manifest.id}" is not set (kind "${def.kind}").`,
		suggestion:
			expression !== undefined
				? `Binding expression "${expression}" is not a plain identifier path, so it cannot be written into the Story. Set props.${propName} to a mock value and keep the binding as the implementation intent.`
				: def.kind === "enum"
					? `Set it to one of: ${formatEnumOptions(def.options)}`
					: undefined,
	});
}

// Validates the allowedParents / allowedChildren parent-child constraints.
function validateParentChild(
	parent: ScreenNode,
	parentManifest: ComponentManifest,
	child: ScreenNode,
	childManifest: ComponentManifest,
	errors: ValidationIssue[],
): void {
	if (
		childManifest.constraints?.allowedParents &&
		!childManifest.constraints.allowedParents.includes(parent.component)
	) {
		errors.push({
			nodeId: child.id,
			code: VALIDATION_CODES.PARENT_NOT_ALLOWED,
			message: `Component "${child.component}" cannot be placed under "${parent.component}".`,
			suggestion: `Allowed parents: ${childManifest.constraints.allowedParents.join(", ")}`,
		});
	}
	if (
		parentManifest.constraints?.allowedChildren &&
		!parentManifest.constraints.allowedChildren.includes(child.component)
	) {
		errors.push({
			nodeId: child.id,
			code: VALIDATION_CODES.CHILD_NOT_ALLOWED,
			message: `Component "${parent.component}" cannot contain "${child.component}".`,
			suggestion: `Allowed children: ${parentManifest.constraints.allowedChildren.join(", ")}`,
		});
	}
}

// Node -> tree path, keyed by object identity so the location survives duplicated ids.
// The path shape (`$.children[0]`) matches the implementation context's
// StructureNode.path, so both outputs address a node the same way.
function indexNodePaths(root: ScreenNode): Map<ScreenNode, string> {
	const paths = new Map<ScreenNode, string>();
	const visit = (node: ScreenNode, path: string): void => {
		paths.set(node, path);
		for (const [slotName, children] of Object.entries(node.slots)) {
			children.forEach((child, index) => {
				visit(child, `${path}.${slotName}[${index}]`);
			});
		}
	};
	visit(root, "$");
	return paths;
}

// Builds a name -> id index of host components that share a name with a synthetic
// primitive.
//
// `"Text"` always resolves to the synthetic primitive, but if the host also has a
// component called `Text` (e.g. `app/components/typography#Text`), writing the
// short id while intending the host's component produces no error — it just
// silently misses the typography component. This index is kept so validation can
// catch that mix-up.
function indexShadowedSyntheticNames(
	registry: ComponentRegistry,
): Map<string, string[]> {
	const byName = new Map<string, string[]>();
	for (const manifest of registry.components) {
		if (
			isSyntheticManifest(manifest) ||
			!isSyntheticComponentId(manifest.name)
		) {
			continue;
		}
		const ids = byName.get(manifest.name) ?? [];
		ids.push(manifest.id);
		byName.set(manifest.name, ids);
	}
	return byName;
}

// Validates a Screen Definition against a Registry. Call this before saving,
// sharing, or implementing.
export function validateScreen(
	screen: ScreenDefinition,
	registry: ComponentRegistry,
): ValidationResult {
	const errors: ValidationIssue[] = [];
	const warnings: ValidationIssue[] = [];
	const manifests = indexRegistry(registry);

	// Registry version compatibility.
	if (screen.componentRegistryVersion !== registry.version) {
		warnings.push({
			nodeId: null,
			code: VALIDATION_CODES.REGISTRY_VERSION_MISMATCH,
			message: `Screen references registry "${screen.componentRegistryVersion}" but current registry is "${registry.version}".`,
			suggestion:
				"Re-validate against the current registry before implementing.",
		});
	}

	const shadowedSyntheticNames = indexShadowedSyntheticNames(registry);
	const reportedShadowedNames = new Set<string>();
	const nodes = walkNodes(screen.root);
	const nodePaths = indexNodePaths(screen.root);

	// Node ID duplication check. Both colliding paths are named — the id alone can't say
	// which of the two nodes to rename.
	const seenPathById = new Map<string, string>();
	for (const node of nodes) {
		const path = nodePaths.get(node) ?? "$";
		const firstPath = seenPathById.get(node.id);
		if (firstPath !== undefined) {
			errors.push({
				nodeId: node.id,
				path,
				code: VALIDATION_CODES.DUPLICATE_NODE_ID,
				message: `Node id "${node.id}" is used more than once (at ${firstPath} and ${path}).`,
			});
			continue;
		}
		seenPathById.set(node.id, path);
	}

	for (const node of nodes) {
		const manifest = manifests.get(node.component);
		if (!manifest) {
			errors.push({
				nodeId: node.id,
				code: VALIDATION_CODES.COMPONENT_NOT_FOUND,
				message: `Component "${node.component}" is not registered.`,
				suggestion: didYouMean(node.component, manifests.keys()),
			});
			continue;
		}
		// A synthetic primitive is a legitimate thing to use, so this stays a warning
		// rather than an error. `Text` used for labels can appear dozens of times in a
		// single screen, so it's only reported once per name.
		if (isSyntheticManifest(manifest)) {
			const shadowedIds = shadowedSyntheticNames.get(node.component);
			if (shadowedIds && !reportedShadowedNames.has(node.component)) {
				reportedShadowedNames.add(node.component);
				warnings.push({
					nodeId: node.id,
					code: VALIDATION_CODES.SYNTHETIC_NAME_SHADOWED,
					message: `Component "${node.component}" resolves to the synthetic primitive, but the registry also has a host component named "${node.component}".`,
					suggestion: `Write the full id if you meant the host component: ${shadowedIds.join(", ")}`,
				});
			}
		}
		if (manifest.constraints?.deprecated) {
			warnings.push({
				nodeId: node.id,
				code: VALIDATION_CODES.DEPRECATED_COMPONENT,
				message: `Component "${node.component}" is deprecated.`,
			});
		}
		validateProps(node, manifest, errors, warnings);
		validateSlots(node, manifest, errors, warnings);

		for (const children of Object.values(node.slots)) {
			for (const child of children) {
				const childManifest = manifests.get(child.component);
				if (childManifest) {
					validateParentChild(node, manifest, child, childManifest, errors);
				}
			}
		}
	}

	// Issues are pushed with nodeId only (the helpers don't know tree positions), so the
	// path is filled in here from the id. Ambiguity under duplicated ids resolves to the
	// first occurrence; the DUPLICATE_NODE_ID issues above carry their exact paths already.
	const locate = (issue: ValidationIssue): ValidationIssue => {
		if (issue.path !== undefined || issue.nodeId === null) {
			return issue;
		}
		const path = seenPathById.get(issue.nodeId);
		return path === undefined ? issue : { ...issue, path };
	};
	return {
		valid: errors.length === 0,
		errors: errors.map(locate),
		warnings: warnings.map(locate),
	};
}
