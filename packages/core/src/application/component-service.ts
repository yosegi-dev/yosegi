import type {
	ComponentManifest,
	ComponentRegistry,
} from "../domain/component-manifest.ts";
import { ComposerError, SERVICE_CODES } from "../domain/errors.ts";
import { didYouMean } from "../domain/suggest.ts";

// A read-only Application Service over the Component Registry.
// CLI / MCP / HTTP all go through here to fetch component information.
export class ComponentService {
	private registry: ComponentRegistry;
	private byId: Map<string, ComponentManifest>;

	constructor(registry: ComponentRegistry) {
		this.registry = registry;
		this.byId = new Map(registry.components.map((c) => [c.id, c]));
	}

	// Replaces the Registry. Used to push a client-assembled Registry at startup
	// so it stays in sync with server-side validation.
	replaceRegistry(registry: ComponentRegistry): void {
		this.registry = registry;
		this.byId = new Map(registry.components.map((c) => [c.id, c]));
	}

	getRegistryVersion(): string {
		return this.registry.version;
	}

	// For operations that need the whole Registry (CSF generation, validation).
	getRegistry(): ComponentRegistry {
		return this.registry;
	}

	listComponents(): ComponentManifest[] {
		return this.registry.components;
	}

	getComponent(id: string): ComponentManifest | null {
		return this.byId.get(id) ?? null;
	}

	// Throws COMPONENT_NOT_FOUND if it doesn't exist. The not-found representation is
	// centralized in the Application layer so every Adapter can handle not-found with the
	// same code — and, since a typo'd id is the common cause, the nearest existing ids
	// ride along as a suggestion so CLI / MCP / HTTP all offer the same candidates.
	requireComponent(id: string): ComponentManifest {
		const component = this.byId.get(id);
		if (!component) {
			throw new ComposerError(
				SERVICE_CODES.COMPONENT_NOT_FOUND,
				`Component "${id}" was not found in the registry.`,
				null,
				{ suggestion: didYouMean(id, this.byId.keys()) ?? null },
			);
		}
		return component;
	}

	// Partial match on name/description plus category filtering. The entry point for browsing components.
	// query accepts either a single term or several — several are OR'd together, so
	// `["pagination", "paginate"]` matches a component against either spelling in one call
	// instead of requiring a round-trip per guess.
	searchComponents(params: {
		query?: string | string[];
		category?: string;
	}): ComponentManifest[] {
		const queries = (
			Array.isArray(params.query)
				? params.query
				: params.query
					? [params.query]
					: []
		)
			.map((term) => term.trim().toLowerCase())
			.filter((term) => term.length > 0);
		return this.registry.components.filter((component) => {
			if (params.category && component.category !== params.category) {
				return false;
			}
			if (queries.length === 0) {
				return true;
			}
			const haystack =
				`${component.id} ${component.name} ${component.description ?? ""}`.toLowerCase();
			return queries.some((query) => haystack.includes(query));
		});
	}

	listCategories(): string[] {
		const categories = new Set<string>();
		for (const component of this.registry.components) {
			if (component.category) {
				categories.add(component.category);
			}
		}
		return [...categories].sort();
	}
}
