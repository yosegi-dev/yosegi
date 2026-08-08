import {
	ComposerError,
	RevisionConflictError,
	SERVICE_CODES,
} from "../domain/errors.ts";
import { applyOperations, type ScreenOperation } from "../domain/operation.ts";
import {
	parseScreenDefinition,
	SCHEMA_VERSION,
	type ScreenDefinition,
	type ScreenNode,
} from "../domain/screen-definition.ts";
import { type ValidationResult, validateScreen } from "../domain/validator.ts";
import {
	type ActorContext,
	hasPermission,
	type Permission,
	systemActor,
} from "./actor.ts";
import type { ComponentService } from "./component-service.ts";
import type { ScreenRepository, ScreenSummary } from "./screen-repository.ts";

// Communicates that a save was rejected due to a validation error, including the validation result.
export class ValidationFailedError extends ComposerError {
	readonly result: ValidationResult;
	constructor(result: ValidationResult) {
		super(
			SERVICE_CODES.VALIDATION_FAILED,
			`Screen validation failed with ${result.errors.length} error(s).`,
		);
		this.name = "ValidationFailedError";
		this.result = result;
	}
}

export type CreateScreenInput = {
	id: string;
	name: string;
	root: ScreenNode;
	status?: ScreenDefinition["status"];
};

export type UpdateResult = {
	screen: ScreenDefinition;
	validation: ValidationResult;
};

// The Application Service responsible for creating, updating, deleting, and applying
// Operations to Screen Definitions. Handles Revision-based optimistic locking, validation,
// and authorization centrally here.
export class ScreenService {
	constructor(
		private readonly repository: ScreenRepository,
		private readonly components: ComponentService,
	) {}

	private require(actor: ActorContext, permission: Permission): void {
		if (!hasPermission(actor, permission)) {
			throw new ComposerError(
				SERVICE_CODES.FORBIDDEN,
				`Actor "${actor.id}" lacks permission "${permission}".`,
			);
		}
	}

	private async load(id: string): Promise<ScreenDefinition> {
		const screen = await this.repository.get(id);
		if (!screen) {
			throw new ComposerError(
				SERVICE_CODES.SCREEN_NOT_FOUND,
				`Screen "${id}" was not found.`,
			);
		}
		return screen;
	}

	// Pre-save validation. Throws ValidationFailedError if there are errors (warnings are allowed).
	private validateOrThrow(screen: ScreenDefinition): ValidationResult {
		const result = validateScreen(screen, {
			version: this.components.getRegistryVersion(),
			components: this.components.listComponents(),
		});
		if (!result.valid) {
			throw new ValidationFailedError(result);
		}
		return result;
	}

	async listScreens(): Promise<ScreenSummary[]> {
		return this.repository.list();
	}

	async getScreen(id: string): Promise<ScreenDefinition> {
		return this.load(id);
	}

	async createScreen(
		input: CreateScreenInput,
		actor: ActorContext = systemActor(),
	): Promise<UpdateResult> {
		this.require(actor, "screens:create");
		const screen = parseScreenDefinition({
			schemaVersion: SCHEMA_VERSION,
			id: input.id,
			name: input.name,
			status: input.status ?? "draft",
			componentRegistryVersion: this.components.getRegistryVersion(),
			revision: 1,
			root: input.root,
		});
		const validation = this.validateOrThrow(screen);
		const created = await this.repository.create(screen);
		return { screen: created, validation };
	}

	// Replaces the entire screen (optimistic locking). Agents cannot modify published screens.
	async updateScreen(
		id: string,
		next: ScreenDefinition,
		baseRevision: number,
		actor: ActorContext = systemActor(),
	): Promise<UpdateResult> {
		this.require(actor, "screens:update");
		const current = await this.load(id);
		this.assertNotAgentOnPublished(current, actor);
		this.assertRevision(current, baseRevision);
		this.assertPublishPermission(current, next, actor);

		const updated = parseScreenDefinition({
			...next,
			id,
			revision: current.revision + 1,
			// Don't trust the client-supplied value; re-stamp the current Registry Version used
			// for validation server-side (kept consistent with createScreen / applyOperations).
			componentRegistryVersion: this.components.getRegistryVersion(),
		});
		const validation = this.validateOrThrow(updated);
		// Pass baseRevision as the CAS expected value to detect concurrent updates between load and save.
		const saved = await this.repository.save(updated, baseRevision);
		return { screen: saved, validation };
	}

	// Diff-based updates via Operation (the recommended path).
	async applyOperations(
		id: string,
		operations: ScreenOperation[],
		baseRevision: number,
		actor: ActorContext = systemActor(),
	): Promise<UpdateResult> {
		this.require(actor, "screens:update");
		const current = await this.load(id);
		this.assertNotAgentOnPublished(current, actor);
		this.assertRevision(current, baseRevision);

		const applied = applyOperations(current, operations);
		applied.revision = current.revision + 1;
		// Re-stamp the current Registry Version used for validation (kept consistent with
		// updateScreen, so the old stored version isn't persisted as-is).
		applied.componentRegistryVersion = this.components.getRegistryVersion();
		const validation = this.validateOrThrow(applied);
		// Pass baseRevision as the CAS expected value to detect concurrent updates between load and save.
		const saved = await this.repository.save(applied, baseRevision);
		return { screen: saved, validation };
	}

	async duplicateScreen(
		id: string,
		newId: string,
		newName: string,
		actor: ActorContext = systemActor(),
	): Promise<UpdateResult> {
		this.require(actor, "screens:create");
		const source = await this.load(id);
		const copy = parseScreenDefinition({
			...source,
			id: newId,
			name: newName,
			status: "draft",
			revision: 1,
			// Same as the other write paths: re-stamp the current Registry Version used for validation.
			componentRegistryVersion: this.components.getRegistryVersion(),
		});
		const validation = this.validateOrThrow(copy);
		const created = await this.repository.create(copy);
		return { screen: created, validation };
	}

	async deleteScreen(
		id: string,
		actor: ActorContext = systemActor(),
	): Promise<void> {
		this.require(actor, "screens:delete");
		await this.load(id);
		await this.repository.delete(id);
	}

	// Validates against the current Registry (does not save).
	async validate(id: string): Promise<ValidationResult> {
		const screen = await this.load(id);
		return validateScreen(screen, {
			version: this.components.getRegistryVersion(),
			components: this.components.listComponents(),
		});
	}

	private assertRevision(
		current: ScreenDefinition,
		baseRevision: number,
	): void {
		if (current.revision !== baseRevision) {
			throw new RevisionConflictError(current.revision, baseRevision);
		}
	}

	private assertNotAgentOnPublished(
		current: ScreenDefinition,
		actor: ActorContext,
	): void {
		if (actor.isAgent && current.status === "published") {
			throw new ComposerError(
				SERVICE_CODES.PUBLISHED_SCREEN_LOCKED,
				"Agents cannot modify a published screen. Duplicate it as a draft first.",
			);
		}
	}

	private assertPublishPermission(
		current: ScreenDefinition,
		next: ScreenDefinition,
		actor: ActorContext,
	): void {
		const isPublishing =
			current.status !== "published" && next.status === "published";
		if (isPublishing && !hasPermission(actor, "screens:publish")) {
			throw new ComposerError(
				SERVICE_CODES.FORBIDDEN,
				`Actor "${actor.id}" lacks permission "screens:publish".`,
			);
		}
	}
}
