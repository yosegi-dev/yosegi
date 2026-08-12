# CLI reference

English | [日本語](./ja/cli.md)

Every command and flag. Running `yosegi` with no arguments prints the same list in short form.

## Invoking the CLI

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

`yosegi` below means `npx yosegi` (`pnpm yosegi`, `yarn yosegi`, `bunx yosegi`). It runs on Node.js
20 or newer. Working inside the Yosegi repository itself is different — see
[Development](./development.md).

## Options every command takes

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--data-dir <dir>` | path | `.yosegi` under the cwd | Where the registry and the saved screens live. Created if missing. Pass the same value to every command |

Repeatable flags (`--source`) also accept comma-separated values. Always quote globs — the shell
expands an unquoted one before the CLI sees it.

Errors exit with code 1 as JSON carrying `error.code`. An unknown command or flag is rejected with
the nearest candidates (`UNKNOWN_COMMAND` / `UNKNOWN_FLAG`), and a missing required argument returns
`MISSING_ARGUMENT`. `--help` (`-h`) prints usage with exit 0; `--version` prints
`{ "version", "cliPath" }` with exit 0.

## `registry build`

Builds the Component Registry from the host's TypeScript types.

```sh
yosegi registry build --source <glob> --tsconfig <path> [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--source <glob>` | glob | — | The host's component sources. Repeatable and comma-separated. `*.stories.*` / `*.test.*` are excluded automatically |
| `--tsconfig <path>` | path | — | The host's tsconfig. Required with `--source`; its type resolution settings, `paths` included, are used as-is |
| `--project-root <dir>` | path | the `--tsconfig` directory | The base for `--source` globs and for the module paths in component ids. Never the cwd |
| `--index <path\|url>` | path or URL | — | Storybook's `index.json`. Adds Story-derived categories, `curation.recommended`, and Story titles |
| `--storybook-url <url>` | URL | — | Base URL of the Storybook `--index` came from. Attaches deep links. Only has an effect with `--index` |
| `--metadata <file>` | path | — | Hand-supplied props for components whose types could not be read. Applies on both the `--source` and `--index` paths |
| `--import-map <from=to,...>` | string | tsconfig `paths` | Overrides the import specifiers stored in the registry. Only needed when the host's aliases are not in tsconfig |
| `--report <path>` | path | — | Writes `{ stats, missed, undocumented }`: the exports that could not be extracted, and the props worth writing JSDoc on, ranked |
| `--out <path>` | path | `registry.json` under `--data-dir` | Where the registry is written. Intermediate directories are created |
| `--version <ref>` | string | a content hash | The registry's `version` string, which a Screen JSON copies into `componentRegistryVersion` |
| `--json` | boolean | `false` | Return `{ out, version, count, stats, warnings, hints }` as one object instead of the text output (`stats` is `null` on the `--index`-only path) |

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --data-dir .yosegi
```

Statistics are printed at the end. `files: 0` means the glob matched nothing (a warning says so, and
the registry still gets written with the three synthetic primitives in it). `componentCandidates`
counts the exports judged to be React components; zero with `files` positive means the glob covered
no components (a warning says so — check that it includes `.tsx` files). `withNodeSlots: 0` with a
high `anyShapedProps` means `@types/react` did not resolve through `--tsconfig`: ReactNode props
degrade to `json` / `shape: any` and slot detection finds nothing, with a warning naming the fix. A
high `propsUnreadable` usually means the tsconfig is not the host's. `documentedProps` out of
`props` is the share of props carrying JSDoc. `undocumentedRequiredOpaqueProps` counts the required
props that take a value no literal can express and that go undocumented.

`--report`'s `undocumented` section lists those props, one entry per `{ component, prop, kind,
priority, recommended, shape? }`. Entries are ordered `required-opaque`, `optional-opaque`,
`required-literal`, `optional-literal`, and capped at 100 with the rest counted in `omitted`. Work
down it — see
[Component registry](./registry.md#what-the-host-can-do-to-make-inspect-more-useful).

Import specifiers come from the host's tsconfig `paths`, so the registry reports the line the host
would write (`~/components/button`) rather than a path relative to the project root. Pass
`--import-map "./app=~"` only if the aliases live somewhere tsconfig cannot see.

Omitting `--source` builds from `--index` alone. Ids then stay short (`Button`) and props rely on
`--metadata`. See [Component registry](./registry.md).

## `registry metadata`

Scaffolds a `--metadata` file from the host's cva (class-variance-authority) variant definitions.

```sh
yosegi registry metadata <componentId> [<componentId> ...] --tsconfig <path> [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--tsconfig <path>` | path | — | Required unless `--project-root` is given |
| `--project-root <dir>` | path | the `--tsconfig` directory | Same meaning as in `registry build` |
| `--source <glob>` | glob | — | Only needed for short ids (`Button`); the export name is searched for within this range |
| `--out <path>` | path | stdout | Where the scaffold is written |

```sh
yosegi registry metadata "app/components/ui/badge#Badge" \
  --tsconfig ./tsconfig.json --out tmp/metadata.json
```

An id written as `<module path>#<name>` is resolved through that path, so `--source` can be omitted.
Only cva variants reach the scaffold — props that are not variants are missing, and a `Note:` says
so on every run.

## `registry status`

Reports whether the registry is still current for the host's source, without rebuilding.

```sh
yosegi registry status [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--json` | boolean | `false` | Return the manifest instead of the text summary |

```sh
yosegi registry status --data-dir .yosegi
```

Recomputes the registry's content hash from its recorded inputs and reports `source: current` or
`source: stale` (with the exact rebuild command). A registry with no recorded inputs, or one pinned
with `--version`, reports `source: unknown` instead — there is nothing to recompute from.

## `component list`

Lists the registered components.

```sh
yosegi component list [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--category <name>` | string | — | Narrow to one category |
| `--query <text>` | string | — | Substring match over id, name, and description |
| `--json` | boolean | `false` | Return the manifests instead of the text summary |

```sh
yosegi component list --query card --data-dir .yosegi
```

The header names the registry in use, when it was built, and the `registry build` that would rebuild
it — carrying every flag that shapes the result (`--storybook-url` included), so running it verbatim
reproduces the same version and deep links. `--json` returns `version`, `generatedAt`, `builtWith`
(the Yosegi that wrote it), and `inputs`. A registry written before this was recorded reports
`built: not recorded`; one built by a different Yosegi version than the running CLI prints a
`Warning:` naming both versions and the rebuild command. To judge whether the registry is actually
stale, use `registry status` (above) rather than reading this header by eye.

## `component inspect`

Returns one component's import statement, props (type, required, default, enum options,
description), and slots. An id that is not registered comes back with the nearest candidate.

