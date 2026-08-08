// Fixture for measuring documentation coverage on props.
// Puts "required and opaque but missing JSDoc" props and their counterpart
// (JSDoc-documented, literal-writable) in the same file, to verify that the
// aggregation and report ordering are reproducible from the type-extraction result.

export type TableColumn = {
	header: string;
	width?: number;
};

type LedgerProps = {
	// Required and json. The type alone doesn't say what to pass, and there's no JSDoc either.
	columns: TableColumn[];
	// Required and a function. The caller's responsibility isn't explained.
	onRowSelect: (id: string) => void;
	/** The list's heading. */
	caption: string;
	// A literal can be written, so a missing description doesn't block implementation.
	dense?: boolean;
};

export function Ledger({ caption }: LedgerProps) {
	return <div>{caption}</div>;
}

type CaptionedProps = {
	/** The body text to display. */
	body: string;
	/** The rendered rows. If null, only the body text is shown. */
	rows: TableColumn[] | null;
};

export function Captioned({ body }: CaptionedProps) {
	return <p>{body}</p>;
}
