# Workflows

English | [日本語](./ja/workflows.md)

Yosegi runs in two directions: upstream, assembling a Story out of registered components, and
downstream, turning that Story into a real page.

## Use cases

The audience is a product team that already has a design system in Storybook. Yosegi is invoked by a
coding agent, not by a person; people ask the agent in plain language.

### Use case 1 — build a screen mock quickly

- What a person says: "Build a mock of the coupon management screen using our components."
- What the agent does: builds the registry, inspects the components it intends to use, reads the
  host's conventions, and writes the Story — directly, or through Screen JSON when the screen is
  static enough to benefit from validation.
- The deliverable: a `.stories.tsx` that drops straight into the host's Storybook, drawn with the
  real components, verified by the host's own type check.

Revisions go through the same conversation — "make this part three columns", "use a Table here
instead of a Card". The agent edits the Story, or the Screen JSON, and regenerates.

### Use case 2 — move an approved mock into an implementation

- What a person says: "Implement this mock."
- What the agent does: reads the Story and the host's page conventions, then writes the real page,
  wiring each mock value to real data. For a Yosegi-generated Story it can pull the implementation
  context first and work through `tasks[]` one at a time.
- The deliverable: the real page, built from the same components the reviewer approved.

The only input is the Story file, so the mock may have been assembled by someone else in another
session — but see the limitation under "Downstream" before reaching for `story import`.

### Use case 3 — iterate without Figma in the loop

What you review and what you implement are the same components.

- A look the design system does not have cannot be assembled — components missing from the registry
  are rejected by validation.
- An approved proposal is the direct input to use case 2, so the "once implemented it turned out to
  be a different component" drift does not happen.
- You find out early when the existing components are not enough, as a request against the design
  system rather than a surprise during implementation.

Figma still owns new visual design. What Yosegi covers is showing a screen that can be built from
the components you already have.

## Upstream — assembling a Story

`registry build` → `component list` / `inspect` → the Story.

The first two steps are the mandatory part: they pin down the real props so a guessed one never
ships. The screen's skeleton and composition idiom come from the host's own Stories and templates,
not the registry. How the Story gets written is a choice of format. Write it directly when any
component on the screen needs a value that has no JSON form — a runtime object, a component
reference, a `ReactNode` built in an expression, a branch — because Screen JSON has no syntax for
those. Mock data, repetition, and screen states are expressible: `fixtures` carries named JSON
values the bindings reference, `repeat` expands a subtree into list rows, and `variants` emits the
screen's other states (loading / error / empty) as additional Story exports (see
[Screen JSON](./screen-json.md)). Otherwise Screen JSON buys validation before any JSX exists, plus
the hand-off comments the downstream half reads back.

Either way the host's type check is what confirms the result: it reads the JSX against the real
component types, which is more than validation against the registry can do.

`screen generate` validates before writing. On errors it writes no file and exits 1 with an array of
errors. Apply the whole array and re-run rather than fixing them one at a time.

```
$ yosegi screen generate tmp/screen.json --out ... --data-dir .yosegi
[
  {
    "nodeId": "card",
    "path": "$.children[0]",
    "code": "INVALID_PROP_VALUE",
    "message": "Value for \"app/components/ui/card#Card.elevation\" does not match kind \"enum\" (received: \"float\").",
    "suggestion": "Use one of: \"flat\", \"raised\""
  },
  {
    "nodeId": "cta",
    "path": "$.children[1]",
    "code": "COMPONENT_NOT_FOUND",
    "message": "Component \"Button\" is not registered.",
    "suggestion": "Did you mean: app/components/ui/button#Button?"
  }
]
```

`COMPONENT_NOT_FOUND`, `UNKNOWN_PROP`, and `UNKNOWN_BINDING_TARGET` carry the nearest candidates by
Levenshtein distance; `INVALID_PROP_VALUE` echoes the received value and the enum options. Every
issue also carries `path`, the node's position in the tree, so a node is locatable even when ids
collide. An issue raised by a variant's tree additionally carries `variant` with the variant's name,
and its `path` addresses the tree after the variant's operations. Warnings do not stop generation
and are listed after the file is written.

By default the generated meta holds only `title`. Splice in the boilerplate the host requires with
`--meta-template <file>`. Values are carried as source fragments without being interpreted, so
Yosegi never invents a Figma URL it does not have — but a URL inherited from an existing Story you
used as the template is carried verbatim, and named in a warning.

