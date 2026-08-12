// Fixture for reading @deprecated from the component's JSDoc.

/**
 * The old banner.
 * @deprecated Use FreshBanner instead.
 */
export function LegacyBanner({ label }: { label: string }) {
	return <div>{label}</div>;
}

/** The current banner. */
export function FreshBanner({ label }: { label: string }) {
	return <div>{label}</div>;
}
