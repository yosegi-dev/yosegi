import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Structural checks for the documentation, run by CI and by hand as
// `bun run check:docs`. This is the executable form of the checklist in
// docs/conventions.md: relative links and anchors must resolve, every English
// page must have a Japanese twin with the same headings / fences / table rows,
// and lines must stay within the 100-column budget counted in East Asian
// character width (tables, code blocks, and front matter are exempt — they
// cannot always be wrapped).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const WIDTH_LIMIT = 100;

// The width check reports without failing for now: the existing Japanese pages
// carry around a hundred over-long lines, and they are re-wrapped in a
// follow-up PR that flips this to true. Links, anchors, and twin parity fail
// immediately either way.
export const WIDTH_VIOLATIONS_FAIL = false;

export type DocFile = {
	// Path relative to the repository root, with forward slashes.
	path: string;
	text: string;
};

// East Asian Wide and Fullwidth ranges count 2 columns; everything else,
// including Ambiguous characters such as the em dash, counts 1. This mirrors
// how the pages were wrapped by hand.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xa960, 0xa97f],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe10, 0xfe19],
	[0xfe30, 0xfe52],
	[0xfe54, 0xfe66],
	[0xfe68, 0xfe6b],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x1f300, 0x1f64f],
	[0x1f900, 0x1f9ff],
	[0x20000, 0x2fffd],
	[0x30000, 0x3fffd],
];

export function eastAsianWidth(line: string): number {
	let width = 0;
	for (const ch of line) {
		const cp = ch.codePointAt(0) as number;
		width += WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
	}
	return width;
}

// The GitHub-style slug the docs link against: lowercase, punctuation dropped,
// whitespace to hyphens. Japanese headings keep their characters, which is why
// anchors like #検証エラーの-code work.
export function slugify(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}_\s-]/gu, "")
		.replace(/\s/g, "-");
}

function stripFencedCode(text: string): string {
	return text.replace(/^`{3}.*?^`{3}/gms, "");
}

function headingSlugs(prose: string): string[] {
	return [...prose.matchAll(/^#+\s+(.*)$/gm)].map((m) =>
		slugify(m[1] as string),
	);
}

function count(pattern: RegExp, text: string): number {
	return (text.match(pattern) ?? []).length;
}

// The Japanese twin of an English page, or null for pages that need none
// (Japanese pages themselves, and root files other than README.md).
function twinPath(path: string): string | null {
	if (path === "README.md") return "README.ja.md";
	const match = path.match(/^docs\/([^/]+\.md)$/);
	return match ? `docs/ja/${match[1]}` : null;
}

function isWidthChecked(path: string): boolean {
	return (
		path === "README.md" || path === "README.ja.md" || path.startsWith("docs/")
	);
}

// Lines exempt from the width limit: front matter (VitePress reads it, humans
// do not), table rows (their width is the table's business), and fenced code.
function widthCheckedLines(text: string): Array<[number, string]> {
	const lines = text.split("\n");
	const out: Array<[number, string]> = [];
	let index = 0;
	if (lines[0] === "---") {
		const close = lines.indexOf("---", 1);
		if (close !== -1) index = close + 1;
	}
	let inFence = false;
	for (; index < lines.length; index++) {
		const line = lines[index] as string;
		if (/^`{3}/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line.trimStart().startsWith("|")) continue;
		out.push([index + 1, line]);
	}
	return out;
}

export type DocProblems = {
	errors: string[];
	widthErrors: string[];
};

export function checkDocs(
	files: DocFile[],
	exists: (path: string) => boolean,
): DocProblems {
	const errors: string[] = [];
	const widthErrors: string[] = [];
	const raw = new Map(files.map((f) => [f.path, f.text]));
	const prose = new Map(files.map((f) => [f.path, stripFencedCode(f.text)]));
	const slugs = new Map(
		files.map((f) => [f.path, headingSlugs(prose.get(f.path) as string)]),
	);

	for (const file of files) {
		// Inline code is stripped first so a backticked example link is not
		// treated as a real one.
		const linkable = (prose.get(file.path) as string).replace(/`[^`]*`/g, "");
		for (const match of linkable.matchAll(
			/\]\((?!https?:|mailto:)([^)\s]+)\)/g,
		)) {
			const link = match[1] as string;
			const [path, anchor] = ((): [string, string] => {
				const hash = link.indexOf("#");
				return hash === -1
					? [link, ""]
					: [link.slice(0, hash), link.slice(hash + 1)];
			})();
			const target =
				path === ""
					? file.path
					: posix.normalize(posix.join(posix.dirname(file.path), path));
			if (!raw.has(target) && !exists(target)) {
				errors.push(`${file.path}: missing file -> ${link}`);
			} else if (anchor !== "" && !(slugs.get(target) ?? []).includes(anchor)) {
				errors.push(`${file.path}: missing anchor -> ${link}`);
			}
		}
	}

	for (const file of files) {
		const twin = twinPath(file.path);
		if (twin === null) continue;
		if (!raw.has(twin)) {
			errors.push(`${file.path}: no Japanese twin`);
			continue;
		}
		const pairs: Array<[string, RegExp, Map<string, string>]> = [
			["headings", /^#+\s/gm, prose],
			["fences", /^`{3}/gm, raw],
			["table rows", /^\|/gm, prose],
		];
		for (const [label, pattern, source] of pairs) {
			const a = count(pattern, source.get(file.path) as string);
			const b = count(pattern, source.get(twin) as string);
			if (a !== b) {
				errors.push(`${file.path} vs ${twin}: ${label} ${a} != ${b}`);
			}
		}
	}

	for (const file of files) {
		if (!isWidthChecked(file.path)) continue;
		for (const [lineNumber, line] of widthCheckedLines(file.text)) {
			const width = eastAsianWidth(line);
			if (width > WIDTH_LIMIT) {
				widthErrors.push(
					`${file.path}:${lineNumber}: ${width} columns (limit ${WIDTH_LIMIT})`,
				);
			}
		}
	}

	return { errors, widthErrors };
}

// Root *.md first, then docs/**/*.md, both sorted — dot directories such as
// docs/.vitepress hold no documentation and are skipped.
export function collectDocFiles(root: string): DocFile[] {
	const rootMds = readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name)
		.sort();
	const docsMds: string[] = [];
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const relPath = `${rel}/${entry.name}`;
			if (entry.isDirectory()) walk(join(dir, entry.name), relPath);
			else if (entry.name.endsWith(".md")) docsMds.push(relPath);
		}
	};
	walk(join(root, "docs"), "docs");
	docsMds.sort();
	return [...rootMds, ...docsMds].map((path) => ({
		path,
		text: readFileSync(join(root, path), "utf8"),
	}));
}

if (import.meta.main) {
	const files = collectDocFiles(REPO_ROOT);
	const { errors, widthErrors } = checkDocs(files, (path) =>
		existsSync(join(REPO_ROOT, path)),
	);
	for (const problem of errors) console.error(problem);
	const widthFailed = WIDTH_VIOLATIONS_FAIL && widthErrors.length > 0;
	for (const problem of widthErrors) {
		console.error(`${WIDTH_VIOLATIONS_FAIL ? "" : "warning: "}${problem}`);
	}
	if (errors.length === 0 && !widthFailed) console.log("docs ok");
	process.exit(errors.length > 0 || widthFailed ? 1 : 0);
}
