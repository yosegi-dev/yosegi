# Component Registry

English | [日本語](./ja/registry.md)

The Component Registry is generated from the TypeScript types in the host's source. This page covers
how the extraction works, the decisions behind it, and what it produces on a real host.

- Implementation: `packages/server/src/registry/source-registry.ts`
- CLI: `registry build --source <glob> --tsconfig <path> [--index <path|url>]`
- Measured on 2026-08-07, against a production React design system (`app/components/**`)

## Who this helps

The registry's payoff scales with how far the host's components have drifted from what an agent
already knows about React. A host built on an unmodified component library, or a thin wrapper around
one, gains little — an agent can usually guess that API correctly without help. A host that has
renamed variants, invented its own prop vocabulary, modeled state through a runtime object, or built
domain-specific enums gains the most, because none of that is guessable from general React
knowledge.

This was measured on five synthetic fixtures built to span that range, from an unmodified shadcn/ui
screen and a thin Next.js/Radix wrapper, through moderate customization, to a heavily diverged
in-house system with renamed APIs and a custom runtime abstraction. The same screen was implemented
twice per fixture — once from general React/library knowledge, once using `component inspect` — and
checked with `tsc`. Every fixture reached zero type errors with the registry; without it, the
near-vanilla fixtures were already at 0–1 errors, while the customized and diverged ones ranged from
8 to 17. Raw error count is not itself a divergence measure: one diverged fixture came back with
fewer errors than a moderately customized one simply because its screen used fewer components, even
though its mistakes — an array where a single model was expected, a generic-tone enum standing in
for a domain enum, wrong event names — were the deepest in kind. The fixtures are synthetic and
built to span this spectrum on purpose; treat the shape (near-zero payoff at one end, large payoff
at the other) as the takeaway, not a number to expect from any specific host.

## Three sources, three roles

- **TypeScript types are the truth about a component.** props, slots, and imports are derived from
  them, so the host writes no registry by hand and nothing drifts from the implementation.
- **Stories are curation signals and usage examples.** They show which components the host wants you
  to use, and how they get composed.
- **Storybook is the rendering environment.** It is where you look at what you assembled.

Reading props from types is what makes validation possible: an enum such as `variant` has a known
set of values, so a wrong one comes back as `INVALID_PROP_VALUE` with the options listed instead of
escaping to human review. Every exported component is visible whether or not it has a Story, and the
import target is exact rather than inferred from a file path.

