# Command reference

## Invoking it

Commands are written below as `yosegi <command>`.

```sh
# npm
npm i -D @yosegi/yosegi
# pnpm
pnpm add -D @yosegi/yosegi
# yarn
yarn add -D @yosegi/yosegi
# bun
bun add -d @yosegi/yosegi
```

`yosegi <command>` means `npx yosegi <command>` (or `pnpm yosegi`, `yarn yosegi`, `bunx yosegi`).

The CLI runs on Node.js 20 or newer. The host has to be a React + TypeScript project. Running with
no arguments prints every command.

From the checkout's own root, `bun --filter '@yosegi/yosegi' cli <command>` also works and needs no
build. The cwd becomes `packages/server`, so every relative path shifts — pass absolute paths for
`--tsconfig`, `--project-root` (the base for `--source`), `--out`, and `--data-dir`.

### If the CLI won't run

`npx yosegi` (and its `pnpm` / `yarn` / `bunx` equivalents) only resolves to a local `yosegi` bin once
`@yosegi/yosegi` is already a dependency of the host. Before that, the same command fails one of two
ways: `MODULE_NOT_FOUND` (a local bin exists but something under it is missing), or your package
manager trying to auto-install a package literally named `yosegi` and 404ing, because `yosegi` alone
is not the package name — `@yosegi/yosegi` is. Treat either as "not installed yet," not as a broken
CLI, and do not chase a phantom `yosegi` package on the registry. Install `@yosegi/yosegi` (above) and
retry.

If a `<data-dir>/registry.json` already exists from an earlier session, you do not need a working CLI
to make progress in the meantime: read that file directly. Its `builtWithCliPath` field records the
exact CLI path the last build ran through, and reading a JSON file needs no working CLI, which is what
breaks the chicken-and-egg (you would otherwise need a running CLI just to print that path). That
recorded path can be stale if the checkout moved since — a pre-rename directory, a relocated clone —
so treat it as a hint to try first, not gospel: if invoking it also fails, fall back to asking the
user.

## Conventions shared by every command

- `--data-dir <dir>` is where the working data lives (default: `.yosegi` under the current
  directory, so it moves with your cwd). **Pass the same value to every command.** Writing
  `registry build`'s output to one location and then passing a different `--data-dir` to
  `component list` produces `REGISTRY_NOT_FOUND` (its `path` / `dataDir` fields name the location
  that was actually consulted). The directory is created if it does not exist.
- Repeatable flags (`--source`) also accept comma-separated values.
- **Always quote globs.** `--source app/components/**/*.tsx` is expanded by the shell first and only
  one file reaches the CLI. Write `--source "app/components/**/*.tsx"`.
- Output is JSON on stdout unless stated otherwise. Errors are JSON carrying `error.code` and exit
  code 1 (`errors.md`): an unknown command or flag is rejected with the nearest candidates
  (`UNKNOWN_COMMAND` / `UNKNOWN_FLAG` — a misspelled flag is never silently ignored), and a missing
  required argument returns `MISSING_ARGUMENT`. Usage text only appears via `--help` (`-h`, exit 0);
  `--version` prints `{ "version", "cliPath" }` with exit 0.

## `registry build`

Generates the list of usable components and writes it to `<data-dir>/registry.json`.

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig <host>/tsconfig.json \
  --index http://localhost:6006/index.json \
  --storybook-url http://localhost:6006 \
  --data-dir .yosegi
