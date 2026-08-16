# Yosegi — Roadmap

English | [日本語](./ja/ROADMAP.md)

What is planned, and what is still undecided. For what Yosegi does today, start from
[`README.md`](../README.md); for how the Component Registry works, see
[Component Registry](./registry.md).

## Planned work

In priority order. Where an item waits on another, its own paragraph says so.

### 1. Scope `each`'s iteration variable

`each` declares an iteration variable that nothing resolves. Written the natural way —
`each: "customer in customers"` on a node binding `customer.name` — a correct list comes back with
two warnings it cannot act on: `BOUND_REQUIRED_PROP`, because `customer.name` is read as coming from
nowhere, and `UNUSED_FIXTURE`, because nothing is seen referencing `customers`. Noise on correct
input is the worst thing that can happen to the signal an agent self-corrects from, which puts this
first. Scoping the variable over the node's subtree clears both.

### 2. Check fixture values against the prop's kind

Fixtures are not checked against the props they are bound to: a string fixture bound to a
number-kind prop validates clean and fails only in the host's type check. Matching the fixture value
against the manifest's prop kind would catch it where every other shape error is caught.

### 3. Extract usage examples from Stories

The registry answers "what props exist" and deliberately nothing else:
[`workflows.md`](./workflows.md) states that the screen's skeleton and composition idiom —
wrappers, hook calls, host-specific meta — come from the host's own Stories and templates, not the
registry. Today an agent follows `curation.storyFile` and reads the Story by hand.

The pieces to shorten that already exist: the manifest records `storyFile` / `storyNames`, and
`story import` already parses Story source through the TypeScript AST. A command that extracts a
Story's `args` and `render` for a named component and returns them as a usage example is the
planned next step. The honest limit: today the importer reads only `render`-style Stories, so a
`component` + `args` Story — the dominant hand-written shape — comes back as `STORY_NOT_FOUND`
without `--story-name` and as `RENDER_NOT_STATIC` with it. The extractor therefore has to read
`args` itself, and its output is an excerpt to read, not a tree to build on — which is all a usage
example needs to be.

### 4. Read Storybook's component manifest as a third input

Storybook 10.5's `storybook build` writes a component manifest (`/manifests/components.json`) that
carries, per component, the `import` statement, `jsDocTags`, `subcomponents`, and for each Story an
id, a name, and a `snippet` of its source. Taking it as a third `registry build` input beside
`--index` and `--source` would hand the registry usage examples without Yosegi parsing a Story
itself, and would back the claim that Yosegi complements Storybook with an implementation rather
than a paragraph.

How it is wired in is the design, not what it yields. Storybook states plainly that the manifest
schema is not a public API while it is in preview, so adopting it means an opt-in flag, an explicit
check of the manifest's version, and a fallback to what `index.json` alone gives (curation and
nothing else) when the shape is not the expected one. Without that layer, a Storybook release moves
Yosegi's registry output.

It stands beside item 3 rather than replacing it: where the manifest is available most of 3 becomes
unnecessary, and where it is not — an older Storybook, or manifests turned off — 3's own extraction
is what remains.

### 5. A host configuration file (`yosegi.config.json`)

Everything a host tells Yosegi is a CLI flag — `--source`, `--tsconfig`, `--data-dir`, `--metadata`,
`--import-map`, `--meta-template` — and there is nowhere to keep any of it, so every command
restates the set. The skill spends one of its numbered steps on "fix a `--data-dir` now and pass the
same one to every command", because the default follows the cwd. That warning is the symptom; the
problem is that settings have no home.

One `yosegi.config.json`, found by searching upward from the cwd, is the plan. Paths written in it
resolve against the config's own location rather than the cwd, which removes the cwd dependence
structurally instead of by reminder. Precedence is CLI flag > config > default, so every invocation
that works today keeps working.

The sections it would carry are `dataDir`, `registry` (`source`, `tsconfig`, `metadata`), `emit`
(`importMap`, `metaTemplate`), and `examples` — where the next item's catalog lives, since a second
declaration file would put the host back to keeping two of them in step. The format is JSON, and
editor completion needs nothing beyond shipping a `$schema`.

### 6. Example templates: catalog and replication

A host's finished screens are the best starting point for its next one, and nothing today lets an
agent start from them. The plan is a catalog of host-written templates — real, renderable TSX, state
management and table logic included — and replication in the shadcn sense, copy-and-own.
`example list` presents the catalog; `example apply` copies a template to where the new screen
goes, rewrites the component identifiers, leaves a comment naming what it came from, and reports the
template's imports and where its inline mock data sits — the places the editing goes next.

The catalog is a declaration the host writes, in the `examples` section of the config file above:
per entry a key, a label, a description, a `templatePath`, and a `componentName`. A Story under a
title namespace (`Examples/*`) doubles as the preview, which leaves room to detect entries
mechanically through the same `storyFile` that curation already reads. The PoC reads that
declaration from `--catalog <path>` or from `<data-dir>/examples.json`; moving it onto the config
file is what is left.

