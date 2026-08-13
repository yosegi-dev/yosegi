# AGENTS.md

Guidance for coding agents working in this repository. For what Yosegi is and how to use it, read
[`README.md`](./README.md) first; for how to get a change through as an outside contributor, read
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Project overview

Yosegi assembles screen UIs out of components already registered in a host project's Storybook,
emits the result as a Story (`.stories.tsx`), and then turns that Story into a real implementation.
Its users are coding agents, so the only entry points are a CLI, an MCP server, and an Agent Skill —
there is no GUI, and no rendering environment of its own. The registry of usable components is
derived from the host's TypeScript types, and the design centres on two properties: output an agent
can read, and validation an agent can self-correct from.

## Architecture

A Bun workspaces monorepo with two packages.

- `packages/core` (`@yosegi/core`) — framework-agnostic, with zod as its only dependency. Keep it
  that way: no filesystem-dependent or TypeScript-compiler-dependent code belongs here.
  - `src/domain` (`@yosegi/core`) — Screen JSON schema, validator, synthetic primitives, suggestions
  - `src/application` (`@yosegi/core/app`) — Composer, services, repository, actor context,
    implementation context
  - `src/emit` (`@yosegi/core/emit`) — Screen JSON → CSF, or a plain component file
  - `src/registry` (`@yosegi/core/registry`) — Storybook index.json → registry normalization
  - `src/test-fixtures.ts` (`@yosegi/core/testing`) — fixtures shared by tests
- `packages/server` (`@yosegi/yosegi`) — the CLI, MCP, and HTTP (Hono) adapters, plus persistence.
  The published name is `@yosegi/yosegi` because it is the one package a user installs and it owns
  the `yosegi` bin; the directory keeps its `server` name, which describes the layer rather than the
  distribution. It is a thin wrapper around core, and it is where anything needing the TypeScript
  compiler lives:
  registry generation from host types (`src/registry/source-registry.ts`, via
  react-docgen-typescript), reading Stories back through the AST (`src/importer/story-importer.ts`),
  and parsing meta templates (`src/emit/meta-template.ts`). `bin/yosegi.js` is the single command
  entry point.

The Agent Skill lives at `skills/yosegi/` in the repository root — `SKILL.md` (the procedure) plus
`references/` (registry, CLI, Screen JSON, errors, implementation), which `SKILL.md` tells the agent
when to open. That is the copy to edit; `npx skills add`-style installers read it from there. It is
distributed as a self-contained unit, so it must never link out to `docs/` or to a URL for anything
essential. `@yosegi/yosegi` ships it as well, via
`packages/server/scripts/sync-skills.ts`, which mirrors the root `skills/` into
`packages/server/skills/` (generated, gitignored) on `build` and on `prepack`. Never edit the
mirror. See [`docs/development.md`](./docs/development.md).

Each package's `package.json` `exports` points at `dist/`, which `tsc` produces. During development
the `paths` in `packages/server/tsconfig.json` resolve `@yosegi/*` to core's sources, so `bun test`
and `tsc` work without a build. Only `bin/yosegi.js` needs `dist/`, because it imports the built CLI
module directly.

## Commands

```sh
bun install

bun test        # every package, then scripts/
bun typecheck
bun lint        # bun lint:fix to auto-fix
bun run build   # @yosegi/core then @yosegi/yosegi, in dependency order
bun run pack    # the tarballs a release would publish, verified
```

`scripts/` sits outside the workspaces, so `bun --filter` does not reach it. `bun test` and
`bun typecheck` at the root pick it up; a bare `bun --filter '@yosegi/*' ...` does not.

Run lint, test, and typecheck before committing. CI (`.github/workflows/ci.yml`) runs all four on
push, on pull requests, and weekly.

`bunfig.toml` sets `install.linker = "isolated"`, so `node_modules` is not hoisted: a package can
only import what its own `package.json` declares. Add the dependency to the package that imports it
rather than relying on another package having pulled it in.

To exercise the CLI against a host without building, use
`bun --filter '@yosegi/yosegi' cli <command>` (note that the cwd becomes `packages/server`, so
relative paths shift).

## Coding conventions

- Biome (`biome.json`) owns formatting and linting: tabs for indentation. Do not hand-format.
- Relative imports carry an explicit `.ts` extension. The build tsconfigs turn those into `.js` via
  `rewriteRelativeImportExtensions`, which is what lets Node's ESM resolver read `dist`. An import
  written without the extension still passes lint, tests, and typecheck — it only breaks consumers
  who are not on Bun, and the `node-consumer` CI job is what catches it.
