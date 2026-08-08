# @yosegi/yosegi

The Yosegi CLI, MCP server, and Agent Skill.

Yosegi assembles screen UIs out of components already registered in a host project's Storybook,
emits the result as a Story (`.stories.tsx`), and then turns that Story into a real implementation.
Its users are coding agents, so the entry points are a CLI, an MCP server, and an Agent Skill —
there is no GUI. The catalogue of usable components is derived from the host's own TypeScript types.

This is the package to install. It depends on [`@yosegi/core`](https://www.npmjs.com/package/@yosegi/core),
which holds the framework-agnostic domain layer and is not meant to be installed on its own.

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

For React + TypeScript projects, on Node.js 20 or newer. A TypeScript compiler (5.4 or newer) is
used at runtime to read the host's types; if the host project already has one, it is reused.

## Use

```sh
npx yosegi                 # every command (also: pnpm yosegi, yarn yosegi, bunx yosegi)
npx yosegi registry build --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json
```

State is written to `./.yosegi` in the current directory by default; `--data-dir <dir>` moves it.

The Agent Skill ships inside this package at `skills/yosegi/`, so it can be copied out of
`node_modules` and pinned to the installed version.

## Documentation

See the [repository README](https://github.com/yosegi-dev/yosegi#readme) for the full picture, and
[`docs/`](https://github.com/yosegi-dev/yosegi/tree/main/docs) for getting started, the CLI
reference, and the registry format.

MIT licensed.
