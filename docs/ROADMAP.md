# Yosegi — Roadmap

English | [日本語](./ja/ROADMAP.md)

What is planned, and what is still undecided. For what Yosegi does today, start from
[`README.md`](../README.md); for how the Component Registry works, see
[Component Registry](./registry.md).

## Registry extraction

### Rescue the props the extractor cannot read today

Two kinds of component come back with only `className` / `children`: a value cast to an overloaded
call signature type, and re-exports of third-party components. Reading the first parameter of the
call signature directly through the TypeChecker should recover them.

The cost is that it partially reimplements react-docgen-typescript's type conversion (JSDoc,
`defaultValue`, and `required` resolution), leaving two extraction paths that can disagree. So the
bar is a design where the direct read fills in gaps rather than running as a parallel extractor. The
workaround in the meantime is `--metadata`, which `component inspect` points you at.

### Make `required` usable on union props types

`required` is currently dropped across the board when a component's props type is a union, because
react-docgen-typescript's determination is unreliable there and a false positive rejects a correct
screen. Resolving the union through the TypeChecker and marking a prop required only when every
branch requires it would recover the missed cases without reintroducing false positives.

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
supporting 7 — or being replaced, which the extractor rescue above already contemplates. Until then
the cap stays, and widening it is a regression rather than an upgrade.

## Reach of the adapters

`registry build --source` and `story import` exist only in the CLI, so an agent working through MCP
has to drop down to the CLI just to build the registry or read a Story back. Either they come to
MCP / HTTP, or CLI-only becomes the stated contract and the Skill says so explicitly. Today the
Skill says so, which works but leaves the adapters uneven.

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
