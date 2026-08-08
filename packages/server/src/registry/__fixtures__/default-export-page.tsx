// A shape common to page-like composed examples: `export default function`, where the name only exists on the declaration side.

type DefaultExportPageProps = {
	/** ページの見出し。 */
	heading: string;
};

/** A sample page that is a default export. */
export default function DefaultExportPage({ heading }: DefaultExportPageProps) {
	return <h1>{heading}</h1>;
}