What it buys is correctness by construction. A new screen's skeleton, its state management, and the
design system's idioms are inherited from reviewed code rather than generated from nothing, so the
agent's work stays a diff and review only has to read the diff. That is the counterpart to items 1
and 2, which work the other side — correctness by validation.

The substrate is a real file rather than Screen JSON, and deliberately so: most of a template's
value sits in what Screen JSON does not express — state, logic, event wiring. Screen JSON keeps its
own job, the machine-checkable static mock. Preview stays with the host's Storybook, so the founding
line holds: Yosegi still has no rendering environment of its own.

A host has already proved the flow with hand-written templates and a replication script of its own.
Generalizing that is this item, and the PoC is implemented: `list` against a catalog of eleven of
that host's templates, `apply` on three of them — one of them several hundred lines — with every
copy passing the host's type check and lint unedited.

### 7. Let CI gate on `registry status`

`registry status` reports `source: current` / `stale` / `unknown`, but only as text — a pipeline
cannot fail on it without parsing. An `--exit-code` flag (non-zero on `stale`) would make staleness
a CI gate: the registry gets committed, and the check stops a source change from drifting past it.

Committing the registry is also what exposes the provenance problem: `builtWithCliPath` is an
absolute path captured from the running process, and the recorded `inputs` keep flags exactly as
typed, absolute paths included. Shared across machines, both turn into noise. Separating
machine-local fields from shareable ones — or recording paths relative to the project root — is a
precondition for treating a committed registry as canonical.

### 8. Apply curation to the default ordering

`curation.recommended` looks at nothing but "does a Story exist". The registry also lists plenty of
components that have no Story, so we need a policy on how far agents may go in using them. Using it
for the default ordering and filtering of `component list` is the obvious line.

The constraint to design around: only a `--source` registry decides `recommended` per component. A
registry built from `index.json` alone sets it to `true` on everything, since every entry in the
index has a Story by construction — on that path the field is a constant and orders nothing.

### 9. Put type extraction behind a replaceable interface

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

Making `required` usable on union props types belongs to the same work. `required` is dropped across
the board when a component's props type is a union, because react-docgen-typescript's determination
is unreliable there and a false positive rejects a correct screen. Resolving the union and marking a
prop required only when every branch requires it needs the same TypeChecker read and touches the
same functions, so it is not a separate decision.

