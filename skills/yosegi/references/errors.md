# Every code Yosegi can return, and how to recover

Six different things can come back, and they read differently. Identify which one you are looking
at before fixing anything.

1. **Validation errors** — an array of `{ nodeId, path, code, message, suggestion }`. `path`
   (`$.children[0]...`) is the node's position in the tree, so a node is locatable even when ids
   collide. Generation stopped; no file was written; exit code 1.
2. **Validation warnings** — the same shape, printed *after* `Wrote <path>`. Generation succeeded.
   Two of them are about the screen rather than about a node, and carry `nodeId: null` with **no
   `path` key at all**: `REGISTRY_VERSION_MISMATCH` and `UNUSED_FIXTURE`. Do not read a missing
   `path` as a malformed issue, and do not go looking for the node they came from.
3. **A schema violation** — `{ "error": { "code": "INVALID_REQUEST", "issues": [...], "hints": [...] } }`.
   Validation was never reached at all.
4. **A command error** — `{ "error": { "code": "...", "message": "..." } }`, exit code 1. The
   command failed before or outside validation, and the code says how: `MISSING_ARGUMENT`,
   `UNKNOWN_COMMAND`, `UNKNOWN_FLAG`, `REGISTRY_NOT_FOUND`, `INVALID_ARGUMENT`, `INVALID_JSON`,
   `CONFIG_INVALID` / `CONFIG_NOT_FOUND` from the host's `yosegi.config.json`,
   a lookup miss such as `COMPONENT_NOT_FOUND` / `SCREEN_NOT_FOUND`, `STORY_NOT_FOUND` /
   `RENDER_NOT_STATIC` from `story import`, or `INTERNAL_ERROR` for everything else. It is JSON
   with a `code`, so do not go looking for a bare `Error:` line. The table at the bottom of this
   file covers each code, including the `UNKNOWN_ARGUMENT` and `EXAMPLE_*` codes the `example`
   commands add to this class.
5. **A store rejection** — `{ "error": { "code": "VALIDATION_FAILED", ... }, "validation": {...} }`,
   from `screen push` / `screen apply`: the command error envelope with the full validation result
   attached. Read `validation` exactly as shape 1.
6. **Plain-text notices** — `Warning:` or `Note:` lines printed alongside a *successful* run. They
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
  { "code": "INVALID_PROP_VALUE", "message": "... variant ... kind \"enum\" (received: \"dangr\").",
    "suggestion": "Use one of: \"default\", \"danger\", \"success\"" } ]

