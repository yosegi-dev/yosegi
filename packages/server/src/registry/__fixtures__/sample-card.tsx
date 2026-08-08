import { forwardRef, type ReactNode } from "react";

// Fixture for testing type extraction. Packs the representative shapes the extractor
// should handle (forwardRef / string union / numeric union / boolean / ReactNode / function / JSDoc) into one.

export type SampleCardProps = {
	/** カードの見出し。 */
	title: string;
	/** 表示スタイル。 */
	variant?: "default" | "danger" | "success";
	/** The number of columns. */
	columns?: 1 | 2 | 3;
	/** Whether to show a border. */
	bordered?: boolean;
	/** ヘッダー右端に置く要素。 */
	actions?: ReactNode;
	/** Called when selected. */
	onSelect?: (id: string) => void;
	/** The aggregate value. null if there isn't one. */
	payload?: { total: number } | null;
	/** Called when closed. null if it can't be closed. */
	onDismiss?: (() => void) | null;
	children?: ReactNode;
};

/** サンプルのカード。 */
export const SampleCard = forwardRef<HTMLDivElement, SampleCardProps>(
	({ title, actions, children }, ref) => (
		<div ref={ref}>
			<h2>{title}</h2>
			{actions}
			{children}
		</div>
	),
);
// A state where the export name and displayName diverge. The id should be taken from the export name.
SampleCard.displayName = "RenamedSampleCard";

// A capitalized export that isn't a component. Doesn't end up in the registry.
export const SAMPLE_CARD_LIMIT = 10;