For the handful of components whose props the types cannot express, `--metadata` fills the gap by
hand — see [Patterns that do not extract cleanly](#patterns-that-do-not-extract-cleanly).

## How it works

Type extraction uses
[react-docgen-typescript](https://github.com/styleguidist/react-docgen-typescript), the same
implementation Storybook uses to generate argTypes, so the registry is unlikely to diverge from how
things look in the host's Storybook. Since `@yosegi/core` is kept zod-only, type extraction lives in
`@yosegi/yosegi`.

### Hosts on TypeScript 7

TypeScript 7.0 ships no compiler API, and extraction is built on the 6.x one, so a host that
installed 7 has to alias `typescript` to the compatibility package the TypeScript team publishes for
this. It keeps `tsc` on 7 and hands tools back the 6.x API:

```sh
# npm
npm install -D typescript@npm:@typescript/typescript6
# pnpm
pnpm add -D typescript@npm:@typescript/typescript6
# yarn
yarn add -D typescript@npm:@typescript/typescript6
# bun
bun add -d typescript@npm:@typescript/typescript6
```

The tree then holds one `typescript`, shared with Yosegi rather than duplicated. Without the alias,
`registry build` fails with the version it resolved and the command above — installing Yosegi's own
copy is not enough, because a package manager hoists react-docgen-typescript to the top of the
host's tree, where it finds the host's 7 rather than the copy nested under `@yosegi/yosegi`.

### ids and imports

- `id` = `<module path relative to projectRoot>#<exportName>` (e.g.
  `app/components/ui/card#CardHeader`)
- `import.packageName` = the same form as Storybook's `componentPath` (
  `./app/components/ui/card.tsx`)
- `import.exportName` = the actual named export
- `import.specifier` = the module path resolved through the host's tsconfig `paths`
  (`~/components/ui/card`) — compiles, but is not necessarily what the host's own code writes
- `import.kind` = `"default"` for a default export; absent for a named one

This `module path#exportName` form is the canonical shape of a registry id (decided). It is the only
form that can distinguish a file exporting several components (`Card` / `CardHeader` / `CardBody`),
which a bare name cannot.

Building from `--index` alone, without `--source`, is also supported. That path has no types to
read, so it produces short ids (`Button`) and no props. It exists for curation alongside `--source`,
or for simple use that assumes hand-written `--metadata`.

`--project-root` is the base for the glob and for ids, defaulting to the directory containing
`--tsconfig` (the host's package root). Basing it on `app/components` would shorten ids to
`ui/card#CardHeader`, but that would diverge from the base used for `import.packageName`, so the
default is left alone.

**`packageName` is a path, `specifier` is an import statement.** A host that aliases through
tsconfig `paths` never writes `./app/components/ui/card.tsx`. So a registry that only reports the
path hands agents a line that does not resolve. Every source file is therefore resolved through the
host's `paths` while the registry is built, and the result is stored alongside the raw path;
`component inspect` and `screen generate` both use it. Where several aliases match, the one with the
deeper substitution wins (`"~/*": ["./app/*"]` beats a catch-all `"*": ["./*"]`). A trailing
`/index` is dropped, and a file no alias covers keeps the relative form. `registry build
--import-map "./app=~"` overrides the whole resolution for hosts whose aliases live outside tsconfig
(a bundler's `resolve.alias`, for instance).

`--import-map` on `screen generate` is a separate, later stage: it rewrites `packageName` at
generation time and takes precedence over `specifier`, so an existing pipeline that passes it keeps
producing exactly what it did before.

`specifier` resolves to the deepest module the component is declared in, not necessarily the entry
point the host prefers to import from. A host that also maintains a barrel
(`~/components/pagination` re-exporting `~/components/pagination/paginator`) may write the
barrel in most of its own code. `specifier` still reports the deep path. Both resolve at compile
time, but only one matches the host's dominant style. Measured on a production host: a barrel import
appeared 22 times against 10 for the deep path in the same directory, and the example templates used
the barrel. Treat `specifier` as a resolved, compiling path, not a claim about which one the host
prefers.

### Default exports

A default export has no name at the module level, so the declaration's name is used instead
(`export default function ContentCard` and `export default ContentCard` both give `ContentCard`).
`import.kind: "default"` records how to write the import. This matters more than it sounds: whole
page-level composition examples are conventionally written as `export default function`, and before
this they were invisible to the registry.

A file that exports one symbol both ways is registered once, under its named export. An anonymous
default export (`export default () => ...`) has no name to serve as an id or a JSX tag, so it stays
out and is reported in `--report` as `unnamed-default`.

Export names come from the module export names the TypeChecker returns, not from `displayName`. A
component that assigns `ForwardedText.displayName = "Text"` swaps the real export name for the
display name, so ids based on `displayName` break. We pass `(exp) => exp.getName()` as
react-docgen-typescript's `componentNameResolver` and reconcile against the export names from our
own `checker.getExportsOfModule()`.

### Converting prop types

| Type | How the registry treats it |
| --- | --- |
| `string` / `number` / `boolean` | The kind of the same name |
| A union of string or numeric literals | `enum` + `options` |
| A union that includes `null` | `nullable: true` (excluded from `options`) |
| `ReactNode` / `ReactElement` | A **slot**, not a prop |
| Function types (containing `=>`) | `function` / `editable: false`, plus `signatures` |
| Anything else | `json` / `editable: false`, plus `shape` (or `signatures`, if the type is callable) |
| JSDoc | `description` |

With `shouldExtractValuesFromUnion` enabled, every optional prop arrives as `name: "enum"` (even
`string | undefined` counts as a union), so the type name tells you nothing. The ordering is
therefore: treat it as an enum only when a list of literals could be extracted, and otherwise decide
from the `raw` type text. cva's `VariantProps` arrives as `"md" | "lg" | null` and becomes an enum
through this path.

The order of `options` follows the order in which TypeScript created the literal types, which is not
necessarily declaration order. It is stable for the same input, but no meaning should be attached to
it.

### Variants that collide with HTML attributes

In a component built as `React.HTMLAttributes<T> & VariantProps<typeof variants>`, a cva `color`
variant collides by name with `HTMLAttributes`' deprecated `color` attribute.
react-docgen-typescript then takes the type from the React-side declaration, so
`"primary" | "danger"` collapses to `string`. The declaring source is also reported as React, which
makes propFilter drop it.

**The host's declaration wins** (decided). The TypeChecker resolves the intersection correctly and
returns `"primary" | "danger"`, so only the colliding props are re-read from the types and
substituted in.

The test is "does this property of the props type have at least one declaration outside
`@types/react`". The synthetic symbol the TypeChecker creates for an intersection carries the
declarations from both sides, and even for a mapped type such as `VariantProps` the declaration
points at the host file defining the variants rather than at cva. Props that merely wrap React
attributes in a utility type, such as `Omit<InputHTMLAttributes<T>, "size">`, still have
`@types/react` as their declaration and do not qualify — which is what keeps the 280 HTML attributes
from flooding in.

Re-reading is restricted to the colliding props because prop type resolution affects the order in
which TypeScript generates literal types, and doing more would shift the ordering of `options` on
unrelated components.

### Determining `required`

Components whose props type is a union have `required` dropped (decided).

react-docgen-typescript's required determination stops matching the type once the props type
contains a union, and it errs in both directions.

- A required property is downgraded to optional (missed cases in validation)
- A property that exists in only one branch arrives as `required: true` (**a correct screen gets
  rejected with `MISSING_REQUIRED_PROP`**)

The latter does real damage, so `required` is dropped across the board for union props types, erring
toward "do not mark something required unless we can say for sure that it is". Missed cases remain,
but false positives disappear. On the measured host this applied to one component whose props type
was `SingleProps | MultipleProps`, where `required` was dropped from two props.

### Automatic slot discovery

A prop that accepts a `ReactNode` / `ReactElement` is a place to put children rather than a value,
so it is taken out of props and listed under `slots`. This amounts to automatic discovery of named
slots. On the measured host, 7 props became slots this way — icon, separator, heading, footer, and
label props, all typed `ReactNode`.

### `className` and `children`

Both are dropped by the React-declared filter above, and both are put back — but only for the
components whose props type actually contains them. A component that closes its props over its own
interface (`interface Props { date: Date }`) or that returns a Fragment gets neither. A component
that spreads `HTMLAttributes` / `ComponentProps<'div'>`, declares `className` itself, or is wrapped
in `PropsWithChildren` gets both, or whichever one it accepts.

They are not added by default. A registry that hands out props a component does not accept is worse
than one that stays quiet: `component inspect` is the source of truth for writing Stories, so an
invented prop turns straight into a `TS2322` in the host. On the measured host, 99 of 268 components
were carrying a `className` and/or a `children` they never accepted.

Note that `children` is a slot rather than a prop, so it cannot be a `bindings` target.

For a component whose props react-docgen-typescript cannot read at all, these two are read straight
off the call signature's first parameter through the TypeChecker, since that much can be settled
even when the rest cannot. If even the props type is unreachable, nothing is added — omitting a real
prop costs less than inventing one.

### Categories and curation

Every component gets a `category`. Without `--index` it is the component's directory relative to
`--project-root` (`app/components/ui`). A component at the root of that base is
`uncategorized`. With `--index`, entries are collapsed per implementation file (`componentPath`) and
matched against the manifests. A matched component takes the first segment of its Story title
instead (`Components`). A `--metadata` entry overrides both.

Matched components additionally gain:

- `references.storybook`: a deep link to the Story (with `--storybook-url`)
- `curation`: `{ recommended, storyTitle, storyCount, storyFile, storyNames }`

`curation` lives on `ComponentManifest` (`packages/core/src/domain/component-manifest.ts`). A
registry built mechanically from types lists every export that exists, so the components the host
wants you to use sit alongside internal implementation details. The presence of a Story is the only
"this one is fine to use" signal the host emits, so it is preserved on the manifest.

Components without a Story get `curation.recommended = false` but are not excluded. That is what
keeps pieces like `CardHeader` — no Story of their own, yet necessary for assembly — from being
dropped.

`references.storybook` deep-links the *first* Story of a title, which is usually a `--playground`
and therefore documents nothing in particular. `storyFile` and `storyNames` are recorded so that an
agent whose question the props cannot answer ("what does the empty state look like?") has a file to
open and a Story name to look for. Both come free — index.json already carries them.

### What the host can do to make `inspect` more useful

Prop descriptions come from JSDoc on the props type, and nothing else can supply them. A props type
written as

```tsx
type DataGridProps = {
	/** Rows to render. One object per row. */
	rows: RowModel<Row>;
};
```

turns into a `description` on that prop; without the comment, all `inspect` can report is
`rows: json`, and the agent is left guessing what to put there. **Writing JSDoc on the props of
shared components is the single highest-leverage thing a host team can do for this workflow**, and
it costs Yosegi nothing — the comments are already useful to humans and to the host's own IDE.

Measured on one component of the design system below: adding 8 lines of JSDoc to its props took
`component inspect`'s output from 277 B to 1301 B. An agent given nothing but that output went
from a broken screen — checkboxes missing, an inline width that broke the layout, a configuration
prop set to a value that did nothing — to a correct one. No code changed between the two runs.

Type information on its own only rules out *structural* mistakes — wrong prop name, wrong enum
value, wrong function signature, a missing required prop. A separate comparison held two fixtures'
component APIs identical (same props, same types) and varied only the JSDoc; both reached zero `tsc`
errors with the registry either way, because the types alone were enough to keep the code compiling.
Only the JSDoc'd fixture avoided mistakes that compile cleanly and are still wrong. One was an
`onRemove: () => void` prop invoked as if it were a toggle handler; the other was a render-callback
prop misused in a way that passed excess-property checking and shipped as a silent UI bug rather
than a build error. Without the comments, the agent filled in meaning by guessing "common React
patterns" — right, on that fixture, but not something the registry told it. That is the gap JSDoc
closes and the type system cannot: it sits outside any count `tsc` would ever report.

Write the things the type cannot say.

| Write | Rather than |
| --- | --- |
| What a `json` prop expects, field by field, and which fields matter | Restating the type name |
| The default the component applies when the prop is omitted | Leaving it to be inferred |
| What the caller is responsible for — refetching, closing, persisting | `onSave: () => void` alone |
| Which props are mutually exclusive, or meaningless without another | Nothing |

`registry build` measures how much of this exists, so the work can be aimed. Its summary reports
`props`, `documentedProps`, and `opaqueProps`, plus `undocumentedRequiredOpaqueProps` and
`withUndocumentedRequiredOpaqueProps` — props that are required, take a value no literal can
express, and carry no description. Those stop an implementation outright. `--report <path>` names
them individually: see [`docs/cli.md`](./cli.md#registry-build) for the shape of that list.

### Exclusions

Exports whose JSDoc carries `@yosegi-internal` are kept out of the registry. TypeScript sometimes
splits that into the tag name `yosegi` plus the comment `-internal`, so both forms are accepted.

## Measured results

Run against `app/components/**/*.tsx` (excluding `*.stories.*` / `*.test.*`).

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --index http://localhost:6006/index.json \
  --storybook-url http://localhost:6006 \
  --out tmp/registry.json --report tmp/report.json
```

`6006` is that run's host's Storybook port, not a value to copy — use your own host's port if you
reproduce this.

| Metric | Value |
| --- | --- |
| Files scanned | 120 |
| Exports identified as components | 278 |
| Of those, props read from types | 275 (98.9%) |
| Props unreadable | 3 |
| Has at least one prop | 258 |
| enums (unions) extracted | 72 |
| ReactNode slots extracted | 7 (named slots only) |
| Has a corresponding Story (recommended) | 218 |
| Has no Story (only findable from types) | 60 |
| Props extracted | 1247 |
| Of those, carrying a description | 293 (23.5%) |
| Props no literal can express (`json` / `function`) | 479 |
| Of those, reduced to a bare type name | 111 (was 460 before signatures and union members) |
| Required, opaque, and undocumented | 75, across 45 components |
| Elapsed time | about 3.9–4.4 seconds |

60 of the 278 have no Story of their own and are reachable only through the types; files that export
several components account for much of the rest. That is where assembly-critical pieces live.

The documentation numbers are the ones with room to move. 76.5% of the props say nothing beyond
their type, and the 75 required opaque props are the subset where that silence is fatal rather than
inconvenient — the reason the summary calls them out by name.

The output is deterministic: the same input twice produced byte-identical results, and the content
hash in `version` is stable.

Resolving the collision with HTML attributes recovered 4 props across 3 components that propFilter
would otherwise have dropped.

| Component | prop | Result |
| --- | --- | --- |
| A heading component | `color` | `enum` (7 options) |
| A charting-library wrapper | `height` / `width` | `json` |
| A command palette | `defaultValue` | `json` |

The same `color` on the host's text component is not recovered, because that component's props
cannot be read at all (pattern 1 below).

Outlook at larger scale: 120 files take a bit over 4 seconds, most of it type resolution in
`ts.createProgram`, so it grows roughly in proportion to the file count. That is heavy for every CI
job, but the registry only needs rebuilding when a Story is added or a component changes.

### Patterns that do not extract cleanly

**1. A cast to an overloaded call signature type**

```ts
type TextComponent = {
  (props: ParagraphTextProps & React.RefAttributes<HTMLParagraphElement>): React.ReactElement | null;
  (props: SpanTextProps & React.RefAttributes<HTMLSpanElement>): React.ReactElement | null;
};
const Text = ForwardedText as TextComponent;
```

react-docgen-typescript does not return this `Text` at all, and passing `customComponentTypes`
changes nothing. A minimal reproduction does not reproduce it from a cast to an overloaded type
alone, so something else in the real file's type graph is the trigger. Left alone, the component's
variant props are missing from generated Stories.

**Rescuing it in the extractor is deferred** (decided). Reading the first parameter of the call
signature directly through the TypeChecker would probably work. But it would mean partially
reimplementing react-docgen-typescript's type conversion (JSDoc, `defaultValue`, and `required`
resolution), giving us two extraction paths. Only 3 components on the measured host are affected,
and all of them do appear in the registry as manifests carrying whatever the TypeChecker can settle
of `className` / `children`.

**2. Re-exports of third-party components**

```ts
const Form = FormProvider;              // from a form library
const ChartTooltip = Primitive.Tooltip; // from a charting library
```

These props cannot be read either; together with case 1 that makes 3 components. The TypeChecker can
still determine that they are "values that return a React element when called", so they are listed
as manifests carrying whatever it can settle of `className` / `children`. The extraction report
records them as `props-unreadable`. Rescuing them is deferred for the same reason as case 1.

**The treatment for these 3 is filling them in with `--metadata`.** As long as the registry does not
know their props, writing a real prop into a Screen JSON produces `UNKNOWN_PROP` and the screen
cannot be assembled. Explicit metadata takes precedence over props obtained from types, and
components filled in this way are counted neither in `propsUnreadable` nor in the `--report` misses.
`component inspect` reads the manifest's `propsFromTypes` and says so, which is how you find the
candidates to fill in.

**3. Unions of object types cannot have their options enumerated**

A union expressed by a single type name, such as an icon component type, cannot be reduced to
`options`, so it becomes `json` / `editable: false`. The `shape` fills part of the gap: when every
member is a literal or a primitive, they are listed in `shape.members` — `string | number`, or the
15 names behind an editor's feature-list array. A union of object types is still left as a name only
— its members disagree about which fields are required, so listing the common ones would describe a
value the host's type checker rejects.

**4. Thin wrappers let the third-party API flow straight through**

For components wrapping a third-party library, the wrapped component's props are all visible. That
is correct as "this component's API", but for a large API the registry balloons — one charting
wrapper came back with 176 props. Only 3 of the 278 components have more than 30.

The same pass-through also means a prop that type-checks is not guaranteed to work. A wrapper that
spreads `...props` onto the primitive it wraps lets any prop the primitive accepts through, even
one the wrapper's own behavior does not expect. An `onClick` handler on a menu item is one example,
where only `onSelect` fires on keyboard selection. `tsc` has no way to see that gap; only a
description on the prop, or reading the wrapped library's own docs, closes it.

## Decisions

1. **The canonical id scheme is `module path#exportName`**, and `--source` is the main path.
   `--index` on its own produces short ids and no props, positioned as "for curation alongside
   `--source`, or for simple use that assumes hand-written `--metadata`".
2. **`required` is dropped for union props types.** This errs away from false positives (rejecting a
   correct screen), accepting the missed cases as a known limitation.
3. **For variants that collide with HTML attributes, the host's definition wins.** The test is
   whether the property has a declaration outside `@types/react`, and only the colliding props are
   re-read from the TypeChecker.
4. **The 3 `props-unreadable` components are not rescued in the extractor** (deferred). Too few are
   affected to justify a second extraction path, and they do appear in the registry. The treatment
   is `--metadata`.
5. **`--project-root` defaults to the tsconfig's directory.**
6. **Explicit metadata (`--metadata`) takes precedence over props obtained from types.** If a value
   written specifically to fill a gap lost to an incomplete type-derived definition, filling gaps
   would be pointless. It applies on both paths, and ids that matched no component are reported as
   warnings — discarding them silently leaves no way to notice.

Where these limits are headed next is tracked in [the roadmap](./ROADMAP.md).
