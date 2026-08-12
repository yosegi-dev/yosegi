# Screen JSON

English | [日本語](./ja/screen-json.md)

The screen tree Yosegi turns into a Story. `screen generate` validates it against the Component
Registry before writing anything, so this page is the reference for whoever — usually an agent —
writes one.

Screen JSON is an intermediate representation. Treat it as a temporary file; it is not a
deliverable.

## Shape

```json
{
	"schemaVersion": "1.0",
	"id": "customer-list",
	"name": "Customer list",
	"componentRegistryVersion": "src:cd7ef20e18f1",
	"revision": 0,
	"root": {
		"id": "root",
		"component": "app/components/layout/stack#Stack",
		"props": { "gap": "lg", "className": "p-6" },
		"slots": {
			"children": [
				{
					"id": "title",
					"component": "app/components/typography#Heading",
					"props": { "level": 1 },
					"slots": {
						"children": [
							{ "id": "title-text", "component": "Text", "props": { "text": "Customers" }, "slots": {} }
						]
					}
				},
				{
					"id": "cta",
					"component": "app/components/ui/button#Button",
					"props": { "variant": "primary" },
					"slots": {
						"children": [
							{ "id": "cta-label", "component": "Text", "props": { "text": "Add customer" }, "slots": {} }
						]
					},
					"events": { "onClick": { "action": "navigate", "arguments": { "to": "/customers/new" } } }
				}
			]
		}
	}
}
```

## Top-level fields

| Field | Required | Value |
| --- | --- | --- |
| `schemaVersion` | yes | `"1.0"` |
| `id` | yes | Letters, digits, `-` and `_` only (`/^[A-Za-z0-9_-]+$/`). It becomes a file name in the screen store, so `/` and `..` are rejected |
| `name` | yes | Human-readable screen name. Feeds the default `title` (`Screens/<name>`) |
| `componentRegistryVersion` | yes | The `version` of the registry you built. Take it from `<data-dir>/registry.json` or `component list --json`. A mismatch is only a warning |
| `revision` | yes | A non-negative integer. Starts at `0` |
| `root` | yes | The root ScreenNode |
| `status` | no | `"draft"` (default) or `"published"` |

Omitting a required field is an `INVALID_REQUEST`, not a validation warning.

A ScreenNode is `{ id, component, props, slots }`, and all four are required even when `props` and
`slots` are empty (`{}`). Node `id`s must be unique across the whole screen. `slots.children`
becomes the JSX children; every other slot name is passed as a prop.

## Component ids

Ids in a registry built from types take the form `<module path relative to projectRoot>#<exportName>`.

```
app/components/ui/button#Button
app/components/ui/card#CardHeader
```

Write that id verbatim in `component`. It identifies components uniquely even when one file exports
several of them (`Card` / `CardHeader` / `CardBody`), which a bare export name cannot. Writing only
`CardHeader` produces `COMPONENT_NOT_FOUND` with the full id as the candidate.

The `--index`-only mode still produces short ids (`Button`), kept for compatibility. See
[Component Registry](./registry.md).

## Synthetic primitives

Structural components usable without being in the registry. They need no import.

| id | props | Output |
| --- | --- | --- |
| `Text` | `text` | A JSX text node |
| `Box` | `className` | `<div className=...>` (can hold `slots.children`) |
| `Heading` | `text` | `<h1 className="font-bold text-2xl tracking-tight">` |

Express the label of a real component by placing a `Text` in its `children` slot.

Synthetic primitives are told apart by id length: the short id (`"Text"`) always means the
primitive, and the host's own components use the full id
(`"app/components/typography#Text"`). When the registry also holds a component of that name,
validation emits a `SYNTHETIC_NAME_SHADOWED` warning carrying the full id as a candidate — using a
primitive is legitimate, so it is not an error. `Heading` is likewise only a default for hosts that
have none of their own; its appearance is a Yosegi default and ignores the host's typography.

## bindings / events

Values that come from data, and events, are declared in `bindings` / `events` rather than in
`props`. Both sit directly on the ScreenNode, not inside `props`, and **their shapes differ**.

| Field | Shape | Example |
| --- | --- | --- |
| `bindings` | `{ "<prop name>": "<data expression as a string>" }` | `"bindings": { "title": "segment.name" }` |
| `events` | `{ "<event name>": { "action": "<action name>", "arguments": { ... } } }` | `"events": { "onClick": { "action": "navigate", "arguments": { "to": "/x" } } }` |

A `bindings` value is the string itself; wrapping it as `{ "expression": "..." }` is a schema
violation (`INVALID_REQUEST`, with the correct form in `hints`). The `arguments` of an `events`
entry may be omitted.

Both keys are checked against the manifest. A `bindings` key naming a prop the component does not
have is an error (`UNKNOWN_BINDING_TARGET`) — the same mistake as writing a value into a prop that
does not exist. An `events` key is only a warning (`UNKNOWN_EVENT_TARGET`), because a manifest has
no event surface to check against: handlers appear only as function-typed props.

A binding target must be a prop, and in a registry built from types a `ReactNode` prop is a **slot**
rather than a prop — including `children`. To make a node's text come from data, bind a string prop
the component actually declares, or leave the text in `slots.children` and wire it up during
implementation.

A prop that carries a `bindings` entry is exempt from type validation, since its value only becomes
concrete at implementation time.

A value can never be written into a function-kind prop (`FUNCTION_PROP_VALUE`): a handler name
written as a string reaches the Story as a string. Declare handlers in `events`. Other props the
registry marks not-editable accept a value, but nothing checks its shape, so writing one warns
(`NOT_EDITABLE_PROP_VALUE`).

All declarations survive in the generated Story as hand-off comments carrying the intent as JSON,
and `story import` reads them back.

```tsx
{/* TODO(yosegi): {"bindings":{"title":"segment.name"}} */}
{/* TODO(yosegi): {"events":{"onClick":{"action":"navigate","arguments":{"to":"/customers/new"}}}} */}
```

### A binding is not a mock value

A binding says where a value comes from at implementation time; it holds nothing the mock can show.
On an optional prop the prop is simply left out and the Story renders. On a **required** prop the
emitter writes the expression into the JSX (`rows={customers}`) instead of dropping the prop, and
validation warns with `BOUND_REQUIRED_PROP` — that name does not exist in the Story, so the host's
type check stops on it. Give required props a mock value in `props` as well, and keep the binding as
the intent. Required handlers are the exception: they are filled with a no-op `() => {}`, so
declaring them in `events` is enough.

## when / each

A node may also carry `when` (conditional display) and `each` (repetition), both free-form strings
with no grammar and no validation. Neither produces any JSX, so a screen declaring `each` renders
exactly one of the repeated node. Duplicate the nodes by hand with distinct ids if the mock needs to
look like a list, and keep `each` as the declaration of intent. The declarations themselves ride in
the same hand-off comment as `bindings` / `events`:

```tsx
{/* TODO(yosegi): {"when":"customers.length > 0","each":"customer in customers"} */}
```

## Next steps

- [Workflows](./workflows.md) — the validation loop, the error codes, and turning a Story back into
  an implementation.
- [CLI reference](./cli.md) — the commands that consume and produce Screen JSON.
