---
name: yosegi
description: Build a screen mock or screen proposal (画面モック) out of the components already registered in a host project's Storybook, and deliver it as a Storybook Story (.stories.tsx) that can be reviewed before anything is implemented. On a host without Storybook, it delivers the same screen as a plain React component file instead. Also looks up what a host's components are actually called and what props they actually take, and turns an assembled mock Story into a real page implementation. Use it when asked to draft, propose, or mock up a screen from an existing design system, to make a new screen visible in Storybook first, or to convert a mock Story into an implementation.
---

# Yosegi — building screens from a host's own components

> **Version: 2026-08-13.** An agent harness can load a stale copy of a skill without saying so. If
> this date is older than the one in the repository's `skills/yosegi/SKILL.md`, you are reading an
> out-of-date copy — re-install it before going further.

Yosegi turns a host project's components into facts you can build a screen from, and emits the
screen as a Story (CSF) for review before anything is implemented. It has neither a rendering
environment nor a GUI of its own; you check how things look in the host's Storybook. On a host
without Storybook, the deliverable becomes a plain React component file (`--target component`) —
the step 1 branch below says how the procedure changes.

This document is the procedure, and you are the one carrying it out. The CLI (and the equivalent MCP
tools) are the instruments it reaches for.

## When to use it

- Composing a screen proposal or UI mock from an existing design system, in a reviewable form.
- Getting a first draft of a new screen visible in Storybook before it is implemented.
- Looking up which components a host has, and what props they really take, before writing any UI.
- Transcribing an approved mock Story into a real page. Do steps 1 and 2, then jump to step 5.

Not for: one-off component changes.

## Where the value is

The registry's job is narrow: it is the source of truth for a component's *props* — the real prop
names, the real enum options, which are required, which are slots versus children, a function prop's
call signature. A host's components are not the library they were forked from. Their variant enums
have been renamed, their size scales differ between siblings, an icon prop takes a component
reference rather than an element, a `ReactNode` prop is a named slot rather than children, and three
different components share one export name. None of that is derivable from familiarity with React or
with the upstream library, and every one of those is a defect you will ship if you write the prop you
expect instead of the prop the registry says exists. That is what steps 1 and 2's `inspect` calls are
for, and skipping them is how a plausible-looking mock ships a defect.

The registry does not give you the screen's skeleton, the composition idiom, or the layout — a
grid-library hook call a DataGrid is driven by, a host-specific `meta` such as
`{ stickyHeader: true }`, which wrapper a component expects around it. That comes from the host's
own Stories and, on a host with a page/route generator, its Example templates (step 2). The richer a
host's template and Story coverage, the smaller the registry's share of what you actually needed to
build the screen — and that is not a shortfall. The registry and the host's own examples answer
different questions, and both are load-bearing for the question they answer.

## References

Open these when the step below sends you to them, not preemptively. On the 3a route (write the
Story directly), that can be never: `registry status` and `component inspect`'s own output plus this
file's body are usually self-describing enough to build the whole screen. Once you do need one,
though, work from it and not from memory of this file alone — its detail is not repeated here.

| File | Read it |
| --- | --- |
| `references/registry.md` | When `inspect`'s output has something you cannot interpret — an opaque prop's `shape:` / `signature:` line, an undocumented prop, an import specifier that looks wrong |
| `references/cli.md` | When a command or flag is not covered above, the CLI won't run, or you need the MCP equivalents |
| `references/screen-json.md` | Only if you take the Screen JSON route (3b). The format, and what it cannot express |
| `references/errors.md` | The moment any command prints an error or a warning. Every code, and its fix |
| `references/implementation.md` | For the meta template in step 3, and before step 5 |

## Step 1. Build the registry

Yosegi needs a readable `tsconfig.json` from the host (props come from the TypeScript types, and
that alone is enough). Storybook is where the Story goes and where you confirm how it renders — but
it is not a requirement.

