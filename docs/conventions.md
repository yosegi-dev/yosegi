# Documentation conventions

English | [日本語](./ja/conventions.md)

How the pages in this repository are written. Read it before editing `README.md`, anything under
`docs/`, or the Agent Skill.

## Page roles

Each page owns one subject. A concept is explained once, on the page that owns it; every other page
links there.

| Page | What it is | Keep out of it |
| --- | --- | --- |
| `README.md` | The face: value in the first lines, how it works in five steps, a minimal quickstart, links out | Flag tables, troubleshooting, anything a linked page owns |
| `docs/getting-started.md` | The walkthrough — requirements, install, the numbered path to a Story and on to an implementation | Full flag lists, extraction internals |
| `docs/cli.md` | Reference only. Per command: synopsis, an options table (flag / type / default / meaning), one short example | Conceptual explanation, tutorials, procedures that chain commands |
| `docs/screen-json.md` | The format spec — fields, component ids, synthetic primitives, `bindings` / `events` | Flags, and the loops that produce the file |
| `docs/workflows.md` | Use cases, the upstream and downstream loops, the error and warning codes | Flag semantics |
| `docs/registry.md` | How types become a catalog, the measurements, the patterns that do not extract | Command reference |
| `docs/storybook-mcp.md` | The overlap with Storybook's official MCP, and the split | Anything another page owns; restating Storybook's own docs |
| `docs/development.md` | Working on this repository: layout, commands, pre-publish verification, release | How to use Yosegi in a host |
| `docs/ROADMAP.md` | Planned work and open questions | Anything already shipped |
| `docs/conventions.md` | This page | Coding conventions — those live in [`AGENTS.md`](../AGENTS.md) |
| `skills/yosegi/**` | The unit distributed to a host project, read by an agent | Links out of the skill (see below) |

## Prose budget

- A step is a command block plus one line of purpose. Nothing else.
- Cut any sentence that does not change what the reader does next.
- No connective filler, no "as mentioned above", no paragraph restating the previous one.
- Prefer a table to a list, and a list to a paragraph.
- Wrap English at 100 columns. A Japanese line carries one sentence, however long, and is never
  broken in the middle of one. Two sentences share a line where no break is available: the stop
  sits inside inline code or a bracket pair, or the next character is not Japanese — a break there
  renders as a space, which the pages never write.

## Command examples

Package managers are stacked in one block, in this fixed order, in exactly this form:

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

- State the invocation once per page — "`yosegi` below means `npx yosegi` (`pnpm yosegi`,
  `yarn yosegi`, `bunx yosegi`)" — then write a bare `yosegi` in every example on it.
- Always quote globs: `--source "app/components/**/*.tsx"`. An unquoted one is expanded by the shell
  before the CLI sees it.