```sh
yosegi component inspect <componentId> [--json]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--json` | boolean | `false` | Return the manifest instead of the text summary |

```sh
yosegi component inspect "app/components/ui/button#Button" --data-dir .yosegi
```

## `screen generate`

Validates a Screen JSON file against the registry and writes the Story (CSF).

```sh
yosegi screen generate <screen.json> --out <file.stories.tsx> [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--out <path>` | path | — | Required. Where the Story goes. Intermediate directories are created |
| `--title <title>` | string | `Screens/<screen name>` | The Story's `title` |
| `--story-name <name>` | string | `Default` | The Story's export name. Must be a JavaScript identifier |
| `--import-map <from=to,...>` | string | — | Prefix-replaces the registry's `packageName` with the host's import specifier. Fix generated imports that do not resolve here |
| `--framework <pkg>` | string | `@storybook/react` | Where `Meta` / `StoryObj` are imported from |
| `--meta-template <file>` | path | — | A host file holding one meta; everything except `title` and `component` is carried over |
| `--registry <file>` | path | `registry.json` under `--data-dir` | Use a different registry |

```sh
yosegi screen generate tmp/screen.json \
  --out app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --data-dir .yosegi
```

On validation errors nothing is written and an array of errors comes back with exit code 1. Warnings
are printed after `Wrote <path>` and do not stop generation. Codes are in
[Workflows](./workflows.md#validation-error-codes).

## `screen context`

Emits the context for turning a screen into an implementation as JSON.

```sh
yosegi screen context <screen.json> [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--import-map <from=to,...>` | string | — | Same meaning as in `screen generate`, so the emitted imports match the Story's |
| `--route <path>` | string | — | The route the implementation will live at. Echoed back under `target` |
| `--preferred-path <path>` | path | — | The file path the implementation should take. Echoed back under `target` |
| `--out <file.json>` | path | stdout | Where the JSON is written |
| `--registry <file>` | path | `registry.json` under `--data-dir` | Use a different registry |

```sh
yosegi screen context tmp/screen.json \
  --import-map "./app=~" --route /customers --data-dir .yosegi
```

How to read the output is in [Workflows](./workflows.md#downstream--turning-a-story-into-an-implementation).

## `story import`

Reads a Story back into Screen JSON. Anything that could not be interpreted is reported in
`warnings`.

```sh
yosegi story import <file.stories.tsx> [options]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--import-map <from=to,...>` | string | — | The same direction and value as `screen generate`; the importer reads it in reverse |
| `--story-name <name>` | string | the first export with a `render` | Which Story to take |
| `--screen-id <id>` | string | the file name minus `.stories.*` | The resulting screen's id. Letters, digits, `-` and `_` only |
| `--screen-name <name>` | string | the last segment of the Story's `title` | The screen's name |
| `--out <screen.json>` | path | stdout | Writes only the Screen JSON to the file; warnings go to stdout. Without it, `{ title, storyName, screen, warnings }` all go to stdout |
| `--registry <file>` | path | `registry.json` under `--data-dir` | Use a different registry |

```sh
yosegi story import app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" --out tmp/screen.json --data-dir .yosegi
```

Warning codes are in [Workflows](./workflows.md#story-import-warnings).

## Screen store commands

These address screens saved under `--data-dir` by id, rather than Screen JSON files by path.
`screen generate` and `screen context` read a file directly, so the store is optional; it exists for
the MCP tools, which have no file paths.

```sh
yosegi screen push <file.json>              # save: create, or update by revision
yosegi screen list
yosegi screen pull <screenId>               # also: screen export <screenId>
yosegi screen validate <screenId>
yosegi screen apply <screenId> <operations.json>
```

`screen validate` targets saved screens only. A Screen JSON file is validated by `screen generate`
as part of its own run.

## `mcp`

Serves the MCP tools over stdio and keeps running until the client disconnects. Takes `--data-dir`
like every other command.

```sh
claude mcp add yosegi -- npx yosegi mcp
```

| MCP tool | Arguments | CLI equivalent |
| --- | --- | --- |
| `search_components` | `query`, `category`, `detail`, `limit` | `component list` |
| `get_component` | `componentId` | `component inspect` |
| `list_categories` | — | the `categories` field of `component list --json` |
| `get_registry_status` | — | `registry status`, provenance only — it does not recompute source drift |
| `generate_story` | `root`, `title`, `storyName`, `importMap`, `framework` | `screen generate`, but it returns the CSF source as a string and writes no file |
| `generate_implementation_context` | `screenId`, `route`, `preferredPath`, `importMap` | `screen context`, addressed by stored screen id |
| `validate_screen` | `screenId` | `screen validate` |
| `list_screens` / `get_screen` | — / `screenId` | `screen list` / `screen pull` |
| `create_screen` | `id`, `name`, `root` | `screen push` |
| `apply_screen_operations` | `screenId`, `baseRevision`, `operations` | `screen apply` |
| `duplicate_screen` | `screenId`, `newId`, `newName` | — |

`generate_story` takes `root` — the ScreenNode alone, not the whole Screen JSON — and `importMap` is
the same string the CLI takes, not an object. `search_components` returns summaries capped at
`limit` (default 50, max 200) with `total` / `truncated`; `detail: "full"` returns complete manifests.
`registry build`, `registry metadata`, and `story import` are CLI-only, and there is no MCP
equivalent of `--meta-template`.

## Next steps

- [Workflows](./workflows.md) — how these commands chain together.
- [Screen JSON](./screen-json.md) — the format `screen generate` and `screen context` consume.
