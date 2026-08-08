import type { TdHTMLAttributes, ThHTMLAttributes } from "react";

// Regression fixture for the react-docgen-typescript cache-collision bug: Parser.getPropsInfo
// memoizes a resolved prop by `${declaringFile}_${propName}` alone (no interface name), so
// ThHTMLAttributes and TdHTMLAttributes -- declared in the same @types/react file and sharing
// member names like `colSpan` / `rowSpan` -- collide on that key. Whichever component's prop
// resolves first "wins" the cache entry for every later component sharing that member name.
//
// Declared first, mirroring shadcn/ui's table.tsx where TableHead precedes TableCell -- the
// exact ordering the sweep found this bug through (TableCell wrongly labeled "th").
export interface TableHeadCellProps
	extends ThHTMLAttributes<HTMLTableCellElement> {
	label: string;
}

export function TableHeadCell({ label, ...rest }: TableHeadCellProps) {
	return <th {...rest}>{label}</th>;
}

// Declared second, sharing colSpan / rowSpan / headers / scope / abbr / align / height /
// width / valign with ThHTMLAttributes above.
export interface TableDataCellProps
	extends TdHTMLAttributes<HTMLTableCellElement> {
	label: string;
}

export function TableDataCell({ label, ...rest }: TableDataCellProps) {
	return <td {...rest}>{label}</td>;
}
