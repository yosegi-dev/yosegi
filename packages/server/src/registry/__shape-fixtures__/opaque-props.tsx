import type { ComponentProps } from "react";
import type { ZodType } from "zod";

// Fixture for testing how the "first-level shape" is read for props that get rounded down to json.
// Bundles into one file the shapes that should be expanded (JSDoc-documented / optional / array), the
// shapes that must not be expanded (nested / union / third-party types), and the shape that gets truncated at the limit.
// Also covers function props' call signatures and unions of literals / primitives here.

/** The display state for select-all across pages. */
export type SelectAllState = {
	/** 全件選択ボタンを出せるか。 */
	canSelectAll: boolean;
	/** 全件選択の対象件数。 */
	totalCount: number;
	/** 全件選択へ切り替えるときに呼ばれる。 */
	onSelectAll: () => void;
	/** 表示ラベル。省略時は既定文言。 */
	label?: string;
};

/** A setting that holds a nested object. */
export type NestedConfig = {
	/** The heading. */
	title: string;
	/** Spacing settings. Not expanded past this point. */
	spacing: { top: number; bottom: number };
	/** A named nested type. The name is kept. */
	selection: SelectAllState;
	/** An array of anonymous objects. */
	rows: { id: string; label: string }[];
};

/** A row displayed in the list. */
export type Row = {
	/** The row's identifier. */
	id: string;
	/** The display name. */
	name: string;
	/** Whether it's selected. */
	selected?: boolean;
};

/**
 * A discriminated union action.
 * Which fields are required changes depending on which branch is written.
 */
export type Action =
	| { kind: "link"; href: string }
	| { kind: "button"; onClick: () => void };

/** Each item in a dropdown-style action. */
export type SelectionActionItem = {
	/** The label shown on the dropdown menu item. */
	label: string;
	/** Called when the item is clicked. */
	onClick: () => void;
};

/**
 * A discriminated union, but the base's shared fields are held via an intersection type, and the
 * branch-specific fields cancel each other out with `?: never` (the branch with `onClick` and the
 * branch with `items`). A representative example of a union shape that avoids the host's
 * getProperties() problem of "only the shared fields come back".
 */
export type SelectionAction = {
	/** アクションに表示するラベル。 */
	label: string;
	/** ボタン / トリガーのバリアント種別。 */
	variant?: "secondary" | "destructive";
} & (
	| {
			/** アクションが実行されるタイミングで呼ばれる。 */
			onClick: () => void;
			items?: never;
	  }
	| {
			/** ドロップダウンに表示する項目一覧。 */
			items: SelectionActionItem[];
			onClick?: never;
	  }
);

/** A type whose fields exceed the limit. */
export type WideOptions = {
	a1: string;
	a2: string;
	a3: string;
	a4: string;
	a5: string;
	a6: string;
	a7: string;
	a8: string;
	a9: string;
	a10: string;
	a11: string;
	a12: string;
	a13: string;
	a14: string;
};

/**
 * An overloaded function. Its type text has no `=>` so kind falls back to json,
 * but it does have call signatures.
 */
export type Formatter = {
	(value: string): string;
	(value: number, digits: number): string;
};

/** The left-hand side of the intersection type. */
export type Identity = {
	/** 利用者の識別子。 */
	id: string;
	/** 画面に出す名前。 */
	name: string;
};

/** The right-hand side of the intersection type. */
export type Contact = {
	/** 連絡先メールアドレス。 */
	email: string | null;
};

/** An intersection type. It's fine to expand since it's a single shape that satisfies both sides. */
export type Profile = Identity & Contact;

/** A union of only literals. What's needed to write it is the contents, not the name. */
export type Feature = "bold" | "italic" | "underline";

/** A union of literals that exceeds the limit. */
export type WideFeature =
	| "f1"
	| "f2"
	| "f3"
	| "f4"
	| "f5"
	| "f6"
	| "f7"
	| "f8"
	| "f9"
	| "f10"
	| "f11"
	| "f12"
	| "f13"
	| "f14"
	| "f15"
	| "f16"
	| "f17"
	| "f18"
	| "f19"
	| "f20"
	| "f21"
	| "f22";

/**
 * A third-party type re-exported through a host alias. The declaration the alias points at
 * lives in the host, but the type ultimately resolves to zod, so the package must still be reported.
 */
export type ReexportedValidator = ZodType;

/**
 * A host alias that intersects host-only extras with a third-party type, the shape
 * `ComponentProps<typeof X>`-style helpers produce. The alias itself is declared in the
 * host, but one constituent resolves to zod, so it must not expand zod's own members.
 */
export type WrappedValidator = { extra: string } & ZodType;

type Props = {
	/** The select-all state. */
	selectAll: SelectAllState;
	/** A setting with a nested object. */
	config: NestedConfig;
	/** The rows to display. */
	rows: Row[];
	/** The actions that can be run. */
	actions: Action[];
	/** A discriminated union action extended with an intersection type + `?: never`. */
	selectionActions: SelectionAction[];
	/** A setting that exceeds the limit. */
	options: WideOptions;
	/** A type from React. Not expanded since it's not a host declaration. */
	anchor: ComponentProps<"a">;
	/** An anonymous union with neither a name nor a shape to show. */
	fallback: { kind: "a" } | { kind: "b"; extra: number } | null;
	/** An index-only type with no listable fields. */
	lookup: Record<string, number>;
	/** A plain function. */
	onSelect: (file: File) => void;
	/** A function with an optional argument and a rest parameter. */
	onLog: (message: string, level?: number, ...tags: string[]) => Promise<void>;
	/** A function with a type parameter. */
	onPick: <TRow extends Row>(row: TRow, index: number) => void;
	/** An overloaded function. */
	format: Formatter;
	/** An intersection type. */
	profile: Profile;
	/** A union of primitives. */
	itemId: string | number;
	/** An array of a union of literals. A bare union is classified as enum, so this is seen as an array here. */
	features: Feature[];
	/** An array of a union of literals that exceeds the limit. */
	wideFeatures: WideFeature[];
	/** A third-party type. Can even name the package. */
	validator: ZodType;
	/** A third-party type reached through a host alias. The package must still be reported. */
	reexportedValidator: ReexportedValidator;
	/** A host alias that intersects host-only extras with a third-party type. */
	wrappedValidator: WrappedValidator;
};

/** A component that lines up opaque props. */
export function OpaqueProps({ selectAll }: Props) {
	return <div>{selectAll.totalCount}</div>;
}
