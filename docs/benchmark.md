# Benchmark

English | [日本語](./ja/benchmark.md)

What does an agent have to know to build a screen on a diverged design system — and what is
the smallest thing that carries it? One screen, four UI libraries, three host sizes, and one
variable per comparison: what the agent is allowed to see. 68 measured implementations,
2026-08-13/14, one run per cell, no repeats.

The harness — hosts, specs, scripts, arm prompts, and every generated screen — will be
published as a separate repository. The numbers were corrected once after an adversarial
review of the method found two scoring defects; the corrections and the review's findings
ship with the harness.

## Setup

A synthetic product layer of 20 components (an SNS timeline's worth: post cards, composer,
tabs, panels) was implemented four times, once per library — shadcn/ui (Radix 1.2.6),
MUI 9.3.1, Chakra UI 3.36.1, Mantine 9.5.1 — against one shared API contract, so the prop
signatures are identical across all four and the library is the only difference. The layer
diverges from each library the way grown products do: domain enums (`visibility`, `tone`),
a `density` scale instead of `size`, a `post: PostModel` object instead of loose props,
named slots instead of children, `onReplyPress` instead of `onClick`. A script verifies the
20 signatures match across every package; React 19.2.8 and TypeScript 6.0.3 come from one
workspace root.

Every arm was a Claude (Opus 5) agent with file read, grep, and shell tools — the same
model family that wrote the hosts and the scoring scripts. Each writes the same screen — a
timeline with four posts, a quote, media, and two sidebar panels — as one `.stories.tsx`,
from a spec that names the components and pins the data. No arm gets `node_modules`, so
none can iterate against the compiler; the first submitted file is scored with
`tsc --noEmit`, checked against the spec by script, and spot-checked in a rendering
Storybook.

## Five conditions

Type errors in the submitted story, at 20 components per host ("crashes" = the story also
throws at render). Every condition except the first was additionally run at larger sizes —
declarations and registry at 240, source conditions at 80 and 240 — and every such run
scored zero, so the table shows the one size where anything happens at all.

| Host | Spec only | + declarations | + registry | + source | source + registry |
| --- | --- | --- | --- | --- | --- |
| shadcn/ui | 36, crashes | 0 | 0 | 0 | 0 |
| MUI | 33, crashes | 0 | 0 | 0 | 0 |
| Chakra UI | 26 | 0 | 0 | 0 | 0 |
| Mantine | 24 | 0 | 0 | 0 | 0 |

*+ declarations* is the separate-repository case: the design system arrives as a compiled
package, and the agent reads the `.d.ts` files the way it would read `node_modules`.
*+ registry* is the isolation case — registry output and nothing else; rarer in practice,
but it is what pins down exactly which information mattered.

**What was missing was the API, and any carrier of it suffices.** The spec-only screens
have their *content* almost entirely right — the quote, the media, the visibilities, the
pinned counts all match the spec — and the API wrong, loudly, the same way on all four
libraries: children passed to a card that takes named slots, loose `replyCount` / `liked`
props where the component takes one `post` model, `onReply` for `onReplyPress`,
`timestamp` for `label`. The spec supplied the semantics; nothing supplied the API. Supply
it through any of the three carriers — the source, the declarations, or the registry — and
the same agent produces the same clean screen, at every size, without once picking one of
the near-miss components (`PostCardCompact`, `SearchBar`, …) the larger hosts planted:
zero near-miss picks across all twenty no-source runs.

**Every type-derived carrier shares one blind spot: rendering conventions.** MUI is the
one host whose `PostAuthorLine` renders the handle raw instead of prepending `@`, so the
correct data is `"@rin"` on MUI and `"rin"` everywhere else. All six source-reading MUI
arms got it right. The arms working from types alone mostly did not — registry-only missed
it in 2 of 3 MUI runs, declarations-only in 2 of 2. The screen compiles and reads
`Rin Amano rin`. Types say `handle: string`; what the component *does* with it lives only
in the source, a Story, or a screenshot. If your components encode conventions like this,
a type-level interface will not carry them — that is a real limit of the registry, and
equally of the `.d.ts` files a package ships.