> **If you cannot detect Storybook** — no `.storybook/` (or equivalent) config directory, no
> `storybook` script in the host's `package.json`, no `index.json` to point `--index` at — the
> deliverable is a plain React component file instead of a Story
> (`screen generate --target component`, `references/cli.md`). Do not pick the output location or
> the review method yourself: before building anything, ask the user (a) where the component file
> should go, and (b) how they want to confirm the result (rendering it on a scratch route of the
> host app, for instance). Yosegi does not prescribe the review surface, and guessing either answer
> violates the same rule as guessing a prop. With those answers the procedure below stays the same,
> with three differences: `registry build` runs without `--index` / `--storybook-url` (you lose
> curation, nothing else); on route 3a you write the component file at the location the user named,
> and on 3b you pass `--target component --out <that location>.tsx`; and step 4's Storybook checks
> are replaced by the host's type check plus the confirmation method the user named.

1. **Can you run the CLI?** `npx yosegi` (or `pnpm yosegi`, `yarn yosegi`, `bunx yosegi`) with no
   arguments prints every command, once `@yosegi/yosegi` is already a dependency of the host — install
   it first if it is not (`references/cli.md`). Node.js 20 or newer, React + TypeScript host. If the
   command fails instead, see "If the CLI won't run" in `references/cli.md`; the single most useful
   move is reading `<data-dir>/registry.json`'s `builtWithCliPath` if a registry already exists from an
   earlier session.
2. **Fix a `--data-dir` now** and pass the same one to every command. Use `.yosegi` under the host's
   package root, which is also the default; the examples below still write it out, because the
   default follows your cwd and a command run from elsewhere will not find what you built.
3. **Is there a registry already, and is it current?** Run `yosegi registry status --data-dir
   .yosegi` first — it recomputes the registry's version from its own recorded inputs and reports
   `source: current` or `source: stale` with the exact rebuild command, instead of you eyeballing
   `component list`'s header for it. "Registry not found" means this is the first run. Its
   Storybook-index half is best-effort and can report the index as unreachable while the source
   verdict still stands — read that half as "couldn't verify", not as "stale" or "current", and don't
   let an unreachable dev server stop you from trusting a `current` source verdict. Rebuild whenever
   `status` reports stale, whenever anything printed `REGISTRY_VERSION_MISMATCH`, or whenever `status`
   reports `source: unknown` because the registry predates recorded inputs (`built: not recorded`) —
   there is nothing to recompute from there, so age is the only signal you have. Rebuild too whenever
   a command warns that the registry was built by a **different Yosegi version** than the one you are
   running: an older Yosegi cannot emit fields this one can (a function prop's call signatures, for
   one), and no other signal shows that gap — the version string, being a content hash, stays
   identical, so a registry rebuilt from an unchanged host keeps the same one. The registry is a
   snapshot, and a stale one is worse than none.

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig <host>/tsconfig.json \
  --index http://localhost:6006/index.json \
  --storybook-url http://localhost:6006 \
  --report tmp/registry-report.json \
  --data-dir .yosegi
