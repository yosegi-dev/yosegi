// Fuzzy matching used to attach "did you mean" candidates to validation errors.
//
// Since the Screen JSON is hand-written by an agent, misspellings of component ids
// and prop names happen routinely. We want the next move to be decidable from the
// error message alone, so this returns names that actually exist in the Registry as
// candidates.

// Upper limit on the number of candidates listed for a single error. Too many and
// the reader can't tell which one to pick.
const MAX_SUGGESTIONS = 3;

// Edit distance (OSA variant of Damerau-Levenshtein). Counts a transposition of two
// adjacent characters as a single operation. Plain Levenshtein would put "titel" →
// "title" at distance 2, dropping the most common kind of typo from the candidates.
//
// This is an exhaustive comparison of candidate count × id length, but since the
// Registry is on the order of a few hundred entries with short ids, an
// implementation reusing 3 rows of buffer is fast enough.
function editDistance(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0 || b.length === 0) {
		return Math.max(a.length, b.length);
	}
	let beforePrevious = new Array<number>(b.length + 1);
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current = new Array<number>(b.length + 1);
	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, beforePrevious[j - 2] + cost);
			}
			current[j] = value;
		}
		// Shift the rows by one. The now-unused beforePrevious buffer is recycled into current.
		[beforePrevious, previous, current] = [previous, current, beforePrevious];
	}
	return previous[b.length];
}

// The tail of a component id (the exportName part of `<modulePath>#<exportName>`).
// Used to catch the mistake of an agent writing just the export name instead of the
// full id.
function tail(value: string): string {
	return value.split("#").at(-1) ?? value;
}

// The allowed edit distance. Shorter names need a stricter threshold, or unrelated
// candidates start showing up.
function maxDistance(value: string): number {
	return Math.max(1, Math.min(5, Math.floor(value.length / 4)));
}

// The distance between input and candidate. Measured against both the full id and
// the exportName part, returning the minimum of whichever falls within the
// threshold. null (not a candidate) if both fall outside it.
function score(input: string, candidate: string): number | null {
	const pairs: [string, string][] = [
		[input, candidate],
		[tail(input), tail(candidate)],
	];
	let best: number | null = null;
	for (const [a, b] of pairs) {
		const distance = editDistance(a.toLowerCase(), b.toLowerCase());
		if (distance <= maxDistance(a) && (best === null || distance < best)) {
			best = distance;
		}
	}
	return best;
}

// Returns up to limit candidates close to input, closest first.
export function suggestSimilar(
	input: string,
	candidates: Iterable<string>,
	limit: number = MAX_SUGGESTIONS,
): string[] {
	const scored: { candidate: string; distance: number }[] = [];
	for (const candidate of candidates) {
		if (candidate === input) {
			continue;
		}
		const distance = score(input, candidate);
		if (distance !== null) {
			scored.push({ candidate, distance });
		}
	}
	return scored
		.sort(
			(a, b) =>
				a.distance - b.distance || a.candidate.localeCompare(b.candidate),
		)
		.slice(0, limit)
		.map((entry) => entry.candidate);
}

// Suggestion text for a validation error. Returns undefined when there are no
// candidates, so the caller can omit the suggestion entirely.
export function didYouMean(
	input: string,
	candidates: Iterable<string>,
): string | undefined {
	const matches = suggestSimilar(input, candidates);
	return matches.length > 0
		? `Did you mean: ${matches.join(", ")}?`
		: undefined;
}
