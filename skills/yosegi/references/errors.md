# Every code Yosegi can return, and how to recover

Five different things can come back, and they read differently. Identify which one you are looking
at before fixing anything.

1. **Validation errors** — an array of `{ nodeId, code, message, suggestion }`. Generation stopped;
   no file was written; exit code 1.
2. **Validation warnings** — the same shape, printed *after* `Wrote <path>`. Generation succeeded.
3. **A schema violation** — `{ "error": { "code": "INVALID_REQUEST", "issues": [...], "hints": [...] } }`.
   Validation was never reached at all.
4. **A command error** — `{ "error": { "code": "INTERNAL_ERROR", "message": "..." } }`, exit code 1.
   The command failed before or outside validation: a missing registry, a bad `--story-name`, an
   unreadable path. It is JSON with a `code`, so do not go looking for a bare `Error:` line.
5. **Plain-text notices** — `Warning:` or `Note:` lines printed alongside a *successful* run. They
   carry no `code` and are easy to scroll past. They are listed at the bottom of this file.

## The validation loop

When errors come back, **apply the whole printed array to the Screen JSON and re-run**. Do not clear
them one at a time; each pass reveals the next layer, and fixing one error per run turns a two-round
loop into six. Every error carries enough `suggestion` to decide the fix without going back to the
registry.

```
$ yosegi screen generate tmp/screen.json --out ... --data-dir .yosegi
[ { "code": "COMPONENT_NOT_FOUND", "message": "Component \"SampleCard\" is not registered.",
    "suggestion": "Did you mean: sample-card#SampleCard?" } ]

# swap the id and re-run
[ { "code": "UNKNOWN_PROP", "message": "... has no prop \"titel\".",
    "suggestion": "Did you mean: title?" },
  { "code": "INVALID_PROP_VALUE", "message": "... variant ... kind \"enum\".",
    "suggestion": "Use one of: default, danger, success" } ]

# fix both and re-run
Wrote <host>/app/components/examples/customer-list.stories.tsx
```

This loop needs no confirmation from anyone. Run it to completion.

## Errors (generation stops)

| code | Meaning | How to fix |
| --- | --- | --- |
| `COMPONENT_NOT_FOUND` | The id is not in the registry | Swap in the candidate id from `suggestion`. With no candidate, search again with `component list --query`. A bare export name (`Button`) instead of the full `<module path>#<name>` id lands here |
| `UNKNOWN_PROP` | The component has no such prop | Correct it to the prop name in `suggestion`. With no candidate, list the real props with `component inspect`. If inspect prints the `Note: props could not be read from the types.` line, see below — the prop may be real and the registry simply does not know it |
| `INVALID_PROP_VALUE` | The value does not match the type or the enum | Pick from the options in `suggestion` |
| `MISSING_REQUIRED_PROP` | A required prop has no value | Supply one. A binding alone is not a value: it only satisfies the prop when its expression is a plain identifier path (`table`, `query.data.rows`), and even then see `BOUND_REQUIRED_PROP` below |
| `FUNCTION_PROP_VALUE` | A value was written into a function-kind prop | Handlers cannot be expressed in `props` at all. Move the declaration to `events` (`{ "action": "..." }`) or to `bindings`, and delete it from `props`. The Story gets a no-op handler so it still renders |
| `UNKNOWN_BINDING_TARGET` | A `bindings` key names a prop the component does not have | Correct it to the name in `suggestion`. Remember that a `ReactNode` prop is a **slot**, not a prop, so `children` is never a valid binding target on a registry built from types |
| `SLOT_NOT_FOUND` | The component has no such slot | Check the slots in `component inspect` and fix the name. Children usually go in `children` |
| `SLOT_COMPONENT_NOT_ALLOWED` / `SLOT_MAX_ITEMS_EXCEEDED` | The slot's own constraints reject these children | `suggestion` names what is allowed |
| `PARENT_NOT_ALLOWED` / `CHILD_NOT_ALLOWED` | The parent/child pairing is constrained | `suggestion` names the allowed components |
| `DUPLICATE_NODE_ID` | Two nodes share an `id` | Change one of them. Node ids must be unique across the whole screen |

