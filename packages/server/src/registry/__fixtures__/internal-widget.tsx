// Fixture for an export that should be excluded from the registry.

/**
 * A widget for internal implementation use.
 * @yosegi-internal
 */
export function InternalWidget({ label }: { label: string }) {
	return <span>{label}</span>;
}

/** A widget that's fine to expose. */
export function PublicWidget({ label }: { label: string }) {
	return <span>{label}</span>;
}