### Without Storybook

On a host with no Storybook, `screen generate --target component` emits the same screen as a plain
React component file instead of CSF. Validation, `fixtures`, `repeat`, and `variants` behave
identically; each state becomes an exported function rather than a Story export. Yosegi does not
prescribe where such a file is reviewed — the review is the host's type check plus whatever surface
its user chooses (rendering the component on a scratch route, for instance), so the agent asks
rather than assuming. One asymmetry to know: `story import` reads Stories only, so a component file
cannot be read back into Screen JSON — keep the Screen JSON if the screen may be revised later.

## Validation error codes

Every error carries a machine-readable `code` and enough `suggestion` to decide the fix.

| code | Meaning | How to fix |
| --- | --- | --- |
| `COMPONENT_NOT_FOUND` | The id is not in the registry | Swap in the candidate from `suggestion`. With no candidate, search again with `component list --query` |
| `UNKNOWN_PROP` | The component has no such prop | Correct it to the name in `suggestion`, or list the real props with `component inspect`. A node-level field (`bindings` / `events` / `when` / `each` / `repeat`) written inside `props` also lands here, with a `suggestion` to move it onto the node |
| `UNKNOWN_BINDING_TARGET` | A `bindings` key names a prop the component does not have | Correct it to the name in `suggestion`. A `ReactNode` prop is a slot, not a prop, so it cannot be a binding target |
| `INVALID_PROP_VALUE` | The value does not match the type or enum; the message echoes the received value | Pick from the options in `suggestion` |
| `MISSING_REQUIRED_PROP` | A required prop is unset; the message names its kind | Supply a value (`suggestion` lists an enum's options). A binding only satisfies it when the expression is a plain identifier path |
| `FUNCTION_PROP_VALUE` | A value was written into a function-kind prop | Move the declaration to `events` (or `bindings`) and delete it from `props` |
| `RESERVED_PROP` | A value was written into `children`, `key`, or `ref` under `props` | These are never emitted as JSX attributes. Move the content to `slots.children`; delete `key` / `ref` |
| `SLOT_NOT_FOUND` | The component has no such slot | Check the slots in `component inspect`. Children usually go in `children` |
| `SLOT_COMPONENT_NOT_ALLOWED` / `SLOT_MAX_ITEMS_EXCEEDED` | The slot's constraints reject these children | `suggestion` lists what is allowed |
| `PARENT_NOT_ALLOWED` / `CHILD_NOT_ALLOWED` | The parent/child pairing is constrained | `suggestion` lists the allowed components |
| `DUPLICATE_NODE_ID` | Two nodes share an `id`; the message names both colliding `path`s. Also raised when a `repeat` expansion's `-1`…`-N` suffixes would collide with an existing id | Change one of them |
| `REPEAT_ON_ROOT` | `repeat` sits on the root node, which has no parent slot to hold the copies | Wrap the content in a container node and put `repeat` on the child |
| `REPEAT_OUT_OF_RANGE` | `repeat` is not an integer between 2 and 20 | Fix the count, or remove `repeat` if one copy is enough |
| `REPEAT_EXPANSION_TOO_LARGE` | Expanding every `repeat` would produce more than 2000 nodes — nested repeats multiply | Lower the counts or un-nest the repeated subtrees |
| `VARIANT_OPERATION_FAILED` | A variant's `operations` could not be applied to the base tree; the message names the failing operation's code | Fix the operation so every `nodeId` it targets exists in the base tree (or was added by an earlier operation of the same variant) |

Warnings, which do not stop generation:

| code | Meaning |
| --- | --- |
| `REGISTRY_VERSION_MISMATCH` | The screen references a different registry version than the one in use |
| `MISSING_REQUIRED_SLOT` | A required slot is empty — usually intentional in a mock |
| `BOUND_REQUIRED_PROP` | A required prop is declared only in `bindings`, so the Story is emitted as `prop={<expression>}` and will not type-check until that name exists in it. Suppressed when the binding's head names a fixture — then it does exist |
| `UNUSED_FIXTURE` | A fixture no binding references. Still emitted; usually a renamed or dropped binding |
| `NOT_EDITABLE_PROP_VALUE` | A value was written into a not-editable prop, so it reaches the Story unchecked |
| `UNKNOWN_EVENT_TARGET` | An `events` key names a prop that is not in the manifest. Only a warning, because a manifest has no event surface to check against |
| `SYNTHETIC_NAME_SHADOWED` | A short id resolved to a synthetic primitive while the registry also holds a host component of that name |
| `DEPRECATED_COMPONENT` | The component is marked deprecated |

`INVALID_REQUEST` is a different thing. If the file does not satisfy the schema, validation is never
reached and `{ "error": { "code": "INVALID_REQUEST", "issues": [...], "hints": [...] } }` comes back
instead. The `path` in `issues` locates the problem and `hints` spells out the correct form. Fix the
shape first, then enter the loop above.

## Downstream — turning a Story into an implementation

`story import` → `screen context` → implement following the host's conventions.

**This path only works on a Story `screen generate` wrote.** `story import` parses the Story with
the TypeScript AST, and real Stories rarely inline their component tree. The convention is a
`render` returning a single wrapper component defined next door. Such a Story imports to one node
and — since there is no unreadable syntax to complain about — zero warnings, so nothing signals
that the screen is missing. Against a hand-written Story, read the Story instead.

A Story written by `screen generate` reads back unchanged apart from node ids. Syntax whose shape is
only decided at runtime is reported in `warnings`, and the part of the tree that could be read is
still returned.

`screen context` expands the Screen JSON into implementation context. Four keys matter most:

- `imports`: import statements you can paste as-is. They come from the same import plan as the CSF
  emitter, so they never disagree with the generated Story.
- `structure.outline`: the nesting as indented lines.
- `components[]`: per component in use, its `usedProps` / `usedSlots` / `manifest` /
  `importStatement`. Synthetic primitives and unregistered ids are marked.
- `tasks[]`: `bindings` and `events` flattened into wiring tasks, each carrying `nodeId` and a
  `path` in `$.children[1]` form.

The rest (`requirements` / `target` / `implementation` / `screen`) is supporting information.

## `story import` warnings

Analysis works purely on the source AST, so any syntax whose shape is decided at runtime cannot be
read. When no tree can be restored at all, the run ends with exit 1 and one of the codes below;
otherwise the import marks the unreadable node and moves on. **Anything that produced a
warning is absent from the Screen JSON**, so read the original Story for those parts. An empty
`warnings` array proves nothing on its own — count the nodes against the Story.

| code | Meaning |
| --- | --- |
| `STORY_NOT_FOUND` | No export with a `render` function — what a `component` + `args` Story produces — or `--story-name` named no export (the message lists the candidates). Exit 1, nothing imported |
| `RENDER_NOT_STATIC` | The selected export's `render` cannot be read statically, or `--story-name` picked an `args`-only export. Exit 1, nothing imported |
| `TITLE_NOT_STATIC` | The meta's `title` is not a static string; the screen name falls back and the import continues |
| `OPAQUE_EXPRESSION` | An expression that cannot be read statically, such as `{items.map(...)}` or a conditional. That node is dropped |
| `OPAQUE_PROP` | The prop's value cannot be read (a variable reference, say). Only that prop is dropped |
| `OPAQUE_ELEMENT` | A DOM tag with no corresponding synthetic primitive. It survives as `Box` but the tag name is lost |
| `SPREAD_ATTRIBUTE` | `{...args}` cannot be expanded |
| `INTENT_NOT_APPLIED` | An intent comment preceded several siblings, so its `bindings` / `events` had no single element to attach to and were dropped |
| `OPAQUE_FIXTURE` | A top-level const whose initializer is not a JSON literal, so it was not read back as a fixture |
| `COMPONENT_NOT_RESOLVED` | The import statement does not lead to a registry id. The node keeps its local name, so validation will offer candidates |
| `COMPONENT_AMBIGUOUS` | Several candidates share the export name. Narrow it with `--import-map` |
| `IMPORT_PATH_MISMATCH` | The export name matches but the import source differs from the registry. Suspect a stale registry |
| `MULTIPLE_ROOTS` | There was more than one root element, so they were wrapped in a `Box` |
| `MULTIPLE_STORIES` | The file exports more Stories than the imported one (a `variants` file, typically). One export is read per run; pass `--story-name` to read another. The diff is never reconstructed into `variants` |

## Next steps

- [CLI reference](./cli.md) — every command and flag used above.
- [Screen JSON](./screen-json.md) — the shape these workflows read and write.