# fix both and re-run
Wrote <host>/app/components/examples/customer-list.stories.tsx
```

This loop needs no confirmation from anyone. Run it to completion.

## Errors (generation stops)

| code | Meaning | How to fix |
| --- | --- | --- |
| `COMPONENT_NOT_FOUND` | The id is not in the registry | Swap in the candidate id from `suggestion`. With no candidate, search again with `component list --query`. A bare export name (`Button`) instead of the full `<module path>#<name>` id lands here |
| `UNKNOWN_PROP` | The component has no such prop | Correct it to the prop name in `suggestion`. A node-level field (`bindings` / `events` / `when` / `each`) written inside `props` also lands here, and `suggestion` says to move it onto the node. With no candidate, list the real props with `component inspect`. If inspect prints the `Note: props could not be read from the types.` line, see below — the prop may be real and the registry simply does not know it |
| `INVALID_PROP_VALUE` | The value does not match the type or the enum; the message echoes the received value | Pick from the options in `suggestion` |
| `MISSING_REQUIRED_PROP` | A required prop has no value; the message names its kind | Supply one (`suggestion` lists an enum's options). A binding alone is not a value: it only satisfies the prop when its expression is a plain identifier path (`table`, `query.data.rows`), and even then see `BOUND_REQUIRED_PROP` below |
| `FUNCTION_PROP_VALUE` | A value was written into a function-kind prop | Handlers cannot be expressed in `props` at all. Move the declaration to `events` (`{ "action": "..." }`) or to `bindings`, and delete it from `props`. The Story gets a no-op handler so it still renders |
| `RESERVED_PROP` | A value was written into `children`, `key`, or `ref` under `props` | These names are never emitted as JSX attributes, so the value would silently vanish from the Story. Move the content to `slots.children` (plain text becomes a `Text` node); delete `key` / `ref`, which React manages and a Screen JSON cannot set |
| `UNKNOWN_BINDING_TARGET` | A `bindings` key names a prop the component does not have | Correct it to the name in `suggestion`. Remember that a `ReactNode` prop is a **slot**, not a prop, so `children` is never a valid binding target on a registry built from types |
| `SLOT_NOT_FOUND` | The component has no such slot | Check the slots in `component inspect` and fix the name. Children usually go in `children` |
| `SLOT_COMPONENT_NOT_ALLOWED` / `SLOT_MAX_ITEMS_EXCEEDED` | The slot's own constraints reject these children | `suggestion` names what is allowed |
| `PARENT_NOT_ALLOWED` / `CHILD_NOT_ALLOWED` | The parent/child pairing is constrained | `suggestion` names the allowed components |
| `DUPLICATE_NODE_ID` | Two nodes share an `id`; the message names both colliding `path`s. Also raised when a `repeat` expansion's `-1`…`-N` suffixed ids would collide with an existing id | Change one of them. Node ids must be unique across the whole screen, including after expansion |
| `REPEAT_ON_ROOT` | `repeat` sits on the root node, which has no parent slot to hold the copies | Wrap the repeated content in a container node (a `Box`, say) and put `repeat` on the child |
| `REPEAT_OUT_OF_RANGE` | `repeat` is not an integer between 2 and 20 | Fix the count. Remove `repeat` entirely if a single node is enough |
| `REPEAT_EXPANSION_TOO_LARGE` | Expanding every `repeat` would produce more than 2000 nodes — nested repeats multiply | Lower the counts or un-nest the repeated subtrees |
| `VARIANT_OPERATION_FAILED` | A variant's `operations` could not be applied to the base tree; the message names the failing operation's code (`NODE_NOT_FOUND`, ...) | Fix the operation so every `nodeId` it targets exists in the base tree (or was added by an earlier operation of the same variant). Issues from a variant's applied tree carry a `variant` field, and their `path` addresses the tree after the operations |

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
| `SYNTHETIC_NAME_SHADOWED` | A synthetic primitive (`Text` / `Box` / `Heading`) was used while the registry holds a component of the same name. Reported once per name, not once per node | If you meant the host's component, replace the short id with the full one from the warning. If you meant the primitive, ignore it. See `screen-json.md` |
| `BOUND_REQUIRED_PROP` | A required prop is declared only in `bindings`, and no fixture backs it | The Story is emitted as `prop={<expression>}`, and that name does not exist in it, so the host's type check will stop on it. Declare a fixture named after the binding's head (`screen-json.md`), or put a mock value in `props` (it is validated like any other value — a binding does not exempt it) and keep the binding as the implementation intent. When the value cannot be expressed as JSON at all (a table instance, say), the component cannot be mocked standalone — use one that can, or accept a Story that only type-checks once implemented |
| `UNUSED_FIXTURE` | A fixture no binding references | It is still emitted into the Story. Reference it from a binding, or remove it — usually a binding was renamed or dropped |
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
- A slot given a bare node rather than an array of nodes.
- `props` or `slots` omitted on a leaf node. Both are required even when empty.

`bindings` / `events` / `when` / `each` placed inside `props` is **not** a schema violation —
`props` is a free-form record — so it does not appear here. It surfaces in validation as
`UNKNOWN_PROP`, with a `suggestion` to move the field onto the node.

Fix the shape, then enter the validation loop above.

## `story import` failures and warnings (downstream)

`story import` fails outright (exit 1, no Screen JSON) whenever no tree can be restored, and that
failure comes back as the command error envelope — `{ "error": { "code", "message", "file",
"warnings" } }`, exactly shape 4 above — so `error.code` names the reason here as it does
everywhere else. Two codes end the run: `STORY_NOT_FOUND` when no export has a `render` function —
what a `component` + `args` Story produces, and that is the most common hand-written shape — and
`RENDER_NOT_STATIC` when the selected export exists but its body cannot be read statically. A
`--story-name` that matches no export lands on `STORY_NOT_FOUND` with the candidates listed. The
whole warning list is attached as `error.warnings`; the codes below name what each entry means.

When a tree does come back, exit code is 0 and the output keeps its own shape (`screen` plus a
top-level `warnings`). It is the part that could be read, with the rest reported.
Analysis works purely on the source AST and the Story is never executed, so **any syntax whose
shape is only decided at runtime cannot be read**.

| code | Meaning |
| --- | --- |
| `STORY_NOT_FOUND` | No export with a `render` function (what a `component` + `args` Story produces without `--story-name`, and any `--target component` file) — or `--story-name` named no export at all; the message lists the candidates. Arrives as `error.code`, not as a warning. There is nothing to import and never will be — read the Story as text |
| `RENDER_NOT_STATIC` | The selected export exists but its `render` cannot be read statically — including `--story-name` picking an `args`-only export. Arrives as `error.code` too; the run ends with no tree, same as `STORY_NOT_FOUND` |
| `TITLE_NOT_STATIC` | The meta's `title` is not a static string, so the screen name falls back. The import itself continues |
| `OPAQUE_EXPRESSION` | An expression that cannot be read statically, such as `{items.map(...)}` or a conditional. That node is dropped |
| `OPAQUE_PROP` | The prop's value cannot be read (a variable reference, say). Only that prop is dropped |
| `OPAQUE_ELEMENT` | A DOM tag with no corresponding synthetic primitive. It survives as `Box`, but the tag name is lost |
| `SPREAD_ATTRIBUTE` | `{...args}` cannot be expanded |
| `INTENT_NOT_APPLIED` | A `TODO(yosegi)` intent comment had no single element to attach to (it preceded several siblings), so its `bindings` / `events` were dropped. Re-declare them on the right node |
| `OPAQUE_FIXTURE` | A top-level const whose initializer is not a JSON literal, so it was not read back into `fixtures`. Expect this on hand-written helper consts; a Yosegi-generated Story never triggers it |
| `COMPONENT_NOT_RESOLVED` | The import statement does not lead to a registry id. The node keeps its local name, so validation will offer candidates |
| `COMPONENT_AMBIGUOUS` | Several registry entries share the export name. Narrow it with `--import-map` |
| `IMPORT_PATH_MISMATCH` | The export name matches but the import source differs from the registry. Suspect a stale registry |
| `MULTIPLE_ROOTS` | There was more than one root element, so they were wrapped in a `Box` |
| `MULTIPLE_STORIES` | The file exports more Stories than the imported one (a `variants` file, typically). One export is read per run; pass `--story-name` to read another. The diff is never reconstructed into `variants` |

**Anything that produced a warning is absent from the Screen JSON.** Ignore them and that part of the
screen goes missing from the implementation entirely. Read the original Story directly for every
place a warning points at.

**An empty `warnings` array is not proof the import worked.** A Story whose `render` returns one
wrapper component — the other common hand-written shape — imports cleanly to a single node,
with nothing to warn about. Count the nodes against the Story you can see. `implementation.md`
covers when to use this command at all.

## Command errors

These come back as JSON with a `code`, exit code 1, and no `nodeId` — the command failed before it
reached the screen. Every code is self-correcting from the payload alone:

| code | Meaning | What to do |
| --- | --- | --- |
| `MISSING_ARGUMENT` | A required positional or flag is missing; `command` names the command | Supply what the message names (`--out` for `screen generate`, an id for `component inspect`, ...) |
| `UNKNOWN_COMMAND` | The command does not exist | Take the `suggestion` (did-you-mean over the real commands). A bare group (`yosegi registry`) gets its subcommands listed |
| `UNKNOWN_FLAG` | A flag the command does not understand. It is rejected, never silently ignored | Take the `suggestion`, or pick from `knownFlags` in the payload |
| `REGISTRY_NOT_FOUND` | No registry where the command looked; `path` and `dataDir` name the location consulted | Either you have not built one yet, or `--data-dir` differs from the one `registry build` wrote to. Check the second before rebuilding — the default (`.yosegi` under the cwd) moves with your working directory |
| `INVALID_ARGUMENT` | The argument combination is unusable (e.g. `--source` without `--tsconfig`) | Fix the invocation as the message says |
| `INVALID_JSON` | The file you passed is not valid JSON | Fix the file. The message says "Input file", not "Request body", on the CLI |
| `CONFIG_INVALID` | The host's `yosegi.config.json` cannot be used: unparsable JSON, a value of the wrong type, a key the schema does not know, or a duplicate `examples` key. `path` always names the file. A schema fault (wrong type or unknown key) also carries `issues`; a duplicate key carries `duplicateKeys` instead; unparsable JSON carries neither, because nothing was read | Fix the file. Only an unknown key can carry a did-you-mean in `suggestion`, and only when a near candidate exists — otherwise work from `issues`. It is never downgraded to a warning, because a silently dropped key is a default you would believe is in effect. The schema is in `cli.md` |
| `CONFIG_NOT_FOUND` | `--config` names a file that does not exist; `path` names it | Correct the path, or drop the flag and let discovery find one. Discovery finding nothing is *not* this error — it just means no config, and the flags stand on their own |
| `COMPONENT_NOT_FOUND` | The id you passed to `component inspect` (or wrote in a screen operation) is not in the registry | Take the `suggestion` (did-you-mean over the registry). A short id (`Button`) may need the full `<module path>#<export>` form from `component list` |
| `SCREEN_NOT_FOUND` | No saved screen has that id | List the saved screens (`yosegi screen list`) and use an id from there |
| `SCREEN_ALREADY_EXISTS` | `screen push` with an id the store already has, without an update intent | Pull the stored screen, or pick a new id |
| `INVALID_SCREEN_ID` | The id cannot become a file name | Letters, digits, `-` and `_` only |
| `REVISION_CONFLICT` | The pushed screen's `revision` does not follow the stored one | Pull the stored screen, reapply your change on top, push again. Note the store sets `revision: 1` on create while a hand-written file starts at `0`, so pushing the same file twice conflicts by design |
| `VALIDATION_FAILED` | `screen push` / `screen apply` rejected the screen; the envelope carries `validation` with the full issue list | Fix the issues exactly as in the validation loop above |
| `STORY_NOT_FOUND` / `RENDER_NOT_STATIC` | `story import` restored no tree; the envelope also carries `file` and the full `warnings` list | The Story cannot be imported at all — read it as text. The section above says which shapes land here |
| An operation code (`NODE_NOT_FOUND`, `PARENT_NOT_FOUND`, `SLOT_INDEX_OUT_OF_RANGE`, `DUPLICATE_NODE_ID`, `CANNOT_MOVE_INTO_DESCENDANT`, `CANNOT_REMOVE_ROOT`, `UNKNOWN_OPERATION`) | A `screen apply` operation could not be applied; the code names why. The same seven appear inside a `VARIANT_OPERATION_FAILED` message, which is where a variant's operations failed instead | Fix the operation against the stored screen's current tree and re-apply |
| `UNKNOWN_ARGUMENT` | A positional argument the command does not take. Only the `example` commands check this so far; `command` names the command and `unexpected` lists the extras | A value meant for a flag needs its `--name`. Drop the extra, or attach it to the flag it belongs to |
| `EXAMPLE_CATALOG_NOT_FOUND` | No example catalog where the command looked; `path` names the file | Pass `--catalog <path>`, or have the host place the catalog at `<data-dir>/examples.json`. A host with no catalog has no example route — assemble the screen instead |
| `EXAMPLE_NOT_FOUND` | No catalogued example has that key; `key`, `catalog` and `availableKeys` come with it | Take the `suggestion` (did-you-mean over the keys), or pick one from `availableKeys` |
| `EXAMPLE_TEMPLATE_NOT_FOUND` | The catalog entry's `templatePath` leads nowhere; `key`, `templatePath`, `catalog` and `root` name what was resolved against what | The catalog and the host's tree have drifted. Report it — fixing `templatePath` (or `root`) in the catalog is the host's change, not yours |
| `EXAMPLE_OUTPUT_EXISTS` | `--out` already exists; `out` names it. `example apply` never overwrites | Pick a different `--out`, or delete the file if you are sure it is yours to delete. Do not assume the existing file is a stale copy |
| `INTERNAL_ERROR` | Everything else, with the underlying message attached | Read the message; the table below lists the frequent ones |

The frequent `INTERNAL_ERROR` messages:

| `message` | Meaning | What to do |
| --- | --- | --- |
| `Story name "<name>" is not a valid JavaScript identifier.` | `--story-name` becomes an `export const`, so it has to be an identifier. Under `--target component` the same check says `Component name` | Use letters, digits, `_` or `$`, and do not start with a digit. `Customer list` → `CustomerList` |
| `Fixture "<name>" collides with the export name.` | A fixture or variant const would shadow the Story/component export | Rename the fixture or the story/component name; the same message exists for variant names |
| `Component "<id>" has export name "<name>", which is not a valid JavaScript identifier.` | The registry entry itself cannot be emitted as JSX | Pick a different component, or fix the export in the host |
| `Failed to read the Storybook index from <location>, given as --index.` | `registry build` could not read what `--index` named. Three more lines follow: a URL says to start Storybook so it responds, a path says to build Storybook; then whether dropping `--index` is an option; then `Underlying error:` with the original failure | Do what those lines say. With `--source` also given, dropping `--index` builds from the source alone — without Storybook categories or recommendations. Without `--source` there is no other input, so the build cannot continue |
| `Failed to read the Storybook index from <path>. No --index was given, so that is the default location.` | The same failure with no flag to blame: an `--index`-only build defaults to `storybook-static/index.json` under the cwd | Build Storybook so that file exists, or pass `--index`. Check the cwd first — the default moves with it |
| `ENOENT` / `no such file` | A path you passed does not exist | Check `--tsconfig`, the Screen JSON path, and `--metadata` |

A malformed screen `id` does **not** land here — it is an `INVALID_REQUEST` from the schema, because
the id becomes a file name. Letters, digits, `-` and `_` only.

## Plain-text notices

These carry no `code`, and every one of them appears alongside a *successful* exit code.

| Line | Meaning | What to do |
| --- | --- | --- |
| `Warning: --source matched no files (--project-root: <dir>)` | The glob's base is wrong | Globs resolve against `--project-root`, which defaults to the tsconfig's directory — never the cwd. The command still succeeded and wrote a registry of three synthetic primitives, so do not read `Wrote 3 components` as success |
| `Warning: <n> files were read but no React component exports were found` | The glob matched files, but none of them exports a React component | Check that the glob covers the host's `.tsx` component files and that the project uses React. The registry written holds nothing usable |
| `Warning: React's type definitions did not resolve ...` | `@types/react` is not reachable from the host's tsconfig (pnpm's strict `node_modules`, or no direct dependency on it) | Every `ReactNode` prop flattened to `json` / `shape: any` and no slots were detected — the stats show it as `withNodeSlots: 0` with a high `anyShapedProps`. Make `@types/react` resolvable from the host (install it as a direct dependency), then rebuild |
| `Warning: these --metadata ids matched no component: <ids>` | Those ids are mistyped | Nothing was applied for them. Copy the id from `component list` |
| `Note: the template only covers cva variants...` | Printed by every `registry metadata` run | The scaffold is incomplete by construction. Add the non-variant props from the source |
| `Note: <path>` from `registry metadata` | The variants could not be read | You get an empty scaffold. Write that component's props by hand from the named source |
| `Warning: this registry was built by ...` naming two Yosegi versions | The registry was written by a different Yosegi than the CLI now reading it | Rebuild with the printed command. An older Yosegi omits fields a newer one emits, and no other signal (version hash, `built` time) shows the gap |
| `Warning:` naming a URL inherited from `--meta-template` | A Figma or Notion link came along from the Story you built the template from | Check it and either remove or replace it. **Never leave a URL you have not verified** |
| `Warning: Ignored "title" from the meta template ...` | `title` and `component` are not carried over; the screen decides them | Harmless. Remove them from the template if you want the warning to stop |
| `Warning: Dropped the meta template import "<names>" ...` | The template imported something its carried-over meta never references | Harmless. Remove the unused import from the template to silence it |
| `Note: yosegi.config.json's emit.metaTemplate was not applied ...` | `--target component` writes a file with no Story meta, so a config-supplied meta template has nowhere to go | Nothing to fix. An explicit `--meta-template` on that target is an `INVALID_ARGUMENT` instead; only the config default is skipped |
