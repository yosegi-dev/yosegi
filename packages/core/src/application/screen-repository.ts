import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ZodError } from "zod";
import {
	ComposerError,
	RevisionConflictError,
	SERVICE_CODES,
} from "../domain/errors.ts";
import {
	parseScreenDefinition,
	type ScreenDefinition,
} from "../domain/screen-definition.ts";

export type ScreenSummary = {
	id: string;
	name: string;
	status: ScreenDefinition["status"];
	revision: number;
	updatedAt: string | null;
};

// An entry under the storage location that list() could not turn into a summary. One
// broken file must not take the whole listing down, but silently dropping it would
// hide the problem — the reason travels back with the summaries instead.
export type ScreenListWarning = {
	// The storage entry, e.g. a file name for the file-backed repository.
	file: string;
	message: string;
};

export type ScreenList = {
	screens: ScreenSummary[];
	warnings: ScreenListWarning[];
};

// Abstracts persistence of the Screen Definition. A boundary that keeps storage-specific
// types out of the Application Service. The initial implementation provides local JSON files / in-memory.
export interface ScreenRepository {
	list(): Promise<ScreenList>;
	get(id: string): Promise<ScreenDefinition | null>;
	// Creates a new one. SCREEN_ALREADY_EXISTS if it already exists.
	create(screen: ScreenDefinition): Promise<ScreenDefinition>;
	// Overwrites an existing one (the existence check is the Service's responsibility).
	// If expectedRevision is passed, the stored revision is re-checked right before saving,
	// and a RevisionConflictError is thrown on mismatch (compare-and-swap).
	// This prevents lost updates from interleaving between load and save.
	save(
		screen: ScreenDefinition,
		expectedRevision?: number,
	): Promise<ScreenDefinition>;
	delete(id: string): Promise<void>;
	exists(id: string): Promise<boolean>;
}

// One line naming what to inspect. A ZodError's full issue list spans pages of JSON,
// which would drown the listing it is attached to.
function readFailureReason(error: unknown): string {
	if (error instanceof SyntaxError) {
		return "the file is not valid JSON";
	}
	if (error instanceof ZodError) {
		return "the contents are not a valid Screen Definition";
	}
	return error instanceof Error ? error.message : String(error);
}

function toSummary(
	screen: ScreenDefinition,
	updatedAt: string | null,
): ScreenSummary {
	return {
		id: screen.id,
		name: screen.name,
		status: screen.status,
		revision: screen.revision,
		updatedAt,
	};
}

// An in-memory implementation for tests and single-process use.
export class InMemoryScreenRepository implements ScreenRepository {
	private readonly store = new Map<string, ScreenDefinition>();

	async list(): Promise<ScreenList> {
		return {
			screens: [...this.store.values()].map((screen) =>
				toSummary(screen, null),
			),
			warnings: [],
		};
	}

	async get(id: string): Promise<ScreenDefinition | null> {
		const screen = this.store.get(id);
		return screen ? structuredClone(screen) : null;
	}

	async create(screen: ScreenDefinition): Promise<ScreenDefinition> {
		if (this.store.has(screen.id)) {
			throw new ComposerError(
				SERVICE_CODES.SCREEN_ALREADY_EXISTS,
				`Screen "${screen.id}" already exists.`,
			);
		}
		this.store.set(screen.id, structuredClone(screen));
		return screen;
	}

	async save(
		screen: ScreenDefinition,
		expectedRevision?: number,
	): Promise<ScreenDefinition> {
		// No await is inserted between the check and the set, so this CAS is atomic within a single process.
		const stored = this.store.get(screen.id);
		if (
			expectedRevision !== undefined &&
			stored &&
			stored.revision !== expectedRevision
		) {
			throw new RevisionConflictError(stored.revision, expectedRevision);
		}
		this.store.set(screen.id, structuredClone(screen));
		return screen;
	}

	async delete(id: string): Promise<void> {
		this.store.delete(id);
	}

	async exists(id: string): Promise<boolean> {
		return this.store.has(id);
	}
}

// A local JSON file implementation. 1 screen = `${dir}/${id}.json`.
// Follows the spec's "the initial implementation may use in-repo JSON / local files."
export class FileScreenRepository implements ScreenRepository {
	constructor(private readonly dir: string) {}

	// A lock that serializes writes per id. Prevents other save/delete calls from interleaving
	// during save's "read -> validate -> write" sequence, making the CAS atomic within a single process.
	private readonly locks = new Map<string, Promise<unknown>>();

