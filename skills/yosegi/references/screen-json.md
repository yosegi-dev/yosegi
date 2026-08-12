# Screen JSON

The intermediate representation `screen generate` turns into a Story. It is not the deliverable — a
temporary file (`tmp/screen.json`) is right, and it can be deleted once the Story exists.

Take this route only for a screen that passes the test in `SKILL.md` step 3. It buys you validation
before you write any JSX, and the `bindings` / `events` hand-off comments. It costs you everything
below.

## What Screen JSON cannot express

The format describes a tree of components whose every value is a JSON value. There is no syntax for
anything else, and no way to smuggle one in.

| You need | Screen JSON's answer |
| --- | --- |
| Mock data a component maps over (list rows, a config object) | `fixtures` — a named JSON value emitted as a top-level const, referenced from `bindings`. See below |
| Repetition | `repeat: N` on the node — the Story carries N copies of the subtree. `each` stays the declaration of intent |
| A runtime object as a prop (a table instance, a form control, a ref) | None. A fixture is JSON, and no JSON value is a table instance; a `bindings` entry without a fixture emits the bare name, which does not exist in the Story |
| A component reference as a prop (an icon prop taking the component itself) | None. It is a `json` prop, and no JSON value is a component |
| A `ReactNode` assembled in an expression | None. A slot takes ScreenNodes only |
| A condition | `when` is a comment. Nothing branches |
| Any JavaScript at all — a handler body, a `map`, a ternary | None |

Conditions are survivable: lay out the shown branch and keep `when` as the declaration of intent.
**A required prop that takes a value with no JSON form is not.** The generated Story references a
name that was never defined, the host's type check stops on `Cannot find name`, and there is
nothing to fix inside the Screen JSON. Go back to step 3 and write the Story directly.

## Shape

```json
{
  "schemaVersion": "1.0",
  "id": "customer-list",
  "name": "Customer list",
  "componentRegistryVersion": "src:xxxxxxxxxxxx",
  "revision": 0,
  "root": {
    "id": "root",
    "component": "Box",
    "props": { "className": "p-6 space-y-4" },
    "slots": {
      "children": [
        { "id": "title", "component": "app/components/typography#Heading", "props": { "level": 1 }, "slots": {
          "children": [
            { "id": "title-text", "component": "Text", "props": { "text": "Customers" }, "slots": {} }
          ]
        } },
        { "id": "cta", "component": "app/components/ui/button#Button", "props": { "variant": "primary" }, "slots": {
          "children": [
            { "id": "cta-label", "component": "Text", "props": { "text": "Add customer" }, "slots": {} }
          ]
        } }
      ]
    }
  }
}
```

Every top-level field shown above is required: `schemaVersion` (`"1.0"`), `id`, `name`,
`componentRegistryVersion`, `revision`, `root`. Omitting one is an `INVALID_REQUEST`, not a warning.
`status` (defaults to `"draft"`) and `fixtures` (see below) are the optional ones.

The screen `id` may contain **letters, digits, `-` and `_` only** (`/^[A-Za-z0-9_-]+$/`). It becomes
a file name in the screen store, so a `/` or a `..` is rejected as an `INVALID_REQUEST`.

- A ScreenNode is those four fields: `{ id, component, props, slots }`. Nothing else is required of
  a node — but `props` and `slots` are, even when empty (`{}`).
- `id` must be unique within the screen (`DUPLICATE_NODE_ID` otherwise).
- `component` is either a registry id or one of the synthetic primitives below. Write the id exactly
  as `component list` prints it; a bare export name (`Button`) is `COMPONENT_NOT_FOUND`, though
  validation returns the full id as a candidate.
- `slots.children` becomes the JSX children. Every other slot name is passed as a prop.
- `componentRegistryVersion` copies the `version` of the registry.json you generated — take it from
  the `version` field of `<data-dir>/registry.json`, or from `component list --json`. A mismatch is
  only a warning; generation still succeeds.
- `revision` starts at `0`.

## Synthetic primitives

Structural components usable without being in the registry. They need no import.

| id | props | Output |
| --- | --- | --- |
| `Text` | `text` | A JSX text node |
| `Box` | `className` | `<div className=...>` (can hold `slots.children`) |
| `Heading` | `text` | `<h1 className="font-bold text-2xl tracking-tight">` |

