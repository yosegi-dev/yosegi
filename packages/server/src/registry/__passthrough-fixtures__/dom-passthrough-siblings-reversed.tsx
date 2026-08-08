import type { TdHTMLAttributes, ThHTMLAttributes } from "react";

// Same collision as dom-passthrough-siblings.tsx, declared in the opposite order, to
// confirm the fix doesn't merely happen to work for one parse order. Before the fix, this
// file alone would have made TableDataCell2 (declared first) resolve correctly and
// TableHeadCell2 (declared second) resolve to the wrong tag -- the mirror image of
// dom-passthrough-siblings.tsx.
export interface TableDataCell2Props
	extends TdHTMLAttributes<HTMLTableCellElement> {
	label: string;
}

export function TableDataCell2({ label, ...rest }: TableDataCell2Props) {
	return <td {...rest}>{label}</td>;
}

export interface TableHeadCell2Props
	extends ThHTMLAttributes<HTMLTableCellElement> {
	label: string;
}

export function TableHeadCell2({ label, ...rest }: TableHeadCell2Props) {
	return <th {...rest}>{label}</th>;
}
