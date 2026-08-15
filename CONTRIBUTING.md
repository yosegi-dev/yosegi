# Contributing

Thanks for taking a look. This page covers what is useful to contribute and how to get a change
through. For what Yosegi is, read [`README.md`](./README.md) first.

## Ways to contribute

- **Bug reports.** Open an issue with the bug report template. A registry that comes out wrong or a
  Story that fails to generate is nearly impossible to reproduce without your Screen JSON and the
  exact command, so the template asks for both.
- **Host patterns that do not extract cleanly.** If a component's props come back empty, the
  smallest source file that reproduces it is the most valuable thing you can send. The known cases
  are in [`docs/registry.md`](./docs/registry.md).
- **Documentation.** Every page under `docs/` has a twin under `docs/ja/`; keep both in step in the
  same pull request. English is the source — write it first, then translate. How the pages are
  written — page roles, terminology, the checks to run — is in
  [`docs/conventions.md`](./docs/conventions.md).
- **Code.** Open an issue first for anything that changes the Screen JSON schema, a validation code,
  or the shape of the generated CSF — those are contracts other people's screens depend on.

## Development

Bun is only needed to develop this repository. Using Yosegi needs nothing but Node.js 22 or newer.

```sh
bun install

bun test        # every package, then scripts/
bun typecheck
bun lint        # bun lint:fix to auto-fix
bun run build
```

Run lint, test, and typecheck before you push; CI runs all four. Architecture, package layout, and
the publishing procedure are in [`docs/development.md`](./docs/development.md), and the conventions
a coding agent should follow are in [`AGENTS.md`](./AGENTS.md).

New logic needs tests. They live beside their source as `*.test.ts` and use `bun:test`. Behaviour
that only shows up in the CLI belongs in `packages/server/src/adapters/cli/cli.test.ts`.

## Language policy

- **User-facing strings are English** — CLI usage, errors, warnings, hints, MCP tool descriptions.
- **Commits, issues, and pull requests are English.**
- **Documentation is bilingual, English first.** `docs/*.md` is the English source; `docs/ja/*.md` is
  the Japanese translation. The Agent Skill under `skills/` is English only, because it is read by
  agents in a host project.
- **Code comments are English.** Write comments in English, and explain why a non-obvious decision
  was made rather than restating what the code does.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), scoped by the package touched:

```
feat(server): add a `yosegi mcp` subcommand
fix(core): stop rejecting valid screens, and check binding targets
docs: rewrite the CLI reference as a reference
```

Keep each commit a working unit that passes CI on its own, and explain in the body why the change is
the right one rather than restating the diff.

## Pull requests

Say what changed and why, and include the output of any command whose behaviour you changed. If the
change is user-visible, update the docs in the same pull request — both languages. The pull request
template asks for exactly that; fill in its checklist rather than removing it.
