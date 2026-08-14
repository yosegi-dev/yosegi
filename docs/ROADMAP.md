# Yosegi — Roadmap

English | [日本語](./ja/ROADMAP.md)

What is planned, and what is still undecided. For what Yosegi does today, start from
[`README.md`](../README.md); for how the Component Registry works, see
[Component Registry](./registry.md).

## Registry extraction

### Put type extraction behind a replaceable interface

Two kinds of component come back with only `className` / `children`: a value cast to an overloaded
call signature type, and re-exports of third-party components. Reading the first parameter of the
call signature directly through the TypeChecker should recover them.

The earlier plan was to run that direct read alongside react-docgen-typescript, and its cost never
moved: it partially reimplements the type conversion (JSDoc, `defaultValue`, and `required`
resolution), leaving two extraction paths that can disagree. The revised direction is to make
extraction itself replaceable — an interface `registry build --source` programs against, with
react-docgen-typescript as the default implementation and the TypeChecker direct read as an
alternative one. One implementation owns the answer at a time, so the disagreement problem
dissolves structurally instead of needing a "fill in gaps only" rule.

The interface is also a hedge on the ecosystem. react-docgen-typescript has gone quiet — at the
time of writing its last release dates from mid-2025 — while TypeScript 7.1's replacement compiler
API is still published as `typescript/unstable/*`, and Storybook appears to be building a Volar /
language-server replacement for its docgen (React Component Meta, experimental as of
Storybook 10.4). Which of those settles first is not something Yosegi controls; a swappable
extractor is what keeps each of them adoptable without another rewrite. The workaround in the
meantime is unchanged: `--metadata`, which `component inspect` points you at.

### Make `required` usable on union props types

`required` is currently dropped across the board when a component's props type is a union, because
react-docgen-typescript's determination is unreliable there and a false positive rejects a correct
screen. Resolving the union through the TypeChecker and marking a prop required only when every
branch requires it would recover the missed cases without reintroducing false positives.

### Extract usage examples from Stories

The registry answers "what props exist" and deliberately nothing else:
[`workflows.md`](./workflows.md) states that the screen's skeleton and composition idiom —
wrappers, hook calls, host-specific meta — come from the host's own Stories and templates, not the
registry. Today an agent follows `curation.storyFile` and reads the Story by hand.

The pieces to shorten that already exist: the manifest records `storyFile` / `storyNames`, and
`story import` already parses Story source through the TypeScript AST. A command that extracts a
Story's `args` and `render` for a named component and returns them as a usage example is the
planned next step. The honest limit: today the importer reads only `render`-style Stories — a
`component` + `args` Story, the dominant hand-written shape, comes back as `STORY_NOT_FOUND` — so
the extractor has to read `args` itself, and its output is an excerpt to read, not a tree to
build on — which is all a usage example needs to be.

## Registry operations

### Let CI gate on `registry status`

`registry status` reports `source: current` / `stale` / `unknown`, but only as text — a pipeline
cannot fail on it without parsing. An `--exit-code` flag (non-zero on `stale`) would make staleness
a CI gate: the registry gets committed, and the check stops a source change from drifting past it.

Committing the registry is also what exposes the provenance problem: `builtWithCliPath` is an
absolute path captured from the running process, and the recorded `inputs` keep flags exactly as
typed, absolute paths included. Shared across machines, both turn into noise. Separating
machine-local fields from shareable ones — or recording paths relative to the project root — is a
precondition for treating a committed registry as canonical.

## Runtime and packaging

### Make `@yosegi/core` free of the filesystem

`FileScreenRepository` in `packages/core` is the one thing tying core to `node:fs`. Splitting it out
into a `@yosegi/core/node` subpath would leave core usable in browser and Workers environments.

### Stay on TypeScript 6.x until 7.1 ships an API

`typescript` is capped at `<7` on purpose. TypeScript 7.0 ships no compiler API —
`require("typescript")` returns `{ version, versionMajorMinor }` and nothing else — and both
`source-registry.ts` and `react-docgen-typescript` are built on the 6.x API. A host on 7 keeps that
API through the compatibility package, which is what [`registry.md`](./registry.md) tells them to
install.

7.1 is expected to introduce a new and different API, published today as `typescript/unstable/*`
(`unstable/sync` for `Program` / `Checker`, `unstable/ast` for the node helpers). Migrating to it
needs two things that are not true yet: the API leaving `unstable`, and `react-docgen-typescript`
supporting 7 — or being swapped out behind the extraction interface above. Until then the cap
stays, and widening it is a regression rather than an upgrade.

## The Story round trip

### Read the component target back

