import type { IconMeta } from "../icons.ts";

export interface TagProps {
	label: string;
	icon: IconMeta;
}

export function Tag({ label, icon }: TagProps) {
	return (
		<span>
			{icon.name} {label}
		</span>
	);
}
