<!-- Pull requests are English (CONTRIBUTING.md, "Language policy"). Delete any section that does
not apply, and delete these comments. -->

## Why

<!-- The problem, not the diff. Link the issue if there is one. A change to the Screen JSON schema,
a validation code, or the shape of the generated CSF needs an issue first — other people's screens
depend on those. -->

## What

<!-- What changed, grouped by area. Include the output of any command whose behaviour you changed:
the error JSON, the statistics block, the generated Story. -->

## Out of scope

<!-- What was deliberately left out, and why. -->

## Checks

- [ ] `bun lint`
- [ ] `bun test`
- [ ] `bun typecheck`
- [ ] New logic has tests beside its source (`*.test.ts`); CLI-only behaviour is covered in
      `packages/server/src/adapters/cli/cli.test.ts`
- [ ] User-visible changes update the docs in both languages in this pull request — `docs/x.md` with
      `docs/ja/x.md`, `README.md` with `README.ja.md` — and `bun run textlint` passes if
      `docs/ja/**` changed
- [ ] `skills/yosegi/**` updated if a command, a flag, an error code, or the Screen JSON format
      changed. The skill is self-contained, so updating `docs/` alone leaves it stale