The interface is also a hedge on the ecosystem, and that is what makes this the most urgent item
here despite sitting mid-list by value. react-docgen-typescript has gone quiet: its last release is
2.4.0 from June 2025, its default branch has had no commit since, and the report that it crashes on
TypeScript 7 (issue #538) is still open. Storybook is building a replacement — React Component Meta,
wired into manifest generation as `experimentalDocgenServer` in Storybook 10.5, which Storybook says
it will standardize on for both MCP and Docs once it stabilizes — but it ships no standalone npm
package, so today it is not something to depend on. A swappable extractor is what keeps each of them
adoptable without another rewrite. The workaround in the meantime is unchanged: `--metadata`, which
`component inspect` points you at.

### 10. Read the component target back

`story import` reads Stories only, so a file `screen generate --target component` wrote cannot be
read back into Screen JSON — [`workflows.md`](./workflows.md) documents the asymmetry and the
workaround (keep the Screen JSON if the screen may be revised later). The importer is already split
into a CSF-specific half (find the meta, select a Story export) and a generic JSX → ScreenNode
conversion, so closing the gap is a component-file variant of the first half: locate the exported
functions, feed the JSX they return to the same conversion. Until then the asymmetry stays
documented rather than fixed.

### 11. What a screen diff would compare

An approved mock and the implementation built from it drift apart silently. A structural diff —
the approved Screen JSON on one side, the current tree on the other — would name what changed
(a removed node, a changed prop) rather than leaving it to review. The open half is the right-hand
side: the implementation is not a Story, so what to read it back through (the component-target
importer above, once it exists?) decides whether the diff is possible at all.

### 12. A migration strategy for saved screens

A screen saved under `<data-dir>/screens/` is pinned to two things that can move under it, and both
need an answer before saved screens hold anything worth keeping.

Component ids are the first. Registries built from `--source` use `<module path>#<exportName>`,
while `--index` on its own produces short ids (`Button`). The two are not interchangeable, so a
screen saved against one cannot be revalidated against the other, and nothing migrates or aliases
them today.

`schemaVersion` is the second. The parser takes it as a hard literal (`z.literal("1.0")`) with no
branch that accepts an older document and promotes it, so raising the version would reject every
saved screen and every hand-written Screen JSON with `INVALID_REQUEST`. Pre-1.0 versioning permits
that breaking change, which is exactly why the release taking it needs a path across both axes
rather than one.

### 13. How far to widen the shape of the output

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

### 14. Confirm the Story appears in a rebuilt index

`screen generate` ends at a file. Whether the Story then shows up in the host's Storybook — the
title resolves, the imports build, nothing throws on render — is confirmed today by the host's type
check and by a human looking. The first rung of a machine check is cheap, because the pieces are
already here: the CLI reads an `index.json` from a path or from a running dev server's URL, and
`registry status` already reasons about how fresh that index is. Checking that a generated Story
appears in a rebuilt index reuses both. The rung above that one is a non-goal; see below.

## Runtime and packaging

### Stay on TypeScript 6.x while the compiler API is out of reach

`typescript` is capped at `<7` on purpose. TypeScript 7.0 went GA on 2026-07-08 and is npm's
`latest`, so a new host lands on it by default — and it ships no compiler API:
`require("typescript")` returns `{ version, versionMajorMinor }` and nothing else, while both
`source-registry.ts` and `react-docgen-typescript` are built on the 6.x API. A host on 7 keeps that
API through the compatibility package, which is what [`registry.md`](./registry.md) tells them to
install.

The replacement API is published as `typescript/unstable/*` (`unstable/sync` for `Program` /
`Checker`, `unstable/ast` for the node helpers). The 7.1 iteration plan
(microsoft/TypeScript#63703; beta 2026-09-09, RC 2026-10-20, stable 2026-11-10) names three APIs to
stabilize — Content Mapper, Emit, and Language Service — and `Program` / `Checker`, which is what
Yosegi and react-docgen-typescript actually need, is not among them. 7.1 is therefore a date to
re-evaluate on, not a date the cap comes off.

That the Language Service stabilizes first is itself an argument for the extraction interface above:
an implementation built on it is reachable sooner than one built on the Checker.

### Keep `typescript` a `dependency`, not a peer dependency

`packages/server` declares `typescript` as a `dependency` at `>=5.4.0 <7`, and it stays there. A
peer dependency was the direction until it was installed for real on 2026-08-16, against npm 11,
pnpm 10, and bun 1.3. The nested 6.x copy under a host on 7 is the accepted cost.

The premise that decided it holds, and buys nothing. A `typescript` name provided by the host's
`typescript@npm:@typescript/typescript6` alias does unify with a declared range and with a peer
requirement, on npm and pnpm, without a warning — but `@typescript/typescript6` is a 10KB shim that
pulls the real compiler in through `@typescript/old: npm:typescript@^6`, so the ~24MB arrives either
way.

What it costs is real. A host on plain 7 with no alias fails `npm install` with `ERESOLVE`, which an
optional peer does not avoid; pnpm and bun install and then fail the first time a command reaches
the compiler. That same host works today under `dependencies` — pnpm's isolated layout gives Yosegi
its own 6.x — so the change breaks a host that currently runs.

The lazy load this was to be revisited after has landed. Every module that reads the host's types
imports the namespace with `import type` and calls `loadTypeScript()`, so a missing compiler API
raises the fix-it message `docgen.ts` prints rather than a bare `TypeError`. That improved the
failure, not the verdict: the `ERESOLVE` and the pnpm host that runs today are what decided this,
and both stand.

### `@yosegi/core` and the filesystem

`FileScreenRepository` is the one thing tying core to `node:fs`, and splitting it into a
`@yosegi/core/node` subpath would leave core usable in browser and Workers environments. No consumer
is waiting on that, so it is packaging to revisit when embedding the HTTP app becomes a supported
use case, not work to schedule now.

## Open questions

### What the HTTP adapter is for

The adapters are nested rather than uneven: CLI ⊃ MCP ⊃ HTTP. What MCP lacks is settled — building
the registry, scaffolding metadata, reading a Story back, and the source-drift half of
`registry status` are CLI-only by contract, and the skill's CLI reference says so. HTTP is the wider
gap: it exposes health, registry, components, screens, operations, duplicate, validate, and
implementation context, and no generation endpoint at all.

The question is not how to close that gap but whether to. The HTTP adapter has no documented
consumer, while `hono` is a required dependency every user installs. Either it earns a use case
worth that dependency, or it stops being part of the published surface.

## Not goals

### Design tokens in the registry

`className` stays free-form: any string passes validation, and a token the host's CSS does not
define fails silently in review. Extracting the host's tokens into the registry would make it
checkable the way an enum prop already is, but tokens have no single source — a Tailwind config, CSS
variables, a CSS-in-JS theme — so the registry would take on a dependency on the host's CSS dialect.
That is a far larger commitment than reading its TypeScript, and it settles the question rather than
leaving it open.

### Brokering screenshot and a11y checks

Driving a generated Story through the host's own Storybook — its test runner, its addons — to get a
screenshot or an a11y result back is not something Yosegi will do. Brokering is not owning a
rendering environment, but it puts the host's browser stack on Yosegi's critical path, which is the
founding line it was drawn to protect. Machine confirmation stops at the index check in item 14.
