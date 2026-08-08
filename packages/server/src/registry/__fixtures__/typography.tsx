import { forwardRef, type HTMLAttributes, type ReactElement } from "react";

// Fixture for a component that declares variants with cva (class-variance-authority).
// Reproduces only the shape of the call, without adding the real package as a dependency. Variant
// extraction only reads the AST and doesn't do type resolution, so this goes through the same path as the real thing.
declare function cva(
	base: string,
	config: {
		variants: Record<string, Record<string, string>>;
		defaultVariants?: Record<string, string | number | boolean>;
	},
): (props?: Record<string, unknown>) => string;

export const headingVariants = cva("", {
	variants: {
		size: { sm: "text-sm", md: "text-base", lg: "text-lg" },
		color: { primary: "text-primary", danger: "text-danger" },
	},
});

export const textVariants = cva("", {
	variants: {
		size: { xsm: "text-xs", sm: "text-sm", md: "text-base" },
		// A variant with numeric keys. cva turns this into a union of numeric literals.
		clamp: { 1: "line-clamp-1", 2: "line-clamp-2" },
		// A variant with only true / false. cva turns this into a boolean.
		bold: { true: "font-bold", false: "font-normal" },
	},
	defaultVariants: { size: "md", bold: false },
});

/** A heading. Variants don't show up in the type, so only `as` and `className` end up in the registry. */
export function Heading({
	as,
	...props
}: HTMLAttributes<HTMLHeadingElement> & { as: "h1" | "h2" }) {
	return <div data-as={as} className={headingVariants()} {...props} />;
}

type TextProps = HTMLAttributes<HTMLParagraphElement> & { as?: "p" };
type SpanProps = HTMLAttributes<HTMLSpanElement> & { as: "span" };

// A shape that casts to an overloaded type before exporting. react-docgen-typescript only looks at
// the first signature, so only className and as end up in the registry (= what --metadata fills in).
type TextComponent = {
	(props: TextProps): ReactElement | null;
	(props: SpanProps): ReactElement | null;
};

const ForwardedText = forwardRef<
	HTMLParagraphElement | HTMLSpanElement,
	TextProps | SpanProps
>(({ as, ...props }, ref) => (
	<span ref={ref} data-as={as} className={textVariants()} {...props} />
));

export const Text = ForwardedText as TextComponent;
