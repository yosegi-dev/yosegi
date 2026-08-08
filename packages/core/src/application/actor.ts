// The acting subject for authorization. Kept simple for the MVP, but structured so
// Application Service can accept authorization info (to be broken down further later, e.g. components:read).
export const PERMISSIONS = [
	"components:read",
	"screens:read",
	"screens:create",
	"screens:update",
	"screens:delete",
	"screens:publish",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type ActorContext = {
	id: string;
	// Whether the operation comes from an agent (e.g. Claude Code). Prevents unauthorized changes to published screens.
	isAgent: boolean;
	permissions: ReadonlySet<Permission>;
};

// A system actor with all permissions (the default for local CLI operations).
export function systemActor(): ActorContext {
	return {
		id: "system",
		isAgent: false,
		permissions: new Set(PERMISSIONS),
	};
}

// An agent actor. Has no publish permission by default, limited to changes on Drafts.
export function agentActor(id = "agent"): ActorContext {
	return {
		id,
		isAgent: true,
		permissions: new Set([
			"components:read",
			"screens:read",
			"screens:create",
			"screens:update",
		]),
	};
}

export function hasPermission(
	actor: ActorContext,
	permission: Permission,
): boolean {
	return actor.permissions.has(permission);
}
