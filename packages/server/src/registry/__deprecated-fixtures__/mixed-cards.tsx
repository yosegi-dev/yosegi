// Fixture for a module with several component exports: a file-level Storybook
// "deprecated" tag must not spill over to the exports the tag cannot identify.

/** The card the tagged Story is about. */
export function MixedCard({ title }: { title: string }) {
	return <div>{title}</div>;
}

/** A sibling export in the same file, not covered by the Story's tag. */
export function MixedCardFooter({ note }: { note: string }) {
	return <footer>{note}</footer>;
}
