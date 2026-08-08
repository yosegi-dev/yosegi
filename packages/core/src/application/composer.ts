import type { ComponentRegistry } from "../domain/component-manifest.ts";
import { ComponentService } from "./component-service.ts";
import type { ScreenRepository } from "./screen-repository.ts";
import { ScreenService } from "./screen-service.ts";

// The Application-layer facade. All CLI / MCP / HTTP Adapters call the same services
// through this Composer. No Adapter should hold its own independent business logic.
export class Composer {
	readonly components: ComponentService;
	readonly screens: ScreenService;

	constructor(registry: ComponentRegistry, repository: ScreenRepository) {
		this.components = new ComponentService(registry);
		this.screens = new ScreenService(repository, this.components);
	}
}

export function createComposer(
	registry: ComponentRegistry,
	repository: ScreenRepository,
): Composer {
	return new Composer(registry, repository);
}