**With the source in reach, the registry changes nothing.** Every source-visible cell is
zero at every size, and mistakes that compile are just as even: one near-miss pick per
twelve runs on each side (once having read both candidate files and been warned). Choosing
among similar names is judgement, and no lookup takes that over.

## What each carrier costs to read

Corpus sizes, not observed reads. Source full-read is an upper bound (an agent with grep
reads less); props-only is the matching lower bound (just the `*Props` interface blocks,
assuming the agent knows exactly where to look); declarations are the emitted `.d.ts`
files; registry is one full `component list` plus `component inspect` for the 18
components the screen uses.

| Components | Source, full read | Source, props only | Declarations | Registry |
| --- | ---: | ---: | ---: | ---: |
| 20 | 20–27KB | 5.5–6KB | 10.9–17.6KB | 12.5–16KB |
| 80 | 75–110KB | 21–27KB | 38.8–45.7KB | 22–25KB |
| 240 | 231–332KB | 64–80KB | 114–136KB | 44–49KB |

All curves are linear in host size; the registry's constant is the smallest. At 20
components everything is cheap and the registry buys nothing. At 240 it is a third of the
declarations a package would ship and under the targeted props-only read — the aggregated
listing replaces per-file discovery. The claim this table supports is deliberately modest:
same output as every other carrier, smallest read at design-system scale.

## The other two mechanisms

**Screen JSON validation.** On a static screen (the class the route exists for — this
timeline needs function props, which have no JSON form), both routes produced clean
stories on all four hosts, the JSON route converging in 2 rounds without any typechecker.
Its errors are precise — node-addressed, valid options listed — but two caveats matter.
Everything caught was the format's own friction (a missing `schemaVersion`); and the
validator's own final output states that `json`-kind props are written into the story
unchecked, which on this screen is where the semantics live. The loop works as a
mechanism; this experiment could not show its semantic layer catching anything, because
`component inspect` upstream had already prevented the mistakes it exists to catch.

**Implementation handoff.** From an approved Story to a page with real state, with and
without `story import` + `screen context`: both sides zero errors and full wiring — a tie
that is partly by construction, since the spec enumerated the wiring. The census that
matters more: 21 of the 24 approved stories in this benchmark are `component` + `args`
CSF, which `story import` cannot read (`STORY_NOT_FOUND`; the documented fallback is
reading the Story as text). It reads `render`-style stories — the style its own generator
emits — and on those recovered the tree faithfully (28 nodes, 7 fixtures).

## What this does not show

- The hosts are synthetic and the divergence recipe is a dial: the spec-only error count
  is a function of how many renames the recipe applied. The recipe is published with the
  harness; read that column as "what this much divergence produces", not a constant.
- One run per cell, no repeats. The silent-error rates (1–2 findings per 12 runs) are
  exactly the regime where a single further run could move any cell.
- The spec names every component and pins the data, so no arm ever had to decide *which*
  components to use — the discovery and curation half of the workflow, where the registry's
  Story-based recommendations would matter, is unmeasured.
- The declarations condition used `.d.ts` emitted from these hosts, which carry the same
  JSDoc the registry reads. A package built without declaration-level JSDoc would be a
  darker condition than measured here.
- 240 components is an order of magnitude below the largest design systems, and the
  near-miss families are 20 names out of 220.
- The same model family wrote the hosts, the filler, every screen, and the scoring
  scripts; the semantic checks are regex-level plus targeted hand-checks, not a full human
  review.

Extraction quality on real code — the props-from-types rate, barrel-import conventions,
the patterns that do not extract — is a different question with a different measurement, on
a production design system: [Component Registry](./registry.md).
