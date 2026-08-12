// Machine-readable error codes shared across the entire Yosegi domain.
//
// Errors are split into "fatal ones that reject a save/update" (error) and
// "ones that are implementable but undesirable" (warning). Strings are kept
// stable so any Adapter — UI, API, MCP, CLI — can branch on the same code.

// Validation codes returned by the Validator (structural problems in a Screen Definition).
export const VALIDATION_CODES = {
	// error
	COMPONENT_NOT_FOUND: "COMPONENT_NOT_FOUND",
	UNKNOWN_PROP: "UNKNOWN_PROP",
	// The binding's target points at a prop that doesn't exist in the Manifest.
	UNKNOWN_BINDING_TARGET: "UNKNOWN_BINDING_TARGET",
	INVALID_PROP_VALUE: "INVALID_PROP_VALUE",
	MISSING_REQUIRED_PROP: "MISSING_REQUIRED_PROP",
	// A value is written for a function-typed prop. Handlers can't be represented in props.
	FUNCTION_PROP_VALUE: "FUNCTION_PROP_VALUE",
	// A value is written for a reserved prop name (children / key / ref). Emit never
	// writes these as JSX attributes, so the value would be silently dropped.
	RESERVED_PROP: "RESERVED_PROP",
	SLOT_NOT_FOUND: "SLOT_NOT_FOUND",
	SLOT_COMPONENT_NOT_ALLOWED: "SLOT_COMPONENT_NOT_ALLOWED",
	SLOT_MAX_ITEMS_EXCEEDED: "SLOT_MAX_ITEMS_EXCEEDED",
	PARENT_NOT_ALLOWED: "PARENT_NOT_ALLOWED",
	CHILD_NOT_ALLOWED: "CHILD_NOT_ALLOWED",
	DUPLICATE_NODE_ID: "DUPLICATE_NODE_ID",
	// repeat sits on the root node. The root has no parent slot to hold its
	// copies, so there is nothing the expansion could mean.
	REPEAT_ON_ROOT: "REPEAT_ON_ROOT",
	// repeat's value is outside the allowed range (an integer between
	// MIN_REPEAT_COUNT and MAX_REPEAT_COUNT).
	REPEAT_OUT_OF_RANGE: "REPEAT_OUT_OF_RANGE",
	REGISTRY_VERSION_MISMATCH: "REGISTRY_VERSION_MISMATCH",
	// warning
	// The event's target points at a prop that doesn't exist in the Manifest. Since
	// the Manifest doesn't hold a list of events, this stays a warning on the
	// assumption that some cases will be missed.
	UNKNOWN_EVENT_TARGET: "UNKNOWN_EVENT_TARGET",
	// A value is written for a prop with editable=false. Kept as a warning since the
	// shape of the value can't be validated.
	NOT_EDITABLE_PROP_VALUE: "NOT_EDITABLE_PROP_VALUE",
	// A required prop is declared only via a binding. Since the generated output
	// emits the binding expression as-is, it won't pass type checking until that name
	// actually exists in the Story.
	BOUND_REQUIRED_PROP: "BOUND_REQUIRED_PROP",
	DEPRECATED_COMPONENT: "DEPRECATED_COMPONENT",
	MISSING_REQUIRED_SLOT: "MISSING_REQUIRED_SLOT",
	// A fixture no binding references. Emitted into the Story anyway (an unused
	// const breaks nothing), so it stays informational rather than blocking.
	UNUSED_FIXTURE: "UNUSED_FIXTURE",
	// A short id was written while the Registry also has a host component sharing a
	// name with a synthetic primitive.
	SYNTHETIC_NAME_SHADOWED: "SYNTHETIC_NAME_SHADOWED",
} as const;

export type ValidationCode =
	(typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

// Operation error codes thrown when applying an Operation.
export const OPERATION_CODES = {
	NODE_NOT_FOUND: "NODE_NOT_FOUND",
	PARENT_NOT_FOUND: "PARENT_NOT_FOUND",
	SLOT_INDEX_OUT_OF_RANGE: "SLOT_INDEX_OUT_OF_RANGE",
	DUPLICATE_NODE_ID: "DUPLICATE_NODE_ID",
	CANNOT_MOVE_INTO_DESCENDANT: "CANNOT_MOVE_INTO_DESCENDANT",
	CANNOT_REMOVE_ROOT: "CANNOT_REMOVE_ROOT",
	UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
} as const;

export type OperationCode =
	(typeof OPERATION_CODES)[keyof typeof OPERATION_CODES];

// Service error codes thrown at the Application layer.
export const SERVICE_CODES = {
	SCREEN_NOT_FOUND: "SCREEN_NOT_FOUND",
	// An id that points outside the storage location. Always rejected before read/write.
	INVALID_SCREEN_ID: "INVALID_SCREEN_ID",
	COMPONENT_NOT_FOUND: "COMPONENT_NOT_FOUND",
	// No registry exists where the adapter looked for one. Split from INTERNAL_ERROR so
	// an agent can branch on it (the fix — run registry build — is always the same).
	REGISTRY_NOT_FOUND: "REGISTRY_NOT_FOUND",
	// A structurally valid invocation whose argument combination is unusable
	// (e.g. --source without --tsconfig). Not INTERNAL_ERROR: the caller can fix it.
	INVALID_ARGUMENT: "INVALID_ARGUMENT",
	SCREEN_ALREADY_EXISTS: "SCREEN_ALREADY_EXISTS",
	REVISION_CONFLICT: "REVISION_CONFLICT",
	VALIDATION_FAILED: "VALIDATION_FAILED",
	PUBLISHED_SCREEN_LOCKED: "PUBLISHED_SCREEN_LOCKED",
	FORBIDDEN: "FORBIDDEN",
} as const;

export type ServiceCode = (typeof SERVICE_CODES)[keyof typeof SERVICE_CODES];

export type ComposerErrorCode = OperationCode | ServiceCode;

// Base error that always carries a code so Adapters can handle it programmatically.
export class ComposerError extends Error {
	readonly code: ComposerErrorCode;
	readonly nodeId: string | null;
	// A "did you mean" line the adapter prints verbatim next to the message. Kept on the
	// error itself so CLI / MCP / HTTP all surface the same candidates without each
	// adapter re-deriving them.
	readonly suggestion: string | null;
	// Structured fields for the error (e.g. the missing registry's path), so an agent
	// branches on data instead of parsing the message.
	readonly details: Record<string, unknown> | null;

	constructor(
		code: ComposerErrorCode,
		message: string,
		nodeId: string | null = null,
		options: {
			suggestion?: string | null;
			details?: Record<string, unknown> | null;
		} = {},
	) {
		super(message);
		this.name = "ComposerError";
		this.code = code;
		this.nodeId = nodeId;
		this.suggestion = options.suggestion ?? null;
		this.details = options.details ?? null;
	}
}

// Dedicated error representing an optimistic-locking conflict. Carries the latest
// revision to prompt a re-fetch.
export class RevisionConflictError extends ComposerError {
	readonly currentRevision: number;
	readonly baseRevision: number;

	constructor(currentRevision: number, baseRevision: number) {
		super(
			SERVICE_CODES.REVISION_CONFLICT,
			`Screen was updated by someone else (current revision ${currentRevision}, your base revision ${baseRevision}). Re-fetch the latest definition.`,
		);
		this.name = "RevisionConflictError";
		this.currentRevision = currentRevision;
		this.baseRevision = baseRevision;
	}
}
