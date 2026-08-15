# Development

English | [日本語](./ja/development.md)

Working on Yosegi itself: how the monorepo is laid out, the commands you run, and how to verify a
build before publishing. For contribution etiquette, see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Packages (a Bun workspaces monorepo)

- `packages/core` — `@yosegi/core`. Framework-agnostic; zod is its only dependency.
  - `.` … domain (Screen JSON schema, validator, synthetic primitives, suggestions)
  - `./app` … application (Composer / Service / Repository / ActorContext / implementation context)
  - `./emit` … Screen JSON → CSF (`.stories.tsx`)
  - `./registry` … Storybook index.json → registry normalization
  - `./testing` … test fixtures
- `packages/server` — `@yosegi/yosegi`. The CLI / MCP / HTTP (Hono) adapters plus persistence, and a
  thin wrapper around core. `bin/yosegi.js` is the single command entry point.
  - `src/registry/source-registry.ts` … registry generation from TypeScript types
  - `src/importer/story-importer.ts` … Story (AST) → Screen JSON

The published name is `@yosegi/yosegi` because it is the one package a user installs and it owns the
`yosegi` bin; the directory keeps its `server` name, which describes the layer rather than the
distribution. Type extraction (react-docgen-typescript) and AST analysis live there, keeping core on
zod alone.

## Where the Agent Skill lives

The canonical copy is `skills/yosegi/` at the repository root — `SKILL.md` and the `references/`
files it points at — and that is the only one to edit. Installers of the
`npx skills add <owner>/<repo>` family discover skills at `skills/<name>/SKILL.md` in the repository
itself, so the directory has to stay there.

`@yosegi/yosegi` also ships it, for consumers who would rather copy it out of `node_modules`.
`files` cannot reach outside the package directory, so `packages/server/scripts/sync-skills.ts`
copies the root `skills/` into `packages/server/skills/` — a generated, gitignored mirror that both
`bun run build` and the package's `prepack` refresh. `files` overrides `.gitignore`, so the mirror
is packed even though it is untracked, and the published copy cannot be stale.

```sh
bun run sync:skills                                # refresh the mirror (from the repository root)
bun --filter '@yosegi/yosegi' sync:skills:check    # report drift without rewriting
```

Never edit `packages/server/skills/` — the next sync discards it.

## Commands

```sh
bun install

bun test        # every package, then scripts/
bun typecheck
bun lint        # bun lint:fix to auto-fix
bun run build   # @yosegi/core then @yosegi/yosegi, in dependency order
bun run pack    # the tarballs a release would publish, verified
```

Each package emits `dist/` (JS plus `.d.ts`) via `tsc`, and its `package.json` `exports` point
there. During development the `paths` in each package's `tsconfig.json` resolve `@yosegi/*` to the
sources, so `bun test` and `tsc` work without a build.

`scripts/` sits outside the workspaces, so `bun --filter` does not reach it. The root `bun test` and
`bun typecheck` pick it up.

CI (`.github/workflows/ci.yml`) runs lint, test, typecheck, and build on push, on pull requests, and
weekly.

## Dependency versions

Versions used by more than one package live once in the root `package.json` under `catalog`, and the
packages reference them as `"catalog:"`. Today that is `zod` alone (core and server). A dependency
only one package uses stays in that package.

Dependencies a published package exposes to consumers take ranges rather than exact pins: `zod`
because it is structurally present in core's `.d.ts` and has to unify with the consumer's copy, and
`typescript` because the host already has one and an exact pin nests a second 23MB copy. The root's
`typescript` devDependency stays exact — it is the compiler that produces `dist`.

`bunfig.toml` sets `install.linker = "isolated"`, giving a non-hoisted `node_modules` where each
package sees only what it declares. Under a hoisted layout an undeclared dependency still resolves
as long as something else pulled it in, and the mistake only surfaces once a consumer installs the
published tarball into a tree that has no such neighbour.

That linker is also why the root declares five packages nothing here imports —
`@braintree/sanitize-url`, `cytoscape`, `cytoscape-cose-bilkent`, `dayjs`, `debug`. They are
mermaid's, and `vitepress-plugin-mermaid` puts them in Vite's `optimizeDeps.include`, which resolves
from the root. Without them `docs:dev` starts but every diagram stays blank; `docs:build` is
unaffected, so the check is to open a page with a diagram.

## Running the CLI against a host, from inside this repository

```sh
bun --filter '@yosegi/yosegi' cli <command>
```

The cwd becomes `packages/server`, so relative paths shift accordingly. `bun run build && node
packages/server/bin/yosegi.js <command>` exercises the built artifact instead, which is what the
published `yosegi` command actually runs.

`bin/yosegi.js` imports `dist/adapters/cli/cli.js` directly rather than going through the package's
`exports`, because the public API also re-exports the HTTP adapter and the MCP server — going
through it would pull in hono and the MCP SDK on every CLI invocation.