- `biome-ignore` and `@ts-ignore` are not allowed. Neither is `any` — write a concrete type.
- Express a nullable value as `| null` and use `null` rather than `undefined`.
- TypeScript strict mode is on. Keep it that way.
- Tests live beside their source as `*.test.ts`, and use `bun:test`. New logic needs tests; new
  behaviour that only shows up in the CLI belongs in `packages/server/src/adapters/cli/cli.test.ts`.
- User-facing strings (CLI usage, errors, warnings, hints, MCP tool descriptions) and code comments
  are English.
- Comments explain why a decision was made, especially where the obvious implementation was
  rejected. Do not narrate what the code already says.

## Documentation

Each page owns one subject: `README.md` is the face, `docs/cli.md` is a flag reference and nothing
else, `docs/screen-json.md` is the format spec, and a concept is explained only where it is owned.
Prose is a command block plus one line of purpose — cut anything that does not change what the reader
does next. Stack package managers npm / pnpm / yarn / bun, and quote globs. Every `docs/x.md` has a
`docs/ja/x.md` twin with the same headings, code blocks, and tables, changed in the same commit. No host
project names, host-specific component names, or absolute local paths, and `skills/yosegi/` stays
self-contained. Full version, terminology list, and the checks to run before committing:
[`docs/conventions.md`](./docs/conventions.md).

## Commits

Conventional Commits, written in English, scoped by the package they touch
(`feat(server): ...`, `refactor(core,server): ...`). Keep each commit a working unit that passes CI
on its own.

## Publishing

`bun run build` alone does not prove that what ships actually runs. Because of the `files` field the
tarballs carry only a subset of each package, so verify from outside the workspace. The full
procedure and the publish steps are in [`docs/development.md`](./docs/development.md).

`bun run pack [dir]` (`scripts/pack.ts`) is the only supported way to build a tarball, and both CI
and the release workflow go through it. Never publish by running `npm publish` inside a package
directory: npm does not understand Bun's `catalog:` protocol, so it packs the literal string and
every consumer install fails with EUNSUPPORTEDPROTOCOL — with no warning from
`npm publish --dry-run`. `bun pm pack` resolves it, so pack with Bun and pass the tarball path to
`npm publish`. The script also refuses to emit a tarball that still contains `catalog:` or
`workspace:`, or one missing a file its own `exports` / `bin` / `main` / `types` names.

Both packages depend on a pinned version rather than `workspace:*`. When you bump a version, update
`packages/server`'s `@yosegi/core` dependency and `bun.lock` in the same commit — `bun pm pack`
takes the substituted version from the lockfile, so a stale lockfile packs a dependency on a version
that does not exist.

The same applies to the catalog, which now holds `zod` alone. `bun pm pack` substitutes the entry
into the tarball, and it takes what it substitutes from `bun.lock` rather than from the `catalog`
block — editing the catalog without running `bun install` packs the old value and nothing warns you,
so always commit the two together. The value may be a range (`^4.4.3`), and a range is packed
verbatim rather than collapsed to the resolved version.

A dependency that reaches a published `.d.ts` takes a caret range, never an exact pin. Its copy and
the consumer's have to unify, and a class carrying `private` members — `Hono`, `McpServer` — is typed
nominally, so a second copy is a type error the consumer has no way to work around. That covers
`zod`, `hono`, and `@modelcontextprotocol/sdk`. `typescript` takes a range for the same reason plus
size: the host already has one, and an exact pin nests a second 23MB copy. A dependency the consumer
cannot reach stays exactly pinned, because reproducibility outweighs unification —
`react-docgen-typescript` decides what the registry extracts, so the same host source has to keep
producing the same registry. The root's `typescript` devDependency stays exact for the same reason:
it is the compiler that produces `dist`.

`typescript`'s range carries an upper bound, `<7`, and it is not stale. TypeScript 7.0 ships no
compiler API, so raising it hands hosts a build that cannot read a single type. `docgen.ts` turns
that into the alias hosts on 7 should install; the reasoning and what would let the bound move are in
[`docs/ROADMAP.md`](./docs/ROADMAP.md).

`@yosegi/core` is the deliberate exception. It reaches `packages/server`'s `.d.ts` through
`Composer`, but stays exactly pinned because the two packages release in lockstep and `bun pm pack`
substitutes the version from the lockfile. Revisit it if embedding the HTTP app ever becomes a
supported use case, since an embedder constructs its own `Composer`.

The `node-consumer` CI job is what keeps the rule honest: it installs the host's own copy of every
consumer-facing dependency before the tarball, then fails if any of them ends up duplicated. Add to
that list whenever a new dependency reaches a published `.d.ts` — the check is the only thing
standing between an exact pin and a consumer who cannot compile.

What is planned next is tracked in [`docs/ROADMAP.md`](./docs/ROADMAP.md).