```

`6006` is Storybook's default and a placeholder here, not the host's actual port. Use the port the
host's Storybook runs on; after the first build, `component list`'s `rebuild:` line carries it back
to you exactly.

| Flag | Meaning |
| --- | --- |
| `--source <glob>` | The host's component sources. Repeatable, comma-separated. `*.stories.*` / `*.test.*` are excluded automatically |
| `--tsconfig <path>` | The host's tsconfig. Required with `--source`, because its type resolution settings (`paths`) are used as-is. A relative path is fine |
| `--project-root <dir>` | The base that `--source` globs and component id module paths resolve against. Defaults to the directory holding `--tsconfig` (the host's package root). The cwd is never the base |
| `--index <path\|url>` | Storybook's `index.json`. Optional. For components that have a Story, replaces the directory-derived `category` with one from the Story title and adds `curation.recommended`. A static build file or a dev server URL both work |
| `--storybook-url <url>` | Attaches deep links to the Stories |
| `--metadata <file>` | Supplies props the types could not (see `registry metadata`). Applies on both the `--source` and the `--index` path |
| `--import-map <from=to,...>` | Overrides the import specifiers stored in the registry. Only needed when the host's aliases are not declared in tsconfig |
| `--report <path>` | Writes `{ stats, missed, undocumented }`. In `missed`, `reason: "props-unreadable"` marks the components `--metadata` exists for and `reason: "unnamed-default"` an anonymous `export default` that has no name to use as an id. `undocumented` lists the props worth writing JSDoc on, ranked |
| `--out <path>` | Overrides the output path (default: `<data-dir>/registry.json`) |
| `--version <ref>` | Overrides the registry version string |
| `--json` | Returns `{ out, version, count, stats, warnings, hints }` as one object instead of the mixed text output (`stats` is `null` on the `--index`-only path). The warnings below still appear, inside `warnings` |

Points that decide whether the result is usable:

- **`--source` is the recommended path.** A registry can be built from `--index` alone, but then
  props cannot be read and export names are guessed from the Story title, so a hand-written
  `--metadata` file becomes necessary. Treat `--index` as curation layered on top of `--source`.
- **Categories exist without `--index`.** Every component gets one: its directory relative to
  `--project-root` (`app/components/ui`), or `uncategorized` at the base itself. `--index` only
  swaps in the Story title's first segment for components that have a Story, so
  `component list --category` is usable either way.
- Write globs as paths relative to the host's root, not to your cwd. Even with zero matches the
  command succeeds and writes a registry holding only the three synthetic primitives (with a
  warning). `files: 0` in the statistics means the base is wrong.
- Pass the **host's** tsconfig. Yosegi's own tsconfig means the host's `paths` do not apply and props
  go unread across the board (`propsUnreadable` spikes). In a monorepo, pass the tsconfig of the
  package the component belongs to. Import specifiers come from those same `paths`, so the wrong
  tsconfig also makes `inspect` print import lines the host cannot resolve.
- If you point `--index` at a dev server, wait until startup finishes and `index.json` returns 200.
  Calling earlier fails the fetch.
- The registry is a snapshot. Re-run after changing the host's components, after switching branches,
  and whenever `REGISTRY_VERSION_MISMATCH` appears.

The statistics also measure how much the host has documented: `documentedProps` out of `props`, and
`undocumentedRequiredOpaqueProps` — required props that take a value no literal can express and
describe it nowhere. `--report <path>` names them, ranked `required-opaque` first and grouped by
component. What to do about them is in `registry.md`.

## `registry metadata`

Scaffolds a `--metadata` file for components whose props cannot be read from types, using the host's
cva (class-variance-authority) variants. Faster than transcribing by hand, and it cannot introduce
typos.

```sh
yosegi registry metadata \
  "app/components/typography#Text" "app/components/ui/badge#Badge" \
  --tsconfig <host>/tsconfig.json \
  --out tmp/metadata.json
```

- Ids can be listed several at a time. `--source` / `--project-root` / `--tsconfig` mean exactly
  what they do in `registry build`.
- An id of the form `<module path>#<name>` is resolved through that path, so `--source` can be
  omitted. Short ids from `--index`-only mode (`Button`) do need `--source`; the export name is
  searched for within that range.
- Omitting `--out` prints the scaffold to stdout.
- **Only cva variants make it into the scaffold**, and a `Note:` repeats that on every run. Props
  that are not variants — including required ones such as `as` — are missing. Read the source and
  add them. If the variants could not be read at all you get an empty scaffold plus a `Note:` naming
  the source worth reading; write that component's props by hand.

The file it produces:

```json
{
  "app/components/typography#Text": {
    "props": {
      "size": { "kind": "enum", "nullable": true, "options": ["xsm", "sm", "md"], "defaultValue": "md" },
      "color": { "kind": "enum", "nullable": true, "options": ["primary", "helper"] },
      "weight": { "kind": "enum", "nullable": true, "options": ["normal", "bold"] }
    }
  }
}
```

- The shape is `{ "<component id>": { "props": { "<prop name>": { "kind": ... } } } }`. `kind` is one
  of `string` / `number` / `boolean` / `enum` / `json` / `reactNode` / `function`. An `enum` takes
  `options`. `required: true` means the prop must be given a value; `nullable: true` means it may be
  omitted. `defaultValue` records the component's own default.
- Besides `props`, an entry can override `slots`, `description`, and `category`. Two further keys
  (`constraints`, `references`) mirror fields of a registry entry; if you need them, copy the shape
  from a component that already has them in `component inspect --json`.
- Pass it to `registry build` as `--metadata <file>`. `metadataApplied` in the statistics counts the
  components it touched.
- **Keep the file.** It is needed on every rebuild — put it in the host's repository or your working
  directory, not in a temporary one.

## `registry status`

Answers "is the registry still current?" directly, instead of eyeballing `component list`'s header.
Run this first when deciding whether to rebuild.

```sh
yosegi registry status --data-dir .yosegi
```

| Flag | Meaning |
| --- | --- |
| `--json` | Return `{ version, generatedAt, builtWith, builtWithCliPath, inputs, runningVersion, sourceCheck }` instead of the text summary |

