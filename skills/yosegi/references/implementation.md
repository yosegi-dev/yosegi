# From mock to host code

Two things live here: the host's meta conventions, which decide whether a generated Story is
acceptable as the host's code at all (step 3 of `SKILL.md`), and the conversion of an approved mock
Story into a real page (step 5).

## Host meta conventions (`--meta-template`)

Only relevant on the Screen JSON route; on the direct-authoring route you write the meta yourself.

The meta that `screen generate` emits is just `title`. Host-specific requirements — `tags`
(`autodocs` and so on), the Docs page, references to Figma or Notion — are not included. Neither a
formatter nor a linter can detect this, because the convention lives in AGENTS.md rather than in any
rule. A Story that goes to review with a bare meta is the easiest failure in this whole workflow to
miss.

Write what you noted about the host's conventions into a template and pass it to
`--meta-template <file>`. The template is an ordinary TypeScript file holding a single meta. A
fragment is fine: use the host's own scaffold if it has one, otherwise write it yourself.

```tsx
// tmp/meta-template.tsx
import type { Meta } from "@storybook/react-vite";
import { DesignDocsPage } from "~/components/storybook/design-docs-page";

const meta: Meta = {
	tags: ["autodocs"],
	parameters: { docs: { page: DesignDocsPage } },
};

export default meta;
```

- `title` and `component` are not carried over — the screen decides those. Writing them is harmless
  and only produces a warning.
- **Import `Meta` from the same package you pass to `--framework`.** The template's imports are
  copied verbatim while `StoryObj` comes from `--framework` (default `@storybook/react`), so a
  template importing `@storybook/react-vite` without the matching flag produces a file that imports
  from both.
- The JSDoc directly above the meta, the `import` statements, and every other property go straight
  into the output. Imports the carried-over meta does not reference are dropped.
- **Never fill in information you do not have.** A mock proposed before any design exists has no
  Figma or Notion URL, and there is nothing to write. Leave the field out and put a one-line comment
  where it would have gone, saying it is absent because the design does not exist yet — an empty
  field somebody has to ask about beats a plausible link somebody follows. If you built the template
  from an existing Story, that Story's URLs come along verbatim; every inherited URL is named in a
  warning, so check each one and either remove or replace it.

## The downstream limitation — read this before running anything

`story import` and `screen context` exist to carry a Yosegi-generated Story into an implementation.
**On a Story that Yosegi did not generate, they do not work**, and the failure is silent.

`story import` reads the Story's source AST. Real Stories in real repositories almost never inline
the component tree; the convention is a Story whose `render` returns a single wrapper component
defined in a neighbouring file, because that wrapper is the thing being previewed. Measured against
a production design system, every composed example Story in the repository imported to **exactly one
node and zero warnings** — a Screen JSON containing the wrapper's own id and nothing else. Nothing
in the output says the screen is missing. Feed that to `screen context` and you get a large,
confident JSON describing one component.

So:

- **The Story you assembled in this session, whose Screen JSON you still have** — skip `story
  import` entirely and go to `screen context` with the file you already hold.
- **A Yosegi-generated Story you no longer have the Screen JSON for** — `story import` will read it
  back faithfully, hand-off comments included; only node ids change.
- **Anything else, including every hand-written Story** — do not run either command. Read the Story
  and the files it imports. That is the whole of the input, and it is not hard to read; the
  commands' output would be twenty times its size and less accurate.

## Recovering the Screen JSON (`story import`)

Only for the second case above.

```sh
yosegi story import <host>/app/components/examples/customer-list.stories.tsx \
  --import-map "./app=~" \
  --out tmp/screen.json \
  --data-dir .yosegi
```

Flags are in `cli.md`. The Story is never executed, so anything whose shape is only decided at
runtime cannot be read; whatever could not be read marks that node opaque and lands in `warnings`,
while the readable part of the tree is still returned.

**Read the warnings before going further** (`errors.md` lists every code). Anything they name is
absent from the Screen JSON. But do not treat an empty `warnings` array as proof the import worked —
count the nodes against the Story you can see. One node means you hit the limitation above.

## Pulling the implementation context (`screen context`)

