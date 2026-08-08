// Fixture where the required determination drops out when the props type is a union.
// `label` is required on both branches of the type, but react-docgen-typescript can
// drop required for a props type that includes a union (a known limitation in docs/registry.md).

type LinkTile = {
	/** The display label. */
	label: string;
	/** The navigation target. */
	href: string;
};

type ButtonTile = {
	/** The display label. */
	label: string;
	/** Called when pressed. */
	onPress: () => void;
};

/** A tile whose props type is a union. */
export function UnionTile(props: LinkTile | ButtonTile) {
	return <span>{props.label}</span>;
}
