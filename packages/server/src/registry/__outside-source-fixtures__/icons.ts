// Lives outside components/, so a --source glob scoped to components/**/*.tsx never reads
// this file directly. Still resolved by the TypeScript program through the import below.
export interface IconMeta {
	name: string;
	viewBox: string;
}