- Break a long invocation with `\`, one flag per line, and pass `--data-dir` explicitly.

## Terminology

| Concept | English | Japanese | Do not write |
| --- | --- | --- | --- |
| The component catalog | Component Registry, short "the registry" | Component Registry, short "Registry" | `台帳`, `コンポーネント一覧`, `"component index"` |
| A UI building block | `component` | コンポーネント | `部品`; bare `component` in Japanese prose |
| The registry's per-component record | `manifest` (`ComponentManifest`) | Manifest | lowercase `manifest` in Japanese prose |
| A validation failure | `error` | エラー | `error` as-is in Japanese prose |
| A non-blocking finding | `warning` | 警告 | `warning` as-is in Japanese prose |
| The Story-derived signal | `curation` | キュレーション | `curation` as-is in Japanese prose |
| Code from outside the host | `third-party` | サードパーティ | `第三者` |
| Exposing another module's export | `re-export` | 再 export | `再エクスポート` |
| A component wrapping another | `wrapper` | ラッパー | `wrapper` as-is in Japanese prose |
| The MCP / dev server | `server` | サーバ | `サーバー` |
| A pinned, single version | `exact version` | 厳密なバージョン | `実バージョン` |
| A substituted, existing version | `a real version` | 実際のバージョン | `実バージョン` |
| npm's package registry | `npm registry` | npm レジストリ | bare `レジストリ` — it collides with the Registry |
| The intermediate tree | Screen JSON | Screen JSON | Screen Definition, 画面定義, "screen spec" |
| `Text` / `Box` / `Heading` | synthetic primitives | 合成プリミティブ | built-ins, fallback components |
| The project Yosegi runs against | the host | ホスト | your project, the client, the consumer app |
| The deliverable | Story (capitalised), CSF for the format | Story, CSF | story file, snapshot |
| The installed package | `@yosegi/yosegi` | `@yosegi/yosegi` | `@yosegi/server` — that is a directory, not a package |
| The packaged procedure | Agent Skill, short "the skill" | Agent Skill, short "Skill" | plugin, prompt pack |

## English / Japanese parity

English is the source. Write a page or an edit in English first, translate it to Japanese, and land
both in the same commit. `bun run textlint` checks the translated Japanese — `README.ja.md` and
everything under `docs/ja/**` (`.textlintrc.json`); English pages are not linted.

- Every `docs/x.md` has a twin at `docs/ja/x.md`, and `README.md` has `README.ja.md` next to it at
  the repository root. Both change in the same commit.
- The line under the H1 is the switcher: `English | [日本語](./ja/x.md)` on the English side,
  `[English](../x.md) | 日本語` on the Japanese side.
- Japanese prose is written in the polite です / ます register. Headings, and the nominal or
  imperative fragments that act as labels, stay as they are. `no-mix-dearu-desumasu` checks it.
- Same headings in the same order, same code blocks, same tables. Comments inside a code block are
  translated; the commands themselves are not.
- A diagram is a ```` ```mermaid ```` fence, and its labels are translated. The parity check blanks
  quoted text and compares what is left — node ids, arrows, direction — so quote every label, and
  keep the two sides the same diagram.
- A Japanese page links to a sibling Japanese page with `./x.md` — both live in `docs/ja/`. It links
  to an English-only target one level up (`../x.md`, another page under `docs/`) or two levels up
  (`../../x.md`, a repository-root file such as `AGENTS.md` or `CONTRIBUTING.md`). Identifiers,
  flags, error codes, and paths stay in English on both sides.
- `skills/` is English only — it is read by agents working in a host project.

## Translation review checklist

Reviewing a Japanese page against its English source, check that the translation:

- adds no evaluation, conclusion, or reasoning the English does not have.
- keeps hedges (may, usually, still, ...) exactly where the English has them — none dropped, none
  invented.
- keeps negations and conditional clauses as written; a condition must not come back as a reason.
- translates headings in full, conditions included.
- renders the same English sentence identically wherever it appears across pages.
- introduces no translation the terminology table does not list.
- is laid out one sentence per line after translating, under the rule in [Prose
  budget](#prose-budget) — including the stops that are not break points.
- does not copy an English em dash (—) as 「——」; parentheses or a sentence split take its place.

## Anonymity

- No real host project or company names, no host-specific component names, no absolute local paths
  (write `<repo>` for the path to a clone). Example ids take the generic shape
  `app/components/ui/button#Button`.
- Measurements name their subject generically ("a production React design system"), and a component
  under discussion becomes a description ("a charting-library wrapper").

## Skill self-containment

- `skills/yosegi/` must never depend on `docs/` or on a URL for anything essential. `SKILL.md` sends
  the reader into `references/` and nowhere else, so content overlapping a `docs/` page is
  duplicated there on purpose and kept in step by hand.
- Edit `skills/yosegi/`. `packages/server/skills/` is a generated mirror — never edit it.

## Checks before committing docs

Run every command a page shows, against a scratch React + TypeScript host outside this repository —
`docs/` examples assume an installed CLI, so drive it through `bin/yosegi.js`:

```sh
cd <scratch-host>
node <repo>/packages/server/bin/yosegi.js registry build \
  --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --data-dir .yosegi
```

Then, from the repository root, check that links and anchors resolve, that the twins line up —
headings and table rows in matching numbers, fences matching in content with translated comments
set aside — and that the lines are laid out: English within 100 columns counted in East Asian
character width, Japanese one sentence per line wherever a break is available (tables, code blocks,
and front matter are exempt from both):

```sh
bun run check:docs
```

The script is `scripts/check-docs.ts`, and CI runs it on every push.

If `docs/ja/**` changed — authored or re-translated — run `bun run textlint` and fix every
violation. It is the self-review on the translated output; do not commit with violations.

If anything under `skills/` changed, update the `Version:` date at the top of
`skills/yosegi/SKILL.md` to the commit's date, in the same commit. It is how an agent tells a stale
installed copy from a current one, so a skill edit that leaves the date behind silently defeats that
check.

Finish with `bun lint`.

## Next steps

- [`AGENTS.md`](../AGENTS.md) — the conventions for the code itself.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to get a change through.