	// Runs an operation on the same id only after the previous operation completes (preserves order regardless of success/failure).
	private withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(id) ?? Promise.resolve();
		const run = previous.then(task, task);
		// The tail holds a swallowed Promise so the next waiter isn't chain-rejected by this run's exception.
		this.locks.set(
			id,
			run.then(
				() => undefined,
				() => undefined,
			),
		);
		return run;
	}

	// Builds the storage path from an id. The Screen Definition schema already restricts id to
	// characters valid for a name, but paths like get / exists accept an id without going through
	// the schema, so the Repository itself also verifies "the resolved path sits directly under the storage dir."
	private path(id: string): string {
		const root = resolve(this.dir);
		const target = resolve(root, `${id}.json`);
		if (dirname(target) !== root) {
			throw new ComposerError(
				SERVICE_CODES.INVALID_SCREEN_ID,
				`Screen id "${id}" resolves outside the screen directory.`,
			);
		}
		return target;
	}

	private async ensureDir(): Promise<void> {
		await mkdir(this.dir, { recursive: true });
	}

	async list(): Promise<ScreenList> {
		await this.ensureDir();
		const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
		const screens: ScreenSummary[] = [];
		const warnings: ScreenListWarning[] = [];
		for (const file of files) {
			let screen: ScreenDefinition;
			let modifiedAt: string;
			try {
				const raw = await readFile(join(this.dir, file), "utf8");
				screen = parseScreenDefinition(JSON.parse(raw));
				// stat sits inside the same guard: the file can vanish between readFile and
				// stat, and one disappearing file must not take the whole listing down.
				modifiedAt = (await stat(join(this.dir, file))).mtime.toISOString();
			} catch (error) {
				warnings.push({
					file,
					message: `Skipped "${file}": ${readFailureReason(error)}.`,
				});
				continue;
			}
			// get() resolves a screen by "<id>.json", so a file whose stored id differs
			// from its name would be listed but could never be opened. Excluded with a
			// warning rather than surfacing an id the caller cannot use.
			if (`${screen.id}.json` !== file) {
				warnings.push({
					file,
					message: `Skipped "${file}": it contains screen id "${screen.id}", which is loaded from "${screen.id}.json". Rename the file to match.`,
				});
				continue;
			}
			screens.push(toSummary(screen, modifiedAt));
		}
		return {
			screens: screens.sort((a, b) => a.id.localeCompare(b.id)),
			warnings,
		};
	}

	async get(id: string): Promise<ScreenDefinition | null> {
		try {
			const raw = await readFile(this.path(id), "utf8");
			return parseScreenDefinition(JSON.parse(raw));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async create(screen: ScreenDefinition): Promise<ScreenDefinition> {
		// Do the existence check and write inside the same lock. Outside of it, concurrent
		// create calls on the same id could both see "not there yet," and the later one would silently overwrite the other.
		return this.withLock(screen.id, async () => {
			await this.ensureDir();
			if (await this.exists(screen.id)) {
				throw new ComposerError(
					SERVICE_CODES.SCREEN_ALREADY_EXISTS,
					`Screen "${screen.id}" already exists.`,
				);
			}
			return this.write(screen);
		});
	}

	async save(
		screen: ScreenDefinition,
		expectedRevision?: number,
	): Promise<ScreenDefinition> {
		// Serializes read -> validate -> write per id, making it an atomic CAS within a single
		// process. This does not guard against cross-process contention (no file locking).
		return this.withLock(screen.id, async () => {
			await this.ensureDir();
			if (expectedRevision !== undefined) {
				const existing = await this.get(screen.id);
				if (existing && existing.revision !== expectedRevision) {
					throw new RevisionConflictError(existing.revision, expectedRevision);
				}
			}
			return this.write(screen);
		});
	}

	// The write, called while already holding the lock. The lock isn't reentrant, so this doesn't go through save.
	private async write(screen: ScreenDefinition): Promise<ScreenDefinition> {
		await writeFile(
			this.path(screen.id),
			`${JSON.stringify(screen, null, "\t")}\n`,
		);
		return screen;
	}

	async delete(id: string): Promise<void> {
		return this.withLock(id, async () => {
			try {
				await unlink(this.path(id));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
		});
	}

	async exists(id: string): Promise<boolean> {
		// Keep path()'s validation outside the try. Inside it, an id pointing outside the
		// storage dir would silently become false, as if "no such screen exists."
		const path = this.path(id);
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	}
}
