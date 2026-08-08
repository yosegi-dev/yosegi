# @yosegi/core

The framework-agnostic domain layer behind [Yosegi](https://github.com/yosegi-dev/yosegi): the
Screen JSON schema, its validator, the Screen JSON → CSF emitter, and registry normalization. Its only dependency is zod. It touches neither the filesystem nor the TypeScript
compiler.

Most people do not install this directly — install
[`@yosegi/yosegi`](https://www.npmjs.com/package/@yosegi/yosegi), which carries the CLI, the MCP
server, and the Agent Skill, and which depends on this package. Install `@yosegi/core` on its own
only to embed the domain layer in your own tooling.

## Install

```sh
# npm
npm i @yosegi/core
# pnpm
pnpm add @yosegi/core
# yarn
yarn add @yosegi/core
# bun
bun add @yosegi/core
```

Requires Node.js 20 or newer.

## Entry points

| Import | Contents |
| --- | --- |
| `@yosegi/core` | Screen JSON schema, validator, synthetic primitives, suggestions |
| `@yosegi/core/app` | Composer, services, screen repository, actor and implementation context |
| `@yosegi/core/emit` | Screen JSON → CSF |
| `@yosegi/core/registry` | Storybook `index.json` → registry normalization |
| `@yosegi/core/testing` | Fixtures shared by tests |

## Documentation

See the [repository README](https://github.com/yosegi-dev/yosegi#readme) and
[`docs/`](https://github.com/yosegi-dev/yosegi/tree/main/docs).

MIT licensed.