### `UNKNOWN_PROP` on a prop that really exists

Components with a union props type, and components exported through a cast such as
`const Text = Forwarded as TextComponent`, defeat type extraction. Almost nothing reaches the
registry — at most `className` / `children`, and only when the component's type says it takes them —
and `component inspect` says so on its own line:

```
Note: props could not be read from the types. This list is not the real API, so read the host's source directly.
```

The `propsUnreadable` statistic from `registry build` and the `props-unreadable` entries in
`--report` point at the same set of components.

Reading the host's source to learn the right prop name **does not fix this on the Screen JSON
route**. The registry still does not know the prop, so the screen cannot be assembled. Supplement
it:

1. `yosegi registry metadata "<id>" ... --out tmp/metadata.json` scaffolds the file from the host's
   cva variants (see `cli.md` for the flags).
2. Add the props that are not cva variants — `as` and friends are missing from the scaffold, and
   some of them are required. Read the source for these.
3. Re-run `registry build` with `--metadata tmp/metadata.json` and check `metadataApplied` in the
   statistics.
4. Keep the metadata file. It is needed every time the registry is rebuilt; it is not a throwaway.

`Warning: these --metadata ids matched no component` means the id in the file is mistyped — nothing
was applied.

## Warnings (generation succeeded)

| code | Meaning | What to do |
| --- | --- | --- |
| `REGISTRY_VERSION_MISMATCH` | The Screen JSON's `componentRegistryVersion` differs from the registry in use | Rebuild the registry, then re-check the screen against it. The props you wrote may no longer exist |
| `MISSING_REQUIRED_SLOT` | A required slot has no children | Usually intentional in a mock. Confirm the screen still reads correctly in Storybook |
| `SYNTHETIC_NAME_SHADOWED` | A synthetic primitive (`Text` / `Box` / `Heading`) was used while the registry holds a component of the same name | If you meant the host's component, replace the short id with the full one from the warning. If you meant the primitive, ignore it. See `screen-json.md` |
| `BOUND_REQUIRED_PROP` | A required prop is declared only in `bindings` | The Story is emitted as `prop={<expression>}`, and that name does not exist in it, so the host's type check will stop on it. Put a mock value in `props` and keep the binding as the implementation intent. When the value cannot be expressed as JSON at all (a table instance, say), the component cannot be mocked standalone — use one that can, or accept a Story that only type-checks once implemented |
| `NOT_EDITABLE_PROP_VALUE` | A value was written into a not-editable prop | Its shape cannot be checked, so it reaches the Story as-is and often will not match the component's type. Confirm against the host's source, move it to `bindings` if it comes from data, or drop it |
| `UNKNOWN_EVENT_TARGET` | An `events` key names a prop that is not in the manifest | Only a warning, because a manifest has no event surface to check against — handlers appear only as function-typed props. Take the `suggestion` if there is one; otherwise confirm the handler name against the host's source |
| `DEPRECATED_COMPONENT` | The component is marked deprecated | Prefer the replacement the host documents |

`--meta-template` produces `Warning:` lines of its own, which have no `code` — see the plain-text
section at the end.

## `INVALID_REQUEST` (the shape is wrong)

Validation is never reached, so none of the codes above appear. The `path` in `issues` locates the
problem and `hints`, when present, spells out the correct form.

The frequent causes:

- `bindings` written in the shape of `events` or the reverse. A `bindings` value is a plain string;
  an `events` value is a `{ action, arguments }` object.
- `bindings` / `events` / `when` / `each` placed inside `props` instead of on the node itself.
- A slot given a bare node rather than an array of nodes.
- `props` or `slots` omitted on a leaf node. Both are required even when empty.

Fix the shape, then enter the validation loop above.

## `story import` warnings (downstream)

`story import` never fails outright — it returns the part of the tree it could read and reports the
rest. Analysis works purely on the source AST and the Story is never executed, so **any syntax whose
shape is only decided at runtime cannot be read**.

