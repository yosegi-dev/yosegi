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
| Component Manifest | `/manifests/components.json`, generated from static analysis of the CSF files in the Storybook plus prop extraction through the `reactDocgen` option. While in preview, Storybook states the schema "is not yet stable and should not be considered a public API" |
| `@storybook/addon-mcp` | An MCP server at `/mcp` on the running dev server. Toolsets: development (`get-changed-stories`, `get-storybook-story-instructions`, `preview-stories`), docs (`list-all-documentation`, `get-documentation`, `get-documentation-for-story`), testing (`run-story-tests`) |

Both are React-only for now and assume a running Storybook: the MCP endpoint lives on the dev
server, and the manifest is served by it or by a built Storybook.

## Where they overlap

Both tools give the agent a typed component catalog, and both have the agent write Stories. A host
where every usable component has a Story, and where a dev server is always up while agents work,
may be fully served by the official MCP alone.

## What only Yosegi does

### Validation before JSX exists

Screen JSON is a declarative intermediate form, checked against the registry before any JSX is
written. Errors come back as machine-readable codes with a `suggestion` the agent applies and
re-runs — the self-correction loop in [workflows](./workflows.md#validation-error-codes).
Storybook's testing tools check at runtime, after the code exists.

### Components without a Story

The manifest is generated from CSF files, so a component with no Story is structurally out of its
reach. The registry reads the TypeScript source directly: on the production design system measured
in [the registry page](./registry.md#measured-results), 60 of 278 components had no Story of their
own — and that is where assembly-critical pieces like a `CardHeader` live.

### The downstream half

`story import` reads a generated Story back into Screen JSON, and `screen context` expands it into
implementation context — imports to paste, props in use, slot structure, wiring tasks. The official
tooling ends at the Story.

### No dev server required

The registry builds from source files and a tsconfig. Storybook's `index.json` is an optional
curation input and can be a static file, so nothing has to be running — usable in CI or on a fresh
checkout.

## Where the line sits

Yosegi owns static validation before render and screen assembly. Rendering, interaction tests, and
accessibility checks are runtime questions, and Storybook MCP — or a browser — is the right owner
for them. The two compose:

1. Assemble and validate the screen with Yosegi; `screen generate` writes the Story.
2. The host's type check reads the JSX against the real component types.
3. Storybook MCP's `run-story-tests` (and `preview-stories`) confirm it at runtime.

Each stage catches what the previous one cannot see.
