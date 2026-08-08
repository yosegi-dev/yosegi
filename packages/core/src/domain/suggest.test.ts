import { describe, expect, it } from "bun:test";
import { didYouMean, suggestSimilar } from "./suggest.ts";

const REGISTRY_IDS = [
	"app/components/shadcn-ui/button#Button",
	"app/components/shadcn-ui/alert#Alert",
	"app/components/shadcn-ui/alert#AlertTitle",
	"app/components/shadcn-ui/alert#AlertDescription",
	"app/components/typography#Heading",
];

describe("suggestSimilar", () => {
	it("catches a misspelled id", () => {
		expect(
			suggestSimilar("app/components/shadcn-ui/buton#Button", REGISTRY_IDS),
		).toEqual(["app/components/shadcn-ui/button#Button"]);
	});

	// Agents actually do mistakenly write just the export name instead of the full
	// id, so a match on the exportName part alone is also surfaced as a candidate.
	it("returns the full id when only the export name was written", () => {
		expect(suggestSimilar("Button", REGISTRY_IDS)).toEqual([
			"app/components/shadcn-ui/button#Button",
		]);
	});

	it("also catches a misspelled export name", () => {
		expect(suggestSimilar("AlertTitel", REGISTRY_IDS)).toEqual([
			"app/components/shadcn-ui/alert#AlertTitle",
		]);
	});

	it("close candidates are ordered by edit distance", () => {
		const matches = suggestSimilar("Alert", REGISTRY_IDS);
		expect(matches[0]).toBe("app/components/shadcn-ui/alert#Alert");
	});

	// Transposing two adjacent characters is a classic typo, so it's counted as a single operation.
	it("catches an adjacent character transposition as a single operation", () => {
		expect(suggestSimilar("Heaidng", REGISTRY_IDS)).toEqual([
			"app/components/typography#Heading",
		]);
	});

	it("gives no candidates for unrelated input", () => {
		expect(suggestSimilar("DataGridToolbar", REGISTRY_IDS)).toEqual([]);
	});

	it("does not return a candidate identical to the input", () => {
		expect(
			suggestSimilar("app/components/typography#Heading", REGISTRY_IDS),
		).not.toContain("app/components/typography#Heading");
	});

	it("caps candidates at limit", () => {
		const candidates = ["variant", "variants", "varianty", "variance"];
		expect(suggestSimilar("variantt", candidates, 2)).toHaveLength(2);
	});

	// Loosening the edit distance threshold for short names lets unrelated candidates
	// through, so it's scaled with length instead.
	it("does not treat a 2-character difference as a candidate for a short name", () => {
		expect(suggestSimilar("as", ["is", "at", "size"])).toEqual(["at", "is"]);
	});
});

describe("didYouMean", () => {
	it("returns suggestion text when a candidate exists", () => {
		expect(didYouMean("Buton", REGISTRY_IDS)).toBe(
			"Did you mean: app/components/shadcn-ui/button#Button?",
		);
	});

	it("returns undefined when there is no candidate", () => {
		expect(didYouMean("DataGridToolbar", REGISTRY_IDS)).toBeUndefined();
	});
});