It prints the same provenance `component list`'s header does (built at, built by which Yosegi, the
recorded inputs), then goes one step further: it recomputes the registry's content hash from those
same recorded inputs and reports `source: current` or `source: stale`, printing the exact rebuild
command when stale. A registry with no recorded inputs, or one built with an explicit `--version`
that pins a ref rather than a content hash, reports `source: unknown` with the reason — that is not a
failure, it means this registry predates or opts out of the check.

The Storybook-index half of the recompute is best-effort. If `--index` pointed at a dev server and
that server is not reachable right now, the check reports what it could not verify rather than
guessing at drift it never measured — read that as "couldn't check", not as "stale" or "current". The
source-side verdict (recomputed from `--source` / `--tsconfig`) does not depend on the index being
reachable.

## `component list` / `component inspect`

```sh
yosegi component list --data-dir .yosegi
yosegi component list --category app/components/ui --data-dir .yosegi
yosegi component list --query card --data-dir .yosegi
yosegi component inspect "app/components/ui/button#Button" --data-dir .yosegi
```

| Flag | Meaning |
| --- | --- |
| `--category <name>` | Filter by category (the component's directory, or the Story title when `--index` was used) |
| `--query <text>` | Substring match over id, name, and description |
| `--json` | Return the manifests themselves rather than the text summary |

`list` opens with the registry it is reading, then a three-line summary per component:

```
281 of 281 components
registry src:049edf3890eb  built 2026-08-09T05:53:19.718Z
  rebuild: yosegi registry build --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --storybook-url http://localhost:6006

app/components/ui/button#Button [app/components/ui] recommended
    props: className:string disabled:boolean onClick:function size:enum(3) variant:enum(3)
    slots: children startIcon
```

**`registry status` is how you judge whether the registry is stale — this header is not a
substitute for it.** `list`'s version string alone cannot tell you: it is a content hash, so a
rebuild from an unchanged host produces the same string. The `rebuild:` line is the command that
produced it, minus `--data-dir` — it carries every flag that shapes the result (`--storybook-url`
included, so the deep links and the version survive a re-run), so run it verbatim with your
`--data-dir` to refresh once `status` has told you to. A registry written before this was recorded
says `built: not recorded`; rebuild it. Separately, if the registry was built by a **different Yosegi
version** than the CLI you are running, every command that reads it prints a `Warning:` naming both
versions and the rebuild command — heed it, because an older Yosegi omits fields a newer one emits
and nothing else reveals the gap. `--json` returns `version`, `generatedAt`, `builtWith` (the Yosegi
that wrote it), and `inputs`.

`inspect` returns the import statement, the Story coordinates, the props (type, required, default,
the full set of enum options, the shape of an opaque prop, description), and the slots. **Never
guess props; confirm them here.** How to read all of it is in `registry.md`, which is the page that
owns this output.

## `screen generate`

Screen JSON → Story (CSF). The deliverable of the upstream half.

```sh
yosegi screen generate tmp/screen.json \
  --out <host>/app/components/examples/customer-list.stories.tsx \
  --title "Examples/Customer list" \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --meta-template tmp/meta-template.tsx \
  --data-dir .yosegi
```

| Flag | Meaning |
| --- | --- |
| `--out <path>` | **Required.** Where the Story goes in the host. Intermediate directories are created |
| `--title <title>` | The Story title. Defaults to `Screens/<screen name>` |
| `--story-name <name>` | The Story's export name. Defaults to `Default`. Must be a JavaScript identifier — a name with a space or a leading digit is rejected outright |
| `--import-map <from=to,...>` | Prefix-replaces the registry's packageName with the host's import specifier. Use it to align registry paths (`./app/...`) with the host's aliases (`~/...`). If the generated imports do not resolve in the host, this is what to fix — match the packageName visible in `inspect`'s import statement against the host's aliases |
| `--framework <pkg>` | Where `Meta` / `StoryObj` are imported from. Defaults to `@storybook/react` |
| `--meta-template <file>` | Splices in the host's meta boilerplate. See `implementation.md` |
| `--registry <file>` | Use a registry other than the one in `--data-dir` |

On validation errors nothing is written and an array of errors comes back with exit code 1
(`errors.md`). Warnings are printed after `Wrote <path>` and do not stop generation.

`screen validate` is a different command: it targets screens already saved in the screen store (the
ones you have `screen push`ed). A Screen JSON file is validated by `screen generate` itself, so you
do not need it here.

## `screen context`

Screen JSON → the JSON a coding agent implements from. **Only useful on a Screen JSON you still
hold from `screen generate`** — see the limitation in `implementation.md` before reaching for it,
and note that the output runs to roughly twenty times the size of the Story it describes.

```sh
yosegi screen context tmp/screen.json \
  --import-map "./app=~" \
  --route "/customers" \
  --data-dir .yosegi
```

| Flag | Meaning |
| --- | --- |
| `--route <path>` | The route the screen will live at. Echoed back in `target` |
| `--preferred-path <path>` | Where the implementation file should go. Echoed back in `target` |
| `--import-map <from=to,...>` | Same meaning and direction as in `screen generate` |
| `--registry <file>` | Use a registry other than the one in `--data-dir` |
| `--out <file.json>` | Write to a file instead of stdout |

## `story import`

Story → Screen JSON. **It only works on a Story that `screen generate` wrote.** On a hand-written
Story it typically returns a single node and no warnings at all — read the limitation in
`implementation.md` before spending a cycle on it.

```sh
yosegi story import <host>/app/components/examples/customer-list.stories.tsx \
  --import-map "./app=~" \
  --out tmp/screen.json \
  --data-dir .yosegi
```

| Flag | Meaning |
| --- | --- |
| `--import-map <from=to,...>` | Same direction and value as in `screen generate` (registry paths → host aliases); the importer reads it in reverse when matching import statements. Without it, resolution falls back to a trailing-segment path match, which is less reliable |
| `--story-name <name>` | Which Story to take. Defaults to the first export that has a `render` |
| `--screen-id <id>` | The screen id. Defaults to the file name minus `.stories.tsx`. Letters, digits, `-` and `_` only |
| `--screen-name <name>` | The screen name. Defaults to the last segment of the Story title |
| `--registry <file>` | Use a registry other than the one in `--data-dir` |
| `--out <screen.json>` | Writes only the Screen JSON to the file; warnings go to stdout. Without it, `{ title, storyName, screen, warnings }` all go to stdout together |

**Always read the warnings** (`errors.md`) — whatever they name is missing from the Screen JSON.

## The screen store (rarely needed)

`screen generate` and `screen context` read a Screen JSON file directly, so the store is optional.
It exists for the MCP tools, which address screens by id rather than by path.

```
screen push <file.json>              # save (create, or update by revision)
screen list
screen pull <screenId>               # also: screen export <screenId>
screen validate <screenId>
screen apply <screenId> <ops.json>   # partial update through operations
```

`screen push` takes the same Screen JSON as `screen generate`, and creates or updates by the `id`
and `revision` in the file. `screen apply` edits a stored screen through operation objects, whose
shape is deliberately not documented here — nothing in this workflow needs it. Edit the Screen JSON
file and `screen push` again instead.

## Over MCP

The same operations are available over MCP. `yosegi mcp` serves them over stdio and keeps running
until the client disconnects:

```sh
claude mcp add yosegi -- npx yosegi mcp
```

| MCP tool | Arguments | CLI equivalent |
| --- | --- | --- |
| `search_components` | `query`, `category`, `detail`, `limit` | `component list --query --category` — returns summaries capped at `limit` (default 50, max 200) with `total` / `truncated`; `detail: "full"` returns complete manifests |
| `get_component` | `componentId` | `component inspect` — an unknown id returns `COMPONENT_NOT_FOUND` with the same did-you-mean `suggestion` |
| `list_categories` | — | the `categories` field of `component list --json` |
| `get_registry_status` | — | `registry status`, provenance only: it reports version / build time / inputs and the version-mismatch warning, but does not recompute source drift |
| `generate_story` | `root`, `title`, `storyName`, `importMap`, `framework`, `fixtures` | `screen generate` — but it writes no file and returns the CSF source as a string, so the caller decides where it goes |
| `generate_implementation_context` | `screenId`, `route`, `preferredPath`, `importMap` | `screen context`, addressed by stored screen id |
| `validate_screen` | `screenId` | `screen validate` |
| `list_screens` / `get_screen` | — / `screenId` | `screen list` / `screen pull` |
| `create_screen` | `id`, `name`, `root` | `screen push` (creates as a draft) |
| `apply_screen_operations` | `screenId`, `baseRevision`, `operations` | `screen apply` |
| `duplicate_screen` | `screenId`, `newId`, `newName` | — |

Two differences from the CLI are easy to get wrong:

- `generate_story` takes `root` — the ScreenNode alone, which is the `root` field of the Screen
  JSON, not the whole document. The other top-level fields have no MCP equivalent; `title` and
  `fixtures` are passed separately.
- `importMap` is the same string the CLI takes (`"./app=~,./lib=~/lib"`), not an object.

`generate_implementation_context` takes a `screenId`, so the screen has to be in the store first
(`create_screen`). Building the registry (`registry build`), scaffolding metadata
(`registry metadata`), reading a Story back (`story import`), and the source-drift recompute half of
`registry status` are CLI-only, and there is no MCP equivalent of `--meta-template`: a Story
generated over MCP carries a bare `title` meta, so add the host's meta conventions to the source
before saving it. The CLI's stderr warning about a registry built by a different Yosegi version
reaches MCP too, as the `warning` field of `get_registry_status`.
