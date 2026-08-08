import type { ComponentPropsWithoutRef } from "react";

// Extends a tag-specific attribute interface via ComponentPropsWithoutRef<"button">, the
// common way a wrapper spreads standard DOM props onto its rendered element.
export interface SpreadingButtonProps
	extends ComponentPropsWithoutRef<"button"> {
	label: string;
}

export function SpreadingButton({ label, ...rest }: SpreadingButtonProps) {
	return <button {...rest}>{label}</button>;
}

// Declares its own props only — no DOM attributes are folded in, so no pass-through note
// should be attached.
export interface PlainTagProps {
	label: string;
}

export function PlainTag({ label }: PlainTagProps) {
	return <span>{label}</span>;
}
