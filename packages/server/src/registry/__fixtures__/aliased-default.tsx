// A shape where the named export and default export point to the same entity. Only one entry should end up in the registry.

/** A tile that can be pulled in either by its named export or as the default. */
export function AliasedTile({ label }: { label: string }) {
	return <span>{label}</span>;
}

export default AliasedTile;
