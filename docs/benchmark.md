# Benchmark

English | [日本語](./ja/benchmark.md)

Does the registry change what an agent writes? One screen, four UI libraries, three host
sizes, and one variable per comparison: what the agent is allowed to see. 60 measured
implementations — 36 across the visibility conditions and sizes, 12 registry-only, 8 on the
Screen JSON route, 4 on the implementation handoff — measured 2026-08-13/14, one run per
cell, no repeats.

The harness — hosts, specs, scripts, arm prompts, and every generated screen — will be
published as a separate repository. The numbers were once corrected after an adversarial
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

## Four conditions

Type errors in the submitted story, at 20 components per host ("crashes" = the story also
throws at render). The registry-only and source conditions were additionally run at 80 and
240 components; every such run scored zero, so the table shows the size where anything
happens at all.

| Host | Spec only | Spec + registry | Spec + source | Source + registry |
| --- | --- | --- | --- | --- |
| shadcn/ui | 36, crashes | 0 | 0 | 0 |
| MUI | 33, crashes | 0 | 0 | 0 |
| Chakra UI | 26 | 0 | 0 | 0 |
| Mantine | 24 | 0 | 0 | 0 |

Two comparisons live in this grid, and they say different things.

**Against no information, the registry supplies the API — which is the thing missing.**
The spec-only condition is not how anyone works; it isolates what the registry adds when
nothing else is present. Re-examining those screens shows their *content* is almost
entirely right — the quote, the media, the visibilities, the pinned counts all match the
spec — and the API is wrong, loudly, the same way on all four libraries: children passed
to a card that takes named slots, loose `replyCount` / `liked` props where the component
takes one `post` model, `onReply` for `onReplyPress`, `timestamp` for `label`. The spec
supplied the semantics; nothing supplied the API. The registry is that missing half:
12.5–16KB of `component list` and `component inspect` output takes the same condition to
zero on all four libraries — and to zero again at 80 and 240 components, where the hosts
deliberately contain near-miss names like `PostCardCompact` and `SearchBar` that shadow
real components with different props. Across twelve registry-only runs, no near-miss was
ever picked. That is the condition an agent is in when it works over MCP against a
repository it has no checkout of, or keeps a large host out of its context window.

**Against a source-reading agent, the registry changes nothing.** Every source-visible
cell is zero at every size. Mistakes that compile are just as even: across twelve runs per
side, the source arm picked a near-miss once (`SearchBar` for the `SearchField` — having
read both files and been warned), the registry-assisted arm picked one once
(`IconActionButton` for the `NotificationBell`). Both slots are `ReactNode`; both compile.
Choosing among similar names is judgement, and no lookup takes that over.

**The registry's blind spot is rendering conventions.** MUI is the one host whose
`PostAuthorLine` renders the handle raw instead of prepending `@`, so the correct data is
`"@rin"` on MUI and `"rin"` everywhere else. All six source-reading MUI arms got it right.
Of the three registry-only MUI arms, two shipped a screen that reads `Rin Amano rin` — the
registry says `handle: string` and cannot say what the component does with it. Compiles,
looks wrong, and is the one defect class the no-source condition produced (2 findings in
12 runs). A fact like this lives in the source, a Story, or a screenshot; the registry
does not carry it.

## What the registry costs to consult

Correctness ties whenever the source is readable, so the difference is the reading. These
are corpus sizes, not observed reads — three honest columns: the full component directory
(upper bound; an agent with grep reads less), the `*Props` interface blocks alone (lower
bound; assumes the agent already knows exactly where to look), and the registry (one full
`component list` plus `component inspect` for the 18 components the screen uses).

| Components | Source, full read | Source, props only | Registry |
| --- | ---: | ---: | ---: |
| 20 | 20–27KB | 5.5–6KB | 12.5–16KB |
| 80 | 75–110KB | 21–27KB | 22–25KB |
| 240 | 231–332KB | 64–80KB | 44–49KB |

Both curves are linear in host size; the registry has a smaller constant, not a better
growth rate. Against the targeted lower bound it reads more at 20 components, breaks even
at 80, and reads about two-thirds as much at 240. The honest cost claim is modest — a
third to a fifth of a full read at design-system scale — and the stronger form is the
condition above: the host source an agent needs can be zero, at the price of the
rendering-convention blind spot.

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
  components to use — the discovery and curation half of the workflow is unmeasured.
- 240 components is an order of magnitude below the largest design systems, and the
  near-miss families are 20 names out of 220.
- The same model family wrote the hosts, the filler, every screen, and the scoring
  scripts; the semantic checks are regex-level plus targeted hand-checks, not a full human
  review.

Extraction quality on real code — the props-from-types rate, barrel-import conventions,
the patterns that do not extract — is a different question with a different measurement, on
a production design system: [Component Registry](./registry.md).
