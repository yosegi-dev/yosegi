import type { HTMLAttributes, PropsWithChildren, ReactNode } from "react";

// Fixture that lines up the boundary between "accepts" and "doesn't accept" className / children.
// Back when the registry added both of these unconditionally, every one of these would have had className and children.

/** A component that declares className in its own props. */
export function ExplicitClassName({
	className,
	label,
}: {
	className?: string;
	label: string;
}) {
	return <span className={className}>{label}</span>;
}

/** A component that spreads a whole set of HTML attributes. Both className and children come in from React's own declarations. */
export function SpreadHtmlAttributes(props: HTMLAttributes<HTMLDivElement>) {
	return <div {...props} />;
}

/** A component that receives children via PropsWithChildren. Does not accept className. */
export function WithChildren({
	tone,
	children,
}: PropsWithChildren<{ tone: string }>) {
	return <div data-tone={tone}>{children}</div>;
}

/** A component that declares children explicitly. */
export function ExplicitChildren({ children }: { children: ReactNode }) {
	return <div>{children}</div>;
}

/** A component that accepts neither className nor children. Just formats a value and returns it. */
export function PlainValue({ amount }: { amount: number }) {
	return <>{amount}</>;
}