Express the label of a real component by placing a `Text` in its `children` slot.

`Heading` is only a default for hosts that have no heading component. If the host has one, point at
its id instead — a synthetic primitive ignores the host's typography definitions.

### Telling a synthetic primitive from a host component of the same name

It is not unusual for a host to have its own `Text` / `Box` / `Heading`. **They are told apart by id
length: synthetic primitives use the short id (`"Text"`), the host's components use the full id
(`"app/components/typography#Text"`).** A short id always means the synthetic primitive, so writing
`"Text"` when you meant the host's `Text` silently loses the typography.

When the registry holds a component of the same name, validation emits a `SYNTHETIC_NAME_SHADOWED`
warning carrying the full id as a candidate. Using a synthetic primitive is legitimate, so it is not
an error — ignore the warning when the primitive is what you meant. Putting copy inside the host's
`Text` means nesting:

```json
{ "id": "label", "component": "app/components/typography#Text", "props": { "size": "sm" }, "slots": {
  "children": [ { "id": "label-text", "component": "Text", "props": { "text": "Signed up" }, "slots": {} } ]
} }
```

## Props

Confirm every prop with `component inspect` first; `registry.md` covers how to read it. Two points
are specific to this route:

- A prop marked `not-editable` reaches the Story unchecked and warns (`NOT_EDITABLE_PROP_VALUE`); a
  `function`-kind prop rejects a value outright (`FUNCTION_PROP_VALUE`). Express data through
  `bindings` and handlers through `events` instead.
- If `inspect` prints `Note: props could not be read from the types.`, the registry is not that
  component's real API, and every real prop you write will stop with `UNKNOWN_PROP`. Reading the
  host's source is not enough — supplement the registry with `registry build --metadata` first
  (`cli.md`).

## bindings / events

Values that come from data, and events, are declared in `bindings` / `events`. They survive in the
generated Story as `{/* TODO(yosegi): ... */}` comments carrying the declaration as JSON, handing
them off to whoever implements it. **The two have different shapes.**

| Field | Shape | Example |
| --- | --- | --- |
| `bindings` | `{ "<prop name>": "<data expression as a string>" }` | `"bindings": { "title": "segment.name" }` |
| `events` | `{ "<event name>": { "action": "<action name>", "arguments": { ... } } }` | `"events": { "onClick": { "action": "navigate", "arguments": { "to": "/customers/new" } } }` |

A `bindings` value is the string itself. Wrapping it in an object like `{ "expression": "..." }` is a
schema violation (`INVALID_REQUEST`), not a validation error. The `arguments` of an `events` entry
may be omitted. Both sit directly on the ScreenNode, not inside `props`.

**Both keys are checked against the manifest.** A `bindings` key naming a prop the component does
not have is an error (`UNKNOWN_BINDING_TARGET`). An `events` key is only a warning
(`UNKNOWN_EVENT_TARGET`), because a manifest has no event surface to check against — expect this on
handlers a component inherits from its DOM element type rather than declaring.

A binding target has to be a **prop**, and a `ReactNode` prop is a **slot** instead — `children`
included. So `"bindings": { "children": ... }` is an error, not the way to say "this node's text
comes from data". Bind a string prop the component actually declares (`title`, `label`, `value`), or
leave the copy in `slots.children` and wire it up during implementation.

```json
{
  "id": "create-button",
  "component": "app/components/ui/button#Button",
  "props": { "size": "lg" },
  "slots": { "children": [ { "id": "create-label", "component": "Text", "props": { "text": "Add customer" }, "slots": {} } ] },
  "events": { "onClick": { "action": "navigate", "arguments": { "to": "/customers/new" } } }
}
```

The comment left in the generated Story carries the same declaration as JSON:

```tsx
{/* TODO(yosegi): {"events":{"onClick":{"action":"navigate","arguments":{"to":"/customers/new"}}}} */}
```

A prop that has a `bindings` entry is exempt from type validation (it becomes concrete at
implementation time).

### A binding is not a mock value — unless a fixture backs it

