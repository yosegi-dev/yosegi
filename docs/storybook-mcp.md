# Storybook MCP and Yosegi

English | [日本語](./ja/storybook-mcp.md)

Storybook ships an official AI integration, and it overlaps with Yosegi's problem: hand an agent a
typed catalog of the host's components and have it write Stories. This page states what each side
covers, so you can decide whether you need one, the other, or both.

The facts below were checked against storybook.js.org documentation and release posts in August
2026. Storybook marks these features as preview, so verify details against its current docs before
depending on them.

## What Storybook ships

Storybook 10.3 (April 2026) introduced "Storybook MCP for React", and 10.4 (May 2026) added
agent-driven setup. As of 10.5 the official pieces are:

| Piece | What it is |
| --- | --- |
| Component Manifest | A JSON catalog of a Storybook's components, produced from static analysis of the CSF files in it plus prop extraction over their source. Being Story-derived, it carries what the Stories say — usage snippets among it. While in preview, Storybook states the schema "is not yet stable and should not be considered a public API" |
| `@storybook/addon-mcp` | An MCP server over that Storybook, serving the catalog to an agent alongside toolsets for documentation and for running Story tests |

Both are React-only for now. A running dev server is no longer the only way in: publishing a
Storybook through Chromatic publishes its MCP server too, and `@storybook/mcp` exposes
`createStorybookMcpHandler()` for a team that would rather host its own. The toolsets that act on a
live instance still need one.

## Where they overlap

Both tools give the agent a typed component catalog, and both have the agent write Stories. A host
where every usable component has a Story, and where a Storybook builds or runs while agents work,
may be fully served by the official MCP alone.

That overlap is widening rather than narrowing. Storybook's "Design Systems with Agents" RFC opens
from the same problem Yosegi does — an agent that regenerates its own components instead of reaching
for the design system's — and the reference server it proposes is built on the same three moves as
`component list`, `--query`, and `component inspect`, with an experiment you can already point
Claude Code at. Read the split below as where the two sit today, not as a settled division of
labour.

## What only Yosegi does

### Validation before JSX exists

Screen JSON is a declarative intermediate form, checked against the registry before any JSX is
written. Errors come back as machine-readable codes with a `suggestion` the agent applies and
re-runs — the self-correction loop in [workflows](./workflows.md#validation-error-codes).
Storybook's testing tools check at runtime, after the code exists.

### Components without a Story

The manifest is generated from CSF files, so a component with no Story of its own is reached only
when a Story's meta declares it as a subcomponent by hand; anything nobody declared stays outside.
The registry reads the TypeScript source directly, so every exported component is in it either way:
on the production design system measured in [the registry page](./registry.md#measured-results), 60
of 278 components had no Story of their own — and that is where assembly-critical pieces like a
`CardHeader` live.

### The downstream half

`story import` reads a generated Story back into Screen JSON, and `screen context` expands it into
implementation context — imports to paste, props in use, slot structure, wiring tasks. The official
tooling ends at the Story.

### No Storybook build required

The registry builds from source files and a tsconfig alone. The manifest is a product of
`storybook build` or of a dev server, so it presumes a Storybook that installs, configures, and
builds; Yosegi presumes neither, which is what makes it usable in CI, on a fresh checkout, and on a
host with no Storybook at all — `screen generate --target component` emits the screen as a plain
React component file instead (see [Workflows](./workflows.md#without-storybook)). Storybook's
`index.json` is an optional curation input, and a static file will do.

That premise is what makes the difference structural rather than a gap tooling closes: as long as
CSF is the input, there is no manifest to build for a host that has no Stories to analyse.

## Where the line sits

Yosegi owns static validation before render and screen assembly. Rendering, interaction tests, and
accessibility checks are runtime questions, and Storybook MCP — or a browser — is the right owner
for them. That much of the split is stable; the catalog layer above it is not. The two compose:

1. Assemble and validate the screen with Yosegi; `screen generate` writes the Story.
2. The host's type check reads the JSX against the real component types.
3. Storybook MCP's `run-story-tests` (and `preview-stories`) confirm it at runtime.

Each stage catches what the previous one cannot see.