```

`6006` above is Storybook's own default, used only because this is the first build and nothing has
told you otherwise yet — it is not necessarily the host's port. Check the host's `package.json`
Storybook script (or ask) for the port it actually runs on before running this. Every rebuild after
this first one has a better source than guessing: `component list`'s header prints a `rebuild:` line
carrying the exact `--storybook-url` the registry was last built with (`references/cli.md`).

Flags and defaults are in `references/cli.md`. `--index` is the one part with a prerequisite: a dev
server URL means the host's Storybook has to be running already. Without it you lose the
Story-derived categories and the `recommended` marks, nothing else.

Read the statistics it prints:

- `files: 0` → the glob matched nothing. The command still succeeds and writes a registry holding
  only the three synthetic primitives, so do not read "Wrote 3 components" as success.
- `componentCandidates: 0` with `files` positive, or `withNodeSlots: 0` with a high
  `anyShapedProps` → the build degraded even though it succeeded. The first means the glob covered
  no React components; the second means `@types/react` did not resolve, so every `ReactNode` prop
  flattened to `json` and no slots were detected. A `Warning:` line names the fix in both cases —
  resolve it and rebuild before going further.
- `propsUnreadable` high relative to `extractedComponents` → the tsconfig is probably wrong. Resolve
  it now (`references/cli.md`, `registry metadata`); a component in that state rejects perfectly
  real props later.

## Step 2. Look up every component you intend to use

If a page/route generator's Example template is the closest match to the screen you are building,
read it first, or alongside the commands below — it decides the skeleton and the composition idiom,
and the registry then confirms the exact props the template leaves open.

```sh
yosegi component list --category app/components/ui --data-dir .yosegi
yosegi component list --query card --data-dir .yosegi
yosegi component inspect "app/components/ui/button#Button" --data-dir .yosegi
```

The registry can run to several hundred entries, so narrow with `--category` / `--query`, get your
bearings from the summary, then `inspect` every component you are going to write. **`inspect` is
authoritative and your framework knowledge is not.** Read `references/registry.md` for how to read
what it gives you — the enum options, the `shape:` and `signature:` lines under an opaque prop, the
import specifier the host actually writes, and what an undocumented prop means.

Prefer components marked `recommended`; they have a Story of their own.

Then gather the host's conventions. The Story lands in the host's repository and is reviewed as the
host's code; skipping this produces a UI that works and still gets sent back.

- **Find the data contract, if one already exists** — an OpenAPI/JSON Schema definition, a GraphQL
  schema, hand-written TypeScript types for the API response, whatever form the host's data layer
  uses. Read it before inventing mock data. It decides more than component props do: which fields are
  required versus nullable and what null means for a given one (a null limit can mean "unlimited,"
  not "unknown"), which fields are mutually exclusive, and — just as usefully — what is *not* there
  (no sort or search field in the contract means the screen should not invent one either). This is
  what turns the mock from a look-and-feel proposal into something that reflects the real data shape.
  Where it lives differs by host (`openapi/schemas/`, a `.graphql` file, a generated `types.ts`); find
  whichever exists for this domain and follow it over a plausible-looking guess.
- Search the host's routes/pages directory (`app/routes/`, or wherever it serves pages) for an
  existing screen in the same domain. In a mature product one often exists, and finding it can
  reframe the task entirely — for example, an existing `bookings.calendar._index` route might turn
  "make a booking screen" into "propose a cross-cutting list against the existing booking flow." This
  determines whether the mock you were asked for is even the right thing to build, so do it before
  the checkpoint below and let it shape the questions you ask there.
- **Run `git status` and look at the output directory before building anything.** An earlier,
  uncommitted attempt at the same screen can already be sitting in the working tree — common after a
  context reset and a re-issued request. Reconcile with it instead of creating a duplicate beside it.
  To redo a file that already exists — a host generator refuses when the target path exists, or an
  earlier attempt needs replacing — move it aside (rename) rather than delete it; deletion may not be
  available to you, and a rename clears the path either way.
- **Check whether the host has a generator for new pages or screens** — a plop/hygen generator, a
  `bun add-route`-style script, often documented in the host's `AGENTS.md` or a `package.json`
  script. On a host with one, hand-writing a new screen file from scratch is wrong: the generator
  clones the sanctioned template and enforces the file and naming conventions, so run it instead of
  creating the file yourself. This also settles the step 3 choice between an inline-tree Story and a
  page module plus a thin wrapper Story — a host with a generator like this almost always wants the
  latter.
- Read `AGENTS.md` / `CLAUDE.md` at every level from the repository root down to the output
  directory, and follow any document they point at.
- Read one or two existing Stories near the output location. Composed examples that combine several
  components are the ones worth imitating for page skeleton, spacing, and component selection. **For
  composition idiom — how a component is actually assembled, not just what props it takes: the
  grid-library hook call a DataGrid is driven by, a host-specific `meta` such as
  `{ stickyHeader: true }`, the wrapper a component expects around it — an existing Story is the
  source of truth, and the registry is not.** The registry pins down each component's props and
  slots; it does not, and is not expected to, carry the runtime wiring that makes several of them
  work together. When `inspect` and a Story disagree on how a component is used, follow the Story.
- Use the host's semantic tokens in classNames (`text-helper`, `bg-surface`), not raw palette
  values. Confirm the token exists in the host's CSS; never guess one.
- Note the **title namespace** and whatever the host requires in a Story's `meta` (`tags`, a Docs
  page, Figma or Notion references).

**When a convention cannot be satisfied, do not claim it anyway.** Detecting the requirement is
half the job; the other half is not producing something that only looks compliant.

- A **title namespace whose contract you cannot meet** — it requires a template file extracted
  alongside the Story, registration in a registry the host maintains, a scaffolding command you were
  not asked to run — is not yours to take. Put the Story under a namespace you *can* satisfy, and
  leave a one-line comment at the top of the file naming the contract you did not meet. A Story
  sitting in a reserved namespace with half its contract missing is worse than one that is honestly
  somewhere else, because nothing will flag it. This is a call you make yourself: when you *know*
  which namespace was intended but cannot meet its contract, take this path — do not stop at the
  checkpoint below to ask. (The checkpoint is for the different case where you cannot tell which
  namespace applies at all.) You still name it at the checkpoint; you just do not block on it.
- A **title namespace whose contract you *can* meet, but meeting it has side effects beyond this
  file** — registering the Story in a shared manifest the host maintains (an `examples/registry.ts`
  that also drives a scaffolding command's choices, for instance) changes what other developers see,
  not just this Story. That is not yours to decide unilaterally for a mock, even though you are
  capable of doing it correctly: ask at the checkpoint below instead of registering it yourself. This
  is a different case from the one above — there the contract cannot be met at all; here it can, but
  doing so reaches outside the file you were asked to produce.
- A **required design reference that does not exist yet** — a Figma or Notion URL, on a mock
  proposed before any design — is left out, with a one-line comment saying why. Never write a URL
  you have not opened. A plausible wrong link is followed and costs more than an absent one.

Both are things to report at the step 4 checkpoint, not to resolve silently.

> **Checkpoint — ask the user before assembling anything.** Do not judge this by how confident you
> feel. Ask if *any* of these is true:
>
> - The request does not say which sections the screen has, or what data each one shows.
> - More than one existing screen could be the model for it, or none obviously is.
> - You cannot tell *which* title namespace and directory the file belongs in — no existing Story and
>   no explicit rule fixes it. (This is not the same as knowing the namespace but being unable to
>   meet its contract: that case is resolved above by moving the file and leaving the comment, and
>   does not need this checkpoint.) Some hosts attach contracts to a title prefix, and guessing wrong
>   violates a convention no linter checks.
> - The namespace's contract is meetable, but meeting it means registering the Story somewhere shared
>   beyond this file (a manifest that also feeds other tooling).
> - You cannot tell what the host requires in a Story's meta.
>
> "A customer list obviously has name, email, and signup date" is exactly the reasoning this
> checkpoint exists to stop. Assembling the wrong screen correctly wastes everything below, and the
> user is the cheapest place to resolve it.

## Step 3. Choose a route

Two ways to produce the Story. Choose deliberately — they are not interchangeable.

**The test.** Walk the tree you intend to build. Does any component on it need a value that has no
JSON form? That means: a runtime object (a table instance, a form control, a ref), a `ReactNode`
built in an expression, a component reference (an icon prop that takes the component itself), or a
branch. **If yes for even one component, write the Story directly.** Screen JSON has no syntax for
any of those, and a screen that needs one cannot be expressed in it at all — the generated Story
will reference a name that does not exist and will not compile.

Data and repetition are *not* disqualifiers: a list a component maps over, or any JSON-shaped mock
data, goes in the screen's `fixtures` (named JSON values emitted as consts, referenced from
`bindings`), and a row shown N times takes `repeat: N` on the node
(`references/screen-json.md` for both). Shape the fixture after the data contract found in step 2.

Neither are the screen's other states. `variants` names each one — loading, error, empty — as a
diff of operations over the base tree, and every variant becomes its own Story export in the same
generated file (`references/screen-json.md`). Use it to flush out missed states while the screen is
still a mock: a proposal that shows only the happy path hides exactly the states that get argued
about during implementation, and the reviewer approves what they saw, not what was implied. The
data contract from step 2 says which states exist — a nullable list means an empty state, a fetch
means a loading state.

If the rest is headings, copy, static props, and fixed children — either route works, and the JSON
route buys you validation before you write a line of JSX plus the hand-off comments step 5 reads
back.

### 3a. Write the Story directly (the default)

Write the `.stories.tsx` by hand, following the host's Story conventions from step 2.

**On the no-Storybook branch from step 1, what you write directly is the component file, not a
Story.** Write it at the location the user named: exported function components, one per screen
state, with the mock data as consts in the file — the shape `--target component` emits, minus the
CSF trappings. No meta, no Story conventions, no `.stories.tsx` suffix. The bullets below (imports
from `inspect`, only props `inspect` listed, mock data in the file) apply unchanged; the two
Story-shaped paragraphs that follow this one do not — the deliverable's location was already settled
by the user in step 1, and there is no Storybook review to keep out of the routes directory.

**Decide the shape of the deliverable before writing anything.** A Story here can be an inline
component tree, or a thin Story that renders a page module (a `route.tsx` or a standalone page
component) which holds the tree. If step 2 found a page/route generator or an established route
convention, the host almost always wants the latter — build the page module through the generator (or
following its convention), and let the Story be the few lines that import and render it. Step 5
explains why the distinction also matters for `story import` / `screen context`.

**A mock under review does not have to be a live route.** It is reviewed in Storybook, and a route
registration is a side effect the review does not need. If the host's route convention would
auto-register any file placed in its routes directory, keep the mock's page component out of that
directory — beside the Story, or wherever the host keeps non-route components — so that reviewing the
mock does not create a live route or collide with the route generator. Hosts differ in how routes are
discovered, so there is no one mechanism to follow here; if that shape does not fit the host's own
Story setup, an inline component tree is the fallback that sidesteps the question entirely.

- Copy each import line from `inspect` as your starting point — it is the module path resolved
  through the host's tsconfig `paths`, which compiles but is not necessarily what the host's own code
  writes (a barrel the host prefers, for one). Check what step 2's Stories actually import and follow
  that when it differs. Never reconstruct the import from the file path, and never go the other way:
  an import you see in existing code does not give you a registry id — ids come only from
  `component list` / `inspect` (`references/registry.md`).
- Write only props `inspect` listed, with values from the options it listed.
- Put the mock data in the file. Anything the screen would fetch becomes a literal here.

Nothing validates this file, so step 4 is what catches your mistakes. That is fine — the host's type
checker knows more about these components than Yosegi's validator does.

### 3b. Go through Screen JSON

Read `references/screen-json.md` first — its opening section is the list of things the format cannot
say, and it is worth re-checking your screen against it before writing. Screen JSON is an
intermediate representation, not a deliverable: `tmp/screen.json` is right, and you may delete it
afterwards.

```sh
yosegi screen generate tmp/screen.json \
  --out <host>/app/components/examples/customer-list.stories.tsx \
  --title "Examples/Customer list" \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --meta-template tmp/meta-template.tsx \
  --data-dir .yosegi
