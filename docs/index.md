---
layout: home

hero:
  name: Yosegi
  text: Screens out of the components you already have
  tagline: Assemble screen UIs from the components already in your Storybook, emit them as Stories, and turn those Stories into implementations. Driven by coding agents — a CLI, an MCP server, and an Agent Skill. No GUI.
  image:
    light: /brand/yosegi-symbol.svg
    dark: /brand/yosegi-symbol-light.svg
    alt: Yosegi
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Workflows
      link: /workflows
    - theme: alt
      text: GitHub
      link: https://github.com/yosegi-dev/yosegi

features:
  - title: A registry built from your types
    details: Your source's TypeScript types become the component catalog. Props, slots, enum options, and the import specifier you actually write all come from types; nothing is hand-written.
  - title: The Story is the deliverable
    details: The agent writes the .stories.tsx against those facts, or routes a static screen through Screen JSON first for machine-readable validation it can self-correct from.
  - title: Reviewed in your own Storybook
    details: The Story drops into your Storybook, after your own type check has read the JSX against the real component types. Yosegi has no renderer of its own.
  - title: Then it becomes a page
    details: The approved Story carries implementation context — imports to paste, props in use, slot structure, and the wiring still to do.
---

## Measured on a production design system

278 components from 120 files in about 4 seconds, 98.9% with props read from types, deterministic
output. How types become a catalog, and what the numbers mean:
[Component Registry](./registry.md).

And benchmarked across four UI libraries: an agent given any carrier of your components' API —
the source, a package's `.d.ts`, or the registry — produces the same clean screen. The registry
is the smallest of those reads at design-system scale: a fifth of the source, a third of the
`.d.ts` a package ships. Same output, least context: [Benchmark](./benchmark.md).

## Install

Requires Node.js 22+. Any package manager.

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

Then install the Agent Skill, which is the primary way to use Yosegi:

```sh
npx skills add yosegi-dev/yosegi
```

Then: *"build me a screen proposal from the existing components"*.

> *Yosegi* (寄木細工) is a Japanese marquetry technique: small pieces of wood gathered into one
> pattern. The tool gathers design system components into a screen.