```sh
yosegi screen context tmp/screen.json \
  --import-map "./app=~" \
  --route "/customers" \
  --data-dir .yosegi
```

`--route` and `--preferred-path` are echoed back in `target` and change nothing else. You know them
from the request or the host's routing conventions, never from the Story; if neither settles it,
that is the step 5 checkpoint — ask.

JSON comes back, and it is verbose. Four keys carry the work.

| Key | What it gives you |
| --- | --- |
| `imports` | Import statements you can paste as-is. They resolve exactly as the Story's did |
| `structure.outline` | The screen's skeleton as indented lines — which component sits in which slot, and how things nest |
| `components[]` | Per component in use: `usedProps`, `usedSlots`, `manifest` (every prop it *can* take), and `importStatement`. `synthetic: true` marks `Text` / `Box` / `Heading`. `unregistered: true` is the one that needs action — see below |
| `tasks[]` | `bindings` and `events` flattened into wiring tasks. `path` and `nodeId` identify the target node; read `expression` into your implementation when `kind: "binding"`, and `action` plus `arguments` when `kind: "event"` |

**`unregistered: true`** means the id in the screen is not in the registry, so there is no
`importStatement` and no `manifest`. Rebuild the registry with a `--source` glob wide enough to
cover the component; if it still does not appear, take the component's real import from the original
Story, then check with the user that using it is intended, because nothing has validated its props.

**`when` and `each` are not in `tasks[]`.** They are declarations with no JSX behind them, so they
live on `structure.nodes[]` (each node carries `when` and `each`, `null` when unset). Scan for the
non-null ones before you start and treat them as work items: an `each` is a list you have to iterate
even though the mock showed a fixed number of rows.

The rest is supporting information. `requirements[]` lists the promises to keep while implementing
— read it once. `target` mirrors `--route` / `--preferred-path`, `implementation` holds host-side
constraints (`null` when unset), `registryVersion` is the registry it resolved against, and `screen`
is the input Screen JSON itself.

## Read the host's implementation conventions

Before transcribing, gather material the way you did in step 2 — this time for implementation.
**Reproducing the Story's appearance and following the host's implementation conventions are two
different things**, and the second appears neither in the Story nor in the implementation context.

- Read `AGENTS.md` / `CLAUDE.md` at every level from the repository root down to the implementation
  directory. How pages are built — how routes are added, which scaffolding commands exist, how files
  are split and named — comes from there. Check for a scaffolding command before placing files by
  hand.
- Read one or two existing page implementations near where yours goes. How data fetching is written
  (hooks, clients, loading and error states) is fixed per host, and the Story says nothing about it.

## Implement

1. Build the page shell following the host's conventions.
2. Transcribe the tree — from `structure.outline` and `imports` if you have them, otherwise straight
   from the Story. At this point the page should look exactly like the mock.
3. Replace each dummy value that comes from data with real data, and each placeholder handler with a
   real one. On the Screen JSON route these are enumerated in `tasks[]`; otherwise they are the
   literals you or someone else wrote into the mock. `expression` and `action` are Yosegi's
   declarations, not the host's API names — translate them into the style of the implementations you
   just read.
4. Apply the repetition and conditions. Rows the mock faked by duplication become a real iteration.
5. Sweep up the dummy values that nothing flagged — sample copy, placeholder counts. These ship to
   production if you leave them.
6. Run the host's type checking, lint, and tests.

## Compare against the mock

Put the implemented page and the mock side by side in Storybook — write a Story that renders the
page's component, in the host's style, and open both.

Check, in this order:

- Structure — every node present, in the same nesting.
- Components — the same components, not visually similar substitutes.
- Props — every value reflected, and no dummy value surviving except where real data supplies it.
- Wiring — every binding and event connected. A leftover `{/* TODO(yosegi): ... */}` comment means
  one was missed.
- Repetition and conditions — reflected. Nothing warns about these.
- Appearance — spacing, typography, and tokens match. A difference here usually means a className
  was dropped or a synthetic primitive replaced the wrong host component.

The mock Story has served its purpose once the implementation lands. Whether it stays depends on the
repository's practice. If neither the host's documents nor the existing Stories make that clear, ask
the user rather than deleting a file somebody may be using as a reference.