`story import` reads Stories only, so a file `screen generate --target component` wrote cannot be
read back into Screen JSON — [`workflows.md`](./workflows.md) documents the asymmetry and the
workaround (keep the Screen JSON if the screen may be revised later). The importer is already split
into a CSF-specific half (find the meta, select a Story export) and a generic JSX → ScreenNode
conversion, so closing the gap is a component-file variant of the first half: locate the exported
functions, feed the JSX they return to the same conversion. Until then the asymmetry stays
documented rather than fixed.

### Smaller follow-ups on fixtures, variants, and `each`

Three extensions were deliberately left out of the first versions.

- Fixtures are not checked against the props they are bound to: a string fixture bound to a
  number-kind prop validates clean and fails only in the host's type check. Matching the fixture
  value against the manifest's prop kind would catch it where every other shape error is caught.
- A variant shares the base Story's meta wholesale. Per-variant `parameters` / `tags` would let a
  loading state opt out of an a11y check, or tag an empty state for a test runner, without leaving
  Screen JSON.
- `each` declares an iteration variable that nothing resolves: with `each: "customer in customers"`
  a binding on `customer.name` is not recognized as backed by the `customers` fixture, so it warns
  as if the name came from nowhere. Scoping the variable over the node's subtree would make the
  natural way of writing a list validate clean.

## Reach of the adapters

The read side has mostly converged: `list_categories` and `get_registry_status` are MCP tools now,
though `get_registry_status` reports provenance only — recomputing source drift stays a CLI
concern. What remains CLI-only is `registry build --source` and `story import`, so an agent working
through MCP still drops down to the CLI to build the registry or read a Story back. Either those
two come to MCP / HTTP, or CLI-only becomes the stated contract; today the Skill says so
explicitly, which works but leaves the adapters uneven.

## Open design questions

### How far to widen the shape of the output

The file shape is settled: one module carrying one export per screen state — Story exports on the
CSF target, exported functions on the component target (`screen generate --target component`, which
covers hosts without Storybook). Both targets render every state from the same tree plus its diff,
through the shared renderer (`render.ts`).

What stays open is the component boundary. Screen JSON carries no information about "this is a
reusable unit", so the component target emits a single self-contained component with every mock
value internal and no props lifted out.

- Upside of going further: lifting props (expressing what gets passed in from outside) would let
  the generated code move into the application as-is, and a thin Story rendering the component
  would match the shape of the host's other Stories.
- Question: where to draw the boundary. Emitting two files also deepens how much Yosegi reaches
  into the host's file layout conventions.
- A single file with no lifted props stays the default until Screen JSON can express boundaries.

### How curation should be used

`curation.recommended` looks at nothing but "does a Story exist". The registry also lists plenty of
components that have no Story, so we need a policy on how far agents may go in using them. Using it
for the default ordering and filtering of `component list` is the obvious line.

### Migrating component ids in saved screens

A screen saved under `<data-dir>/screens/` stores the component ids that were current when it was
written. Registries built from `--source` use `<module path>#<exportName>`, while `--index` on its
own produces short ids (`Button`). The two are not interchangeable, so a screen saved against one
cannot be revalidated against the other. Nothing migrates or aliases them today. Before saved
screens carry anything worth keeping, this needs either a migration step or id aliasing.

### Whether Yosegi should confirm the Story actually renders

`screen generate` ends at a file. Whether the Story then shows up in the host's Storybook — the
title resolves, the imports build, nothing throws on render — is confirmed today by the host's type
check and by a human looking. A machine check has an obvious first rung, the Story appearing in a
rebuilt `index.json`, and a much steeper second one: brokering screenshot or a11y checks through
the host's own Storybook (its test runner, its addons). The second rung strains the founding line
that Yosegi has no rendering environment of its own — brokering is not owning one, but the boundary
needs drawing before any of it is built.

### What a screen diff would compare

An approved mock and the implementation built from it drift apart silently. A structural diff —
the approved Screen JSON on one side, the current tree on the other — would name what changed
(a removed node, a changed prop) rather than leaving it to review. The open half is the right-hand
side: the implementation is not a Story, so what to read it back through (the component-target
importer above, once it exists?) decides whether the diff is possible at all.

### Whether design tokens belong in the registry

`className` is free-form today: any string passes validation, and a token the host's CSS does not
define fails silently in review. Extracting the host's tokens into the registry would make
`className` checkable the way an enum prop already is. The sticking point is that tokens have no
single source — a Tailwind config, CSS variables, a CSS-in-JS theme — so the registry would be
taking a dependency on the host's CSS dialect, which is a bigger commitment than reading its
TypeScript.
