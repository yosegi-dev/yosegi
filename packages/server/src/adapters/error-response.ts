import {
	ComposerError,
	OPERATION_CODES,
	RevisionConflictError,
	SERVICE_CODES,
} from "@yosegi/core";
import { ValidationFailedError } from "@yosegi/core/app";
import { ZodError } from "zod";

// An Adapter-independent error representation. HTTP/MCP/CLI each convert it to their own shape.
export type ErrorResponse = {
	status: number;
	body: {
		error: {
			code: string;
			message: string;
			[key: string]: unknown;
		};
		validation?: unknown;
	};
};

// Maps a domain/service error to the equivalent HTTP status.
export function toErrorResponse(error: unknown): ErrorResponse {
	if (error instanceof ValidationFailedError) {
		return {
			status: 422,
			body: {
				error: { code: error.code, message: error.message },
				validation: error.result,
			},
		};
	}
	if (error instanceof RevisionConflictError) {
		return {
			status: 409,
			body: {
				error: {
					code: error.code,
					message: error.message,
					currentRevision: error.currentRevision,
					baseRevision: error.baseRevision,
				},
			},
		};
	}
	if (error instanceof ComposerError) {
		return {
			status: statusForCode(error.code),
			body: {
				error: {
					code: error.code,
					message: error.message,
					...(error.nodeId ? { nodeId: error.nodeId } : {}),
				},
			},
		};
	}
	if (error instanceof ZodError) {
		const hints = schemaHints(error);
		return {
			status: 400,
			body: {
				error: {
					code: "INVALID_REQUEST",
					message: "Request payload failed schema validation.",
					issues: error.issues,
					...(hints.length > 0 ? { hints } : {}),
				},
			},
		};
	}
	// An invalid JSON body (a SyntaxError from c.req.json()) becomes 400, not 500.
	if (error instanceof SyntaxError) {
		return {
			status: 400,
			body: {
				error: {
					code: "INVALID_JSON",
					message: "Request body is not valid JSON.",
				},
			},
		};
	}
	return {
		status: 500,
		body: {
			error: {
				code: "INTERNAL_ERROR",
				message: error instanceof Error ? error.message : "Unknown error",
			},
		},
	};
}

// A zod issue only says what's wrong, so for Screen JSON fields that are easy to write
// incorrectly, attach the correct shape. bindings and events are asymmetric in shape (the
// former a string, the latter an object), which makes it easy to mistakenly carry one's
// notation over to the other.
const SCHEMA_HINTS: { segment: string; hint: string }[] = [
	{
		segment: "bindings",
		hint: 'bindings is { "<prop name>": "<data expression as a string>" }. Do not wrap the expression in an object (e.g. { "children": "coupons.length" }).',
	},
	{
		segment: "events",
		hint: 'events is { "<event name>": { "action": "<action name>", "arguments": { ... } } }. Do not pass a bare string (e.g. { "onClick": { "action": "navigate", "arguments": { "to": "/x" } } }).',
	},
];

function schemaHints(error: ZodError): string[] {
	const hints = new Set<string>();
	for (const issue of error.issues) {
		for (const { segment, hint } of SCHEMA_HINTS) {
			if (issue.path.includes(segment)) {
				hints.add(hint);
			}
		}
	}
	return [...hints];
}

function statusForCode(code: string): number {
	switch (code) {
		case SERVICE_CODES.SCREEN_NOT_FOUND:
		case SERVICE_CODES.COMPONENT_NOT_FOUND:
		case OPERATION_CODES.NODE_NOT_FOUND:
		case OPERATION_CODES.PARENT_NOT_FOUND:
			return 404;
		case SERVICE_CODES.SCREEN_ALREADY_EXISTS:
			return 409;
		case SERVICE_CODES.FORBIDDEN:
		case SERVICE_CODES.PUBLISHED_SCREEN_LOCKED:
			return 403;
		default:
			return 400;
	}
}