The shebang is `node`, and consumers need nothing but Node.js 22 or newer. What makes that work is
that relative imports in `src/` carry an explicit `.ts` extension and the build tsconfigs set
`rewriteRelativeImportExtensions`, so `dist` ends up with the `.js` extensions Node's ESM resolver
requires. Dropping either half only Bun can load the result, which is what the `node-consumer` CI
job catches.

## Pre-publish verification

`bun run build` alone does not prove that what ships actually runs: because of the `files` field the
tarballs carry only a subset of each package. Verify from outside the workspace.

```sh
bun run pack <tmp>          # prints the tarball paths, in publish order

cd <a scratch project outside this repo>
npm install <tmp>/yosegi-core-0.1.0.tgz <tmp>/yosegi-yosegi-0.1.0.tgz
```

`bun run pack` (`scripts/pack.ts`) is the only supported way to build a tarball, and both CI and the
release workflow go through it. Never run `npm publish` inside a package directory: npm does not
understand Bun's `catalog:` protocol, so it packs the literal string and every consumer install
fails with EUNSUPPORTEDPROTOCOL — with no warning from `npm publish --dry-run`. The script also
refuses to emit a tarball that still contains `catalog:` or `workspace:`, or one missing a file its
own `exports` / `bin` / `main` / `types` names.

Install with npm rather than Bun. Consumers only need Node, so Bun installing it successfully says
nothing about whether they can. The `node-consumer` CI job covers this path on every push, so doing
it by hand is for when you are changing packaging itself.

Until the version being verified is on npm, that install fails — the server tarball asks for
`@yosegi/core` at an exact version and the registry 404s. Point it at the local tarball for the
duration of the check:

```json
"overrides": { "@yosegi/core": "file:<tmp>/yosegi-core-0.1.0.tgz" }
```

Then confirm, in the scratch project:

- `@yosegi/core` and its subpaths (`/app`, `/emit`, `/registry`) import and resolve their types.
- `node ./node_modules/.bin/yosegi` runs and prints usage (it exits 1 with no arguments, which is
  the usage error; what matters is that Node loaded `dist`).
- `node_modules/@yosegi/yosegi/skills/yosegi/` holds `SKILL.md` **and** `references/` — the skill is
  unusable with the references missing.
- `node_modules/@yosegi/yosegi/package.json` depends on `@yosegi/core` at the version being
  published, not `workspace:*`, and `zod` came out as a real version rather than `catalog:`.

That last pair is worth checking every time. `bun pm pack` substitutes versions for both
`workspace:*` and `catalog:`, but it takes them from `bun.lock` rather than from `package.json`.
Bumping a version — or editing the root `catalog` — without re-running `bun install` packs the old
value, or one that does not exist, and nothing warns you. So `@yosegi/core` is pinned to an explicit
version in `packages/server/package.json`, and `bun.lock` has to be updated in the same commit as
any version or catalog change.

## Versioning

Pre-1.0: minor versions may include breaking changes. Both packages are versioned together, and
`@yosegi/yosegi` depends on the exact matching `@yosegi/core`.

## Publishing

`.github/workflows/release.yml` publishes both packages on a `v*` tag. It authenticates with npm
through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so there is no npm
token in this repository and none should ever be added — the `id-token: write` permission on the
publish job is the whole credential. Provenance attestations are generated as well, which is what
lets anyone verify that a published tarball came from this repository at that commit.

Releases are npm-only. The workflow does not create a GitHub Release and does not generate release
notes; the tag and the commit history are the record.

### One-time setup (owner only)

None of this can be done from the repository; it needs an npm account with rights over the scope.

1. Create the `yosegi` organization (scope) on npm. Both packages set `publishConfig.access` to
   `public`, since scoped packages default to restricted.
2. Make the GitHub repository public. Provenance is only generated for public repositories
   publishing public packages.
3. Configure a trusted publisher for **each** package, at
   `https://www.npmjs.com/package/@yosegi/core/access` and the same page for `@yosegi/yosegi`:
   - Organization or user: `yosegi-dev`
   - Repository: `yosegi`
   - Workflow filename: `release.yml`
   - Allowed actions: `npm publish` (configurations created after 2026-05-20 have to choose this
     explicitly; older ones defaulted to it)

   That page is per-package, so it only exists once the package does. If npm will not let you
   configure a publisher for a name that has never been published, publish `0.1.0` once by hand
   (pack with `bun run pack`, then `npm publish <tarball>` for core and then for `@yosegi/yosegi`),
   configure the trusted publishers, and let the workflow take over from the next release. Publish
   core before server either way.

### Each release

1. Bump `version` in both `package.json` files and the `@yosegi/core` dependency in
   `packages/server/package.json`, then run `bun install` so `bun.lock` records the new versions.
   The workflow refuses to publish if these disagree with the tag.
2. Commit, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow runs lint, tests, typecheck, and the build first, and only then publishes core followed
by server. The order matters: server depends on an exact version of core, so an install landing
between the two publishes would fail to resolve.

## Next steps

- [Roadmap](./ROADMAP.md) — planned work and open design questions.
- [`AGENTS.md`](../AGENTS.md) — for working in this repository as a coding agent.
- [Documentation conventions](./conventions.md) — before editing any page.
