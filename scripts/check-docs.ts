import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Structural checks for the documentation, run by CI and by hand as
// `bun run check:docs`. This is the executable form of the checklist in
// docs/conventions.md: relative links and anchors must resolve, every English
// page must have a Japanese twin with as many headings and table rows and with
// fences whose content matches (translated comments aside), and lines must
// stay within the 100-column budget counted in East Asian character width
// (tables, code blocks, and front matter are exempt — they cannot always be
// wrapped).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const WIDTH_LIMIT = 100;

// Every page is wrapped within the budget, so an over-long line fails the
// check the same way a broken link does.
export const WIDTH_VIOLATIONS_FAIL = true;

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

// CommonMark accepts tilde fences as well as backtick fences, indented by up
// to three spaces (four make an indented code block), and closes a fence only
// with a run of the same character at least as long as the opener. Tracking
// the opener instead of toggling on any marker keeps a backtick run inside a
// tilde fence (or vice versa) from ending the block early.
type FenceMarker = {
	char: string;
	length: number;
	// Whatever follows the run: the info string on an opener, and required to
	// be blank on a closer.
	rest: string;
};

function fenceMarker(line: string): FenceMarker | null {
	const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
	if (match === null) return null;
	const run = match[1] as string;
	return {
		char: run[0] as string,
		length: run.length,
		rest: match[2] as string,
	};
}

function closesFence(open: FenceMarker, line: string): boolean {
	const marker = fenceMarker(line);
	return (
		marker !== null &&
		marker.char === open.char &&
		marker.length >= open.length &&
		marker.rest.trim() === ""
	);
}

function stripFencedCode(text: string): string {
	const out: string[] = [];
	let open: FenceMarker | null = null;
	for (const line of text.split("\n")) {
		if (open === null) {
			const marker = fenceMarker(line);
			if (marker === null) out.push(line);
			else open = marker;
		} else if (closesFence(open, line)) {
			open = null;
		}
	}
	return out.join("\n");
}

type Fence = {
	info: string;
	body: string[];
};

function fencedBlocks(text: string): Fence[] {
	const blocks: Fence[] = [];
	let open: { marker: FenceMarker; fence: Fence } | null = null;
	for (const line of text.split("\n")) {
		if (open === null) {
			const marker = fenceMarker(line);
			if (marker !== null) {
				open = { marker, fence: { info: marker.rest.trim(), body: [] } };
			}
		} else if (closesFence(open.marker, line)) {
			blocks.push(open.fence);
			open = null;
		} else {
			open.fence.body.push(line);
		}
	}
	return blocks;
}

// What twin fences are compared on. Commands are language-neutral and must
// match line for line, but docs/conventions.md translates comments inside a
// code block, so comment text is set aside: trailing `# ...` / `// ...` is cut
// and comment-only lines are dropped rather than blanked, because re-wrapping
// a translated comment legitimately changes how many lines it takes. Blank
// lines go with them for the same reason. The trailing cut requires
// whitespace on both sides of the marker, which keeps component ids such as
// `button#Button` and `https://` URLs intact.
function comparableFenceLines(fence: Fence): string[] {
	// A mermaid fence is a diagram, and its labels are translated the way a
	// comment is. Every label is quoted (docs/conventions.md requires it), so
	// blanking the quoted text leaves the structure — node ids, arrows, direction
	// — which is what the two sides have to keep in step.
	if (fence.info === "mermaid") {
		return fence.body
			.map((line) => line.replace(/"[^"]*"/g, '""').trimEnd())
			.filter((line) => line !== "" && !/^\s*%%/.test(line));
	}
	return fence.body
		.map((line) => line.replace(/\s(#|\/\/)\s.*$/, "").trimEnd())
		.filter((line) => line !== "" && !/^\s*(#|\/\/|\/\*|\*)/.test(line));
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

// A GFM delimiter row: cells of `:?-+:?` separated by pipes, with the outer
// pipes optional. At least one pipe is required — without it the pattern would
// also match a thematic break or a setext underline.
function isDelimiterRow(line: string): boolean {
	const trimmed = line.trim();
	return (
		trimmed.includes("|") &&
		/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed)
	);
}

// Lines exempt from the width limit: front matter (VitePress reads it, humans
// do not), table rows (their width is the table's business), and fenced code.
function widthCheckedLines(text: string): Array<[number, string]> {
	const lines = text.split("\n");
	let start = 0;
	if (lines[0] === "---") {
		const close = lines.indexOf("---", 1);
		if (close !== -1) start = close + 1;
	}
	// First pass: which lines sit in a fence, marker lines included.
	const inFence = new Array<boolean>(lines.length).fill(false);
	let open: FenceMarker | null = null;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i] as string;
		if (open !== null) {
			inFence[i] = true;
			if (closesFence(open, line)) open = null;
			continue;
		}
		const marker = fenceMarker(line);
		if (marker !== null) {
			open = marker;
			inFence[i] = true;
		}
	}
	// Second pass: table blocks. GFM does not require the outer pipes, so a
	// `|`-prefix test alone misses `name | description` tables; the delimiter
	// row is what marks a table, exempting its header and every following row
	// that still carries a pipe.
	const inTable = new Array<boolean>(lines.length).fill(false);
	for (let i = start + 1; i < lines.length; i++) {
		if (inFence[i] || inFence[i - 1]) continue;
		if (!isDelimiterRow(lines[i] as string)) continue;
		if (!(lines[i - 1] as string).includes("|")) continue;
		inTable[i - 1] = true;
		inTable[i] = true;
		for (
			let j = i + 1;
			j < lines.length && !inFence[j] && (lines[j] as string).includes("|");
			j++
		) {
			inTable[j] = true;
		}
	}
	const out: Array<[number, string]> = [];
	for (let i = start; i < lines.length; i++) {
		const line = lines[i] as string;
		if (inFence[i] || inTable[i]) continue;
		if (line.trimStart().startsWith("|")) continue;
		out.push([i + 1, line]);
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
		// Heading text and table-row text are translated, so equal counts are
		// all the checker can hold them to; fence content is held to more below.
		const pairs: Array<[string, RegExp]> = [
			["headings", /^#+\s/gm],
			["table rows", /^\|/gm],
		];
		for (const [label, pattern] of pairs) {
			const a = count(pattern, prose.get(file.path) as string);
			const b = count(pattern, prose.get(twin) as string);
			if (a !== b) {
				errors.push(`${file.path} vs ${twin}: ${label} ${a} != ${b}`);
			}
		}
		const ours = fencedBlocks(raw.get(file.path) as string);
		const theirs = fencedBlocks(raw.get(twin) as string);
		if (ours.length !== theirs.length) {
			errors.push(
				`${file.path} vs ${twin}: fences ${ours.length} != ${theirs.length}`,
			);
			continue;
		}
		for (let i = 0; i < ours.length; i++) {
			const a = ours[i] as Fence;
			const b = theirs[i] as Fence;
			if (a.info !== b.info) {
				errors.push(
					`${file.path} vs ${twin}: fence ${i + 1} info "${a.info}" != "${b.info}"`,
				);
				continue;
			}
			const linesA = comparableFenceLines(a);
			const linesB = comparableFenceLines(b);
			for (let j = 0; j < Math.max(linesA.length, linesB.length); j++) {
				if (linesA[j] !== linesB[j]) {
					errors.push(
						`${file.path} vs ${twin}: fence ${i + 1} content "${linesA[j] ?? ""}" != "${linesB[j] ?? ""}"`,
					);
					break;
				}
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
