# Getting started

English | [日本語](./ja/getting-started.md)

From an empty setup to a Story in your Storybook, and on to an implementation.

## Requirements

- A React + TypeScript project with Storybook. Yosegi reads TypeScript types and emits CSF; neither
  step has a fallback for other stacks.
- A `tsconfig.json` that resolves the host's components, including its `paths`.
- Node.js 20 or newer. Bun is only needed to develop Yosegi itself.

## Install

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

`yosegi` below means `npx yosegi` (`pnpm yosegi`, `yarn yosegi`, `bunx yosegi`). Running it with no
arguments prints every command.

## Install the Agent Skill

The skill is how an agent learns the procedure below. Install it into whichever skills directory
your agent reads — `.claude/skills/` is Claude Code's.

```sh
npx skills add yosegi-dev/yosegi
```

Or copy it out of an installed package, which pins the skill to the version you have:

```sh
mkdir -p .claude/skills
cp -R node_modules/@yosegi/yosegi/skills/yosegi .claude/skills/
```

Copy the whole directory: `SKILL.md` sends the agent into `references/` as it works. Re-copy after
upgrading. An agent can load a stale copy without saying so, so when its behaviour does not match
these pages, compare the version date under `SKILL.md`'s title against this repository's copy.

Install it into one location your agent tool actually reads. A second, untracked copy left over from
an earlier tool or a manual experiment is exactly the kind of stale copy that version-date check
exists to catch — remove it rather than leaving two in the same repository.

## Register the MCP server (optional)

```sh
claude mcp add yosegi -- npx yosegi mcp
```

The skill works either way. The CLI stays the fuller surface — building the registry and reading a
Story back are CLI-only.

## Walkthrough

```sh
# 1. Build the Component Registry from the host's types
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --data-dir .yosegi

# 2. Find the components to build from, and pin down their props
yosegi component list --query card --data-dir .yosegi
yosegi component inspect "app/components/ui/card#CardHeader" --data-dir .yosegi

# 3. Read the host's conventions (AGENTS.md, design tokens, existing composed Stories)

# 4a. Write the .stories.tsx directly — the default, and the only option when any component
#     needs a value that is not a JSON literal (a runtime object, a component reference,
#     repetition, a condition)

# 4b. Or, for a static screen, write tmp/screen.json and generate the Story from it
yosegi screen generate tmp/screen.json \
  --out app/components/screens/customer-list.stories.tsx \
  --title "Screens/Customer list" \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --data-dir .yosegi

# 5. Run the host's type check, then its formatter, then review it in the host's Storybook

# 6. Move it into an implementation. On a Yosegi-generated Story you can recover the Screen JSON
#    and expand it; on a hand-written one, read the Story instead (see Workflows)
yosegi story import app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" --out tmp/screen.json --data-dir .yosegi

yosegi screen context tmp/screen.json \
  --import-map "./app=~" --route /customers --data-dir .yosegi
```

Pass the same `--data-dir` to every command; it is where the registry and the saved screens live.
The default is `.yosegi` under the current directory.

Steps 1 and 2 are the mandatory part: a component's real props, enum options, slots, and import
specifier come from there and nowhere else. The output lands in the host's repository and is
reviewed as the host's code, so step 3 is not optional either. The
[Agent Skill](../skills/yosegi/SKILL.md) covers both.

## Worth setting up once

- Wrap `registry build` in a repository script (`bun run yosegi:registry`). Nobody then has to
  remember `--source` / `--tsconfig` / `--index`.
- Write the meta boilerplate your Stories require (`tags`, Docs page, design references) into a
  template file, and pass it as `screen generate --meta-template`.
- Point the agent at the host's Story conventions, design tokens, and a composed example Story worth
  imitating.
- If some components cannot have their props read from types, scaffold a `--metadata` file with
  `registry metadata` and wire it into the script above.

## Next steps

- [Screen JSON](./screen-json.md) — the tree you write in step 4b.
- [Workflows](./workflows.md) — the upstream and downstream loops, and the error codes.
- [CLI reference](./cli.md#invoking-the-cli) — every command and flag.
