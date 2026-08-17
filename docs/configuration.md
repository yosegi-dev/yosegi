# Configuration file

English | [日本語](./ja/configuration.md)

`yosegi.config.json` holds the host-specific paths every command would otherwise take as flags.
It is optional: flags alone remain a complete invocation.

## Where it is found

```sh
yosegi component list                          # search upwards from the cwd
yosegi component list --config ./tools/yosegi.config.json
```

Without `--config`, Yosegi looks for `yosegi.config.json` in the cwd and then in each parent
directory up to the filesystem root, the way tsconfig resolution does. The first one found wins, so
a workspace package can override the repository root. Finding none is not an error.

`--config <path>` is accepted by every command and skips the search. A path that does not exist
fails with `CONFIG_NOT_FOUND`.

## How paths inside it resolve

Every path in the file is read against the file's own directory, never the cwd. That is what makes
one committed config mean the same thing from anywhere in the host.

`registry.source` is the exception: those globs keep the base `--source` globs always had —
`--project-root`, which defaults to the directory holding the tsconfig. That base is also what
component ids are derived from, so rewriting the globs here would change which ids a build produces.

## Schema

```json
{
  "dataDir": ".yosegi",
  "registry": {
    "source": ["app/components/**/*.tsx"],
    "tsconfig": "./tsconfig.json",
    "metadata": "./tools/yosegi-metadata.json"
  },
  "emit": {
    "importMap": ["./app=~"],
    "metaTemplate": "./.storybook/screen-meta.tsx"
  },
  "examples": []
}
```

| Key | Type | Supplies the default for | Meaning |
| --- | --- | --- | --- |
| `$schema` | string | — | Accepted so an editor can be pointed at a JSON Schema. Yosegi ignores it, and ships none |
| `dataDir` | path | `--data-dir`, every command | Where the registry and the saved screens live |
| `registry.source` | glob array | `--source`, `registry build` | Resolved against `--project-root`, not against this file |
| `registry.tsconfig` | path | `--tsconfig`, `registry build` | Also moves the default `--project-root` with it |
| `registry.metadata` | path | `--metadata`, `registry build` | Hand-supplied props for components whose types could not be read |
| `emit.importMap` | string array | `--import-map`, `screen generate` | One `<from>=<to>` per entry; joined into the single string the flag takes |
| `emit.metaTemplate` | path | `--meta-template`, `screen generate` | Not applied to `--target component`, which writes a file with no Story meta |
| `examples` | object array | `--catalog`, `example list` / `example apply` | A catalog of whole screens the host keeps as templates |

Every key is optional, so a config can carry just the one default a host cares about. An `examples`
entry takes `key`, `label`, `description`, `templatePath`, and `componentName`, all required, with
`key` unique across the array.

`examples` is the catalog itself rather than a path to one, so the `example` commands read it in
place: `--catalog` first, then this section, then `examples.json` under `--data-dir`. A section that
is absent or empty falls through to that file.

## Precedence

A flag beats the file, and the file beats the built-in default. Nothing merges: a `--source` on the
command line replaces the config's list rather than adding to it, so a build can still be narrowed
to one glob.

```sh
yosegi registry build                          # --source and --tsconfig from the config
yosegi registry build --source "app/ui/**/*.tsx"   # this glob only; the config's list is unused
yosegi example list                            # the catalog from the config's examples section
yosegi example list --catalog ./examples.json  # this file only; the config's section is unused
```

The value that actually won is what `registry build` records in `inputs`, so the rebuild line
`component list` prints stays reproducible and `registry status` recomputes from what the build
really used. See [CLI reference](./cli.md#registry-status).

## When it is rejected

A config that cannot be used fails the command outright, with the usual `error.code` JSON and exit
code 1. It is never downgraded to a warning: a setting the caller believes is in effect but is not
is the failure mode this file has to avoid.

| Code | Cause |
| --- | --- |
| `CONFIG_NOT_FOUND` | `--config` names a file that does not exist. Discovery finding none is not an error |
| `CONFIG_INVALID` | Unparsable JSON, a value of the wrong type, a key the schema does not know, or a duplicate `examples` key |

An unknown key comes back with the nearest candidate, the same way `UNKNOWN_FLAG` does. A broken
config also stops the upward search rather than being climbed past.

The file is plain JSON, so reading it never needs the TypeScript compiler API — the commands that
work without one keep working without one.

## Next steps

- [CLI reference](./cli.md) — every command and flag.
- [Getting started](./getting-started.md) — the walkthrough these defaults shorten.