| code | Meaning |
| --- | --- |
| `OPAQUE_EXPRESSION` | An expression that cannot be read statically, such as `{items.map(...)}` or a conditional. That node is dropped |
| `OPAQUE_PROP` | The prop's value cannot be read (a variable reference, say). Only that prop is dropped |
| `OPAQUE_ELEMENT` | A DOM tag with no corresponding synthetic primitive. It survives as `Box`, but the tag name is lost |
| `SPREAD_ATTRIBUTE` | `{...args}` cannot be expanded |
| `COMPONENT_NOT_RESOLVED` | The import statement does not lead to a registry id. The node keeps its local name, so validation will offer candidates |
| `COMPONENT_AMBIGUOUS` | Several registry entries share the export name. Narrow it with `--import-map` |
| `IMPORT_PATH_MISMATCH` | The export name matches but the import source differs from the registry. Suspect a stale registry |
| `MULTIPLE_ROOTS` | There was more than one root element, so they were wrapped in a `Box` |

**Anything that produced a warning is absent from the Screen JSON.** Ignore them and that part of the
screen goes missing from the implementation entirely. Read the original Story directly for every
place a warning points at.

**An empty `warnings` array is not proof the import worked.** A Story whose `render` returns one
wrapper component — the normal shape of a hand-written Story — imports cleanly to a single node,
with nothing to warn about. Count the nodes against the Story you can see. `implementation.md`
covers when to use this command at all.

## Command errors (`INTERNAL_ERROR` / `INVALID_JSON`)

These come back as JSON with a `code`, exit code 1, and no `nodeId` — the command failed before it
reached the screen. `INVALID_JSON` means the file you passed is not valid JSON. `INTERNAL_ERROR` is
everything else, with the underlying message attached.

| `message` | Meaning | What to do |
| --- | --- | --- |
| `Registry not found at <path>. Generate it with: yosegi registry build ...` | No registry at that `--data-dir` | Either you have not built one yet, or `--data-dir` differs from the one `registry build` wrote to. Check the second before rebuilding — the default (`.yosegi` under the cwd) moves with your working directory |
| `Story name "<name>" is not a valid JavaScript identifier.` | `--story-name` becomes an `export const`, so it has to be an identifier | Use letters, digits, `_` or `$`, and do not start with a digit. `Customer list` → `CustomerList` |
| `Component "<id>" has export name "<name>", which is not a valid JavaScript identifier.` | The registry entry itself cannot be emitted as JSX | Pick a different component, or fix the export in the host |
| `--source requires --tsconfig <path>.` | `registry build` got a glob but no tsconfig | Pass the host's tsconfig |
| `ENOENT` / `no such file` | A path you passed does not exist | Check `--tsconfig`, the Screen JSON path, and `--metadata` |

A malformed screen `id` does **not** land here — it is an `INVALID_REQUEST` from the schema, because
the id becomes a file name. Letters, digits, `-` and `_` only.

## Plain-text notices

These carry no `code`, and every one of them appears alongside a *successful* exit code.

| Line | Meaning | What to do |
| --- | --- | --- |
| `Warning: --source matched no files (--project-root: <dir>)` | The glob's base is wrong | Globs resolve against `--project-root`, which defaults to the tsconfig's directory — never the cwd. The command still succeeded and wrote a registry of three synthetic primitives, so do not read `Wrote 3 components` as success |
| `Warning: these --metadata ids matched no component: <ids>` | Those ids are mistyped | Nothing was applied for them. Copy the id from `component list` |
| `Note: the template only covers cva variants...` | Printed by every `registry metadata` run | The scaffold is incomplete by construction. Add the non-variant props from the source |
| `Note: <path>` from `registry metadata` | The variants could not be read | You get an empty scaffold. Write that component's props by hand from the named source |
| `Warning: this registry was built by ...` naming two Yosegi versions | The registry was written by a different Yosegi than the CLI now reading it | Rebuild with the printed command. An older Yosegi omits fields a newer one emits, and no other signal (version hash, `built` time) shows the gap |
| `Warning:` naming a URL inherited from `--meta-template` | A Figma or Notion link came along from the Story you built the template from | Check it and either remove or replace it. **Never leave a URL you have not verified** |
| `Warning: Ignored "title" from the meta template ...` | `title` and `component` are not carried over; the screen decides them | Harmless. Remove them from the template if you want the warning to stop |