A binding says where the value comes from when the screen is built; on its own it carries no value
the mock can show. A **fixture of the same name** supplies that value: the const exists in the
Story, so the binding is written into the JSX and one declaration carries both the mock's data and
the implementation's wiring target. That is the preferred fix.

Without a fixture, an **optional** prop is harmless — the prop is left out and the Story renders.
On a **required** prop it is not: the emitter writes the expression itself into the JSX
(`table={table}`) rather than dropping the prop, and validation warns with `BOUND_REQUIRED_PROP`.
That name does not exist in the Story, so the host's type check stops there. Declare a fixture, or
give the prop a mock value in `props` and keep the binding.

Handlers need no mock value — `function` props are filled with a no-op `() => {}` automatically, so
declaring them in `events` is enough. **A required prop whose value cannot be written as JSON at all
has no fix on this route**; that is the case the table at the top of this file rules out.

## fixtures

The screen's mock-data layer. Each entry becomes a top-level `const <name> = <JSON value>;` in the
generated Story (between the imports and the meta, in the order written), and bindings reference the
names:

```json
{
  "fixtures": { "customers": [{ "name": "Sato" }, { "name": "Suzuki" }] },
  "root": {
    "id": "customer-table",
    "component": "app/components/table#Table",
    "props": {},
    "slots": {},
    "bindings": { "rows": "customers" }
  }
}
```

This emits `const customers = [...]` and `rows={customers}` — a fixture-backed binding is written
into the JSX even on an optional prop, and the `BOUND_REQUIRED_PROP` warning disappears on a
required one. A member path works too: `"bindings": { "rows": "data.customers" }` matches a fixture
named `data`. `story import` restores the consts, so the round trip is lossless.

Rules that produce errors:

- A fixture name must be a JavaScript identifier, and must not be `meta` / `Meta` / `StoryObj` (the
  Story declares those itself). Violations are an `INVALID_REQUEST` from the schema.
- A name equal to the Story's export name (`Default`, or `--story-name`) is rejected at generation
  time. A component import colliding with a fixture name is aliased automatically — that one is fine.
- A fixture no binding references is emitted anyway, with an `UNUSED_FIXTURE` warning.

Match the fixture's shape to the data contract found in step 2 — the fields, their nullability, what
is absent. The fixture is exactly the place where an invented field ships a defect.

### `when` / `each` / `repeat`

`when` and `each` are free-form strings; there is no grammar and nothing validates them. Write
whatever an implementer will understand (`"customers.length > 0"`, `"customer in customers"`).
Neither produces any JSX; both ride in the same `{/* TODO(yosegi): ... */}` comment:

```tsx
{/* TODO(yosegi): {"when":"customers.length > 0","each":"customer in customers"} */}
```

`repeat` (an integer, 2–20) makes the mock look like a list without duplicating nodes by hand: at
generation time the subtree is expanded into that many copies, ids suffixed `-1`…`-N`. Declare
`each` on the same node for the implementation intent — `each` says what repeats, `repeat` says how
many copies the mock shows. Three errors to know: `REPEAT_ON_ROOT` (the root cannot repeat — wrap
it), `REPEAT_OUT_OF_RANGE` (not an integer 2–20), and `DUPLICATE_NODE_ID` when a suffixed id
collides with an existing one. `repeat` is one-way: `story import` reads the expanded Story back as
that many separate nodes, with no `repeat` field.

## Common schema errors

If the JSON does not even satisfy the ScreenNode shape, validation is never reached and
`{ "error": { "code": "INVALID_REQUEST", "issues": [...], "hints": [...] } }` comes back instead. The
`path` in `issues` locates the problem, and `hints`, when present, spells out the correct form. Fix
the shape first, then enter the validation loop.

The ones worth checking yourself before running:

- `bindings` written in the shape of `events`, or the reverse.
- `slots` given a bare node instead of an array — every slot value is an array of ScreenNodes.
- A missing `props: {}` or `slots: {}` on a leaf node. Both are required even when empty.

`bindings` / `events` / `when` / `each` nested inside `props` is a related mistake but **not** a
schema violation — `props` is a free-form record, so it passes the schema and surfaces in
validation as `UNKNOWN_PROP`, with a `suggestion` to move the field onto the node.