```

Without Storybook (the step 1 branch), swap in `--target component --out <path>.tsx` at the
location the user named. `--title` / `--framework` / `--meta-template` are CSF-only and rejected on
that target, and `--story-name` names the exported function instead (default `Screen`). Everything
else — validation, `fixtures`, `repeat`, `variants` — behaves identically, each variant becoming
another exported function in the same file.

`--meta-template` is how the host's meta boilerplate gets in; without it the meta is a bare `title`
(`references/implementation.md`). On validation errors no file is written and an array comes back
with exit code 1. **Do not clear them one at a time — apply the entire printed array and re-run.**
`references/errors.md` covers every code. This loop is yours alone; run it to completion without
asking anyone. Warnings appear after the file is written and do not stop generation; check them
against `references/errors.md` before moving on.

## Step 4. Verify — the same way for both routes

1. **Run the host's type check** (`bun typecheck`, `npx tsc --noEmit`, whatever the host uses). This
   is the step that matters. It reads your JSX against the components' real types and catches what
   nothing upstream can: a variant that is not in the enum, a prop that belongs to a sibling
   component, a required slot left empty.

   **The bar is no errors in the files you touched, not a clean run.** Plenty of repositories
   already fail their own type check on unrelated files, and waiting for zero output means waiting
   forever. Filter by path and iterate until your files are absent:

   ```sh
   npx tsc --noEmit | grep "app/components/examples/customer-list.stories"
   ```

   On the Screen JSON route, fix the Screen JSON and re-generate rather than hand-editing the Story.
2. Run the host's formatter and linter over the file (`bunx biome check --write <file>`,
   `npx prettier --write <file>`). It is the host's code now. Note that both pass on a Story whose
   props do not type-check at all, which is why they come second.
3. Confirm the meta satisfies the host's conventions. Neither the formatter nor the linter checks
   this, and it is the easiest thing in the whole procedure to miss.
4. Start the host's Storybook and confirm the Story appears under its title and renders correctly.
   If it does not appear, check that the title reached `index.json`.

If it renders badly, the usual causes are a className that is not one of the host's tokens, or a
combination of components unlike the host's existing Stories. Go back to step 2.

**On the no-Storybook branch from step 1**, steps 1 and 2 above run unchanged and carry the most
weight; step 3 has no Story meta to check, and step 4 is replaced by the confirmation method the
user named there — render or run the component exactly the way they said they would review it. If
that method never puts the rendered screen in front of a human, say so at the checkpoint below, the
same way the browserless section does.

### Step 4.4 without a browser

Looking at the rendered screen is the default and nothing replaces it. If you have no way to drive a
browser, these three checks are a pre-filter, not a substitute — they catch specific, known failures,
but none of them looks at the preview bundle or the browser's actual state, so passing all three is
not evidence the screen renders. Run all three anyway — each one fails differently, and passing the
first two proves nothing about the third.

```sh
# 1. the dev server knows about the Story, and 2. its module actually resolves
node -e '
const base = "http://localhost:6006"; // example only — use the actual port, see below
const index = await (await fetch(base + "/index.json")).json();
const entry = Object.values(index.entries).find((e) => e.type === "story" && e.title === "Examples/Customer list");
if (!entry) throw new Error("not in index.json");
console.log("registered:", entry.id, entry.importPath);
const res = await fetch(base + "/" + entry.importPath.replace(/^\.\//, ""));
console.log("resolves:", res.status, res.status === 200 ? "(the real proof — presence in index.json alone is not)" : "(module 404s or entry is stale — restart Storybook)");
'
```

Wrap the script in single quotes, not double. A Story title that embeds a React Router path segment
(`Routes/Products/$productId/Edit`, a case common enough to hit often) sits inside a double-quoted
shell string and gets `$productId` expanded away by the shell before Node ever sees it, turning a real
Story into a false "not in index.json". Single quotes pass it through literally; write the JS string
literals inside as double quotes instead, as above.

`6006` is a placeholder, not the host's port — swap in the one the host's Storybook is actually
running on. `yosegi registry status --data-dir .yosegi` (step 1) is the canonical place to read it:
its `inputs` block prints `storybookUrl: <url>` (`--json` returns it at `inputs.storybookUrl`), and
you already ran `status` before building, so it costs nothing to check back there. If the registry
predates recorded inputs and `status` has nothing to show, fall back to `component list`'s header:
the `rebuild:` line prints the `--storybook-url` (and `--index`) the registry was last built with,
and that is the same dev server this check needs.

A missing entry means the file is outside the host's `stories` glob or the title is not what you
think. **The `resolves:` line — the fetch on `importPath` — is the actual proof, not the entry's mere
presence in `index.json`.** A long-running dev server can keep an entry for a Story file that was
since renamed, moved, or deleted: the entry still shows up as registered while the fetch on its
`importPath` 404s, or the file it names is no longer on disk. Either of those, not just a bare non-200
from a genuinely broken import, means the index itself is stale.

**A dev server started before the Story file existed can pass check 1 and still not work.**
`index.json` is built at startup and then watched for changes; a server that was already running when
you created the file may have cached a state that predates it, so the entry can appear registered
while the file is not actually served correctly. This is the same failure mode as the stale entry
above, just in the opposite direction — a new file instead of a deleted one — and the fix is the same:
if any of these checks gives a result that does not match what you expect, restart the host's
Storybook dev server and re-run the checks before trusting them.

3. **It mounts.** Render the Story once in the host's test runner and assert on one piece of text
   you know is on the screen — this is the check that catches a component throwing on the props you
   gave it. Do it in the host's own testing idiom, not a fixed recipe: where the host renders Stories
   with `composeStories` from its Storybook package plus its Testing Library, follow that; where its
   convention is a different runner or assertion style, follow *that* rather than importing a stack
   the host does not use. If the host has no component-test setup at all, say so at the checkpoint
   instead of bolting one on — checks 1 and 2 still ran, and a human's eyes are the backstop either
   way.

   **If the host requires a test for new files, this is that test, not an extra one.** A mature
   host's own conventions often mandate a test file alongside every new file (a `.test.tsx` next to
   the Story, say) independent of whether you have a browser at all. Do not write a throwaway mount
   script here and a separate file to satisfy that requirement — they are the same obligation. Put
   the mount assertion in the file and location the host's convention names, in the host's idiom, and
   it discharges both at once.

What none of this covers is how it *looks* — spacing, alignment, whether the screen reads as a
screen. Say so at the checkpoint below: report that the Story was verified without a browser, and
that a human's eyes are still the only thing that has judged the layout. A Story with wrong props
can pass all three checks and still fail the type check, which is why step 1 comes first.

> **Checkpoint — hand it to the user and wait.** Report the Story's file path and its URL in the
> host's Storybook (on the no-Storybook branch: the component file's path and how it was
> verified), and ask the user to review it. **Wait for their approval.** The mock is the
> deliverable of this half, and its entire purpose is that a human looks at the screen before it is
> built. Never continue into step 5 on your own judgement.

## Step 5. Turn the Story into an implementation

> **Checkpoint — a human must have approved the mock.** If you came through step 4, that is the
> approval. If you arrived with a Story somebody else wrote, you have none: confirm with the user
> that this Story, in its current state, is what should be built.

> **Checkpoint — ask where the page goes.** The Story says nothing about the route or the file path.
> If the request does not give you a route and the host's conventions do not determine the location,
> ask instead of inventing one.

If step 3 kept the mock's page component out of the host's routes directory to avoid registering a
route early, this is where it moves in — through the generator or convention step 2 found for real
routes, not by simply relocating the mock's file.

Then read `references/implementation.md` and follow it: read the host's implementation conventions,
transcribe the Story, wire up the data and the handlers, and compare the result against the mock.

**Do not expect `story import` and `screen context` to help here.** They read back a Story that
Yosegi itself generated; against a hand-written one they usually return a single node and no
warnings at all, because real Stories render one wrapper component rather than inlining the tree.
`references/implementation.md` states the limitation in full. Read the Story.
