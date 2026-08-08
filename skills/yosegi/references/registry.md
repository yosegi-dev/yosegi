# Reading the registry

The registry is the only thing that knows what the host's components are actually called and what
they actually take. Read it before you write a component, whichever route you take. Everything here
applies equally to a hand-written Story and to a Screen JSON.

## Narrowing down

`component list` prints a three-line summary per component. Several hundred entries is normal, so
narrow first and read summaries before dropping into `inspect`.

```
app/components/ui/button#Button [app/components/ui] recommended
    props: className:string disabled:boolean onClick:function size:enum(3) variant:enum(3)
    slots: children startIcon
```

- The id is `<module path relative to project root>#<exportName>`. It identifies a component
  uniquely even when one file exports several (`Card` / `CardHeader` / `CardBody`), and it is what
  Screen JSON's `component` field takes verbatim.
- `enum(3)` means "one of three"; `inspect` shows which three. `*` marks a required prop.
- `recommended` means the component has a Story of its own. Prefer those.
- **Several components can share an export name.** A design system that has both its own pagination
  and the one it forked will list two or three `Pagination` entries under different module paths.
  The summary line is where you notice; the id is how you pick.

## `component inspect`

```
app/components/data-grid#DataGrid [Components] recommended

import { DataGrid } from "~/components/data-grid";
story: Components/DataGrid (9)
storybook: http://localhost:6006/?path=/story/components-datagrid--playground
story file: ./app/components/data-grid.stories.tsx
stories: Playground, Default, With Row Actions, Empty State, Sticky Header

props (4)
  rows  json  required  not-editable
      shape: RowModel<TRow> (@rowkit/table-core)
  selection  json  not-editable
      shape: SelectionState
        allSelected    boolean     whether every row across all pages is selected
        selectedCount  number      how many rows are currently selected
        onSelectAll    () => void  called when the user selects every row
        onClear        () => void  called when the selection is cleared
  rowActions  json  not-editable
      shape: RowAction[]
  emptyStateLabel  string

slots (0)
  -
```

### The import line

**Use it as your starting point, but know what it actually is.** It is the module path resolved
through the host's tsconfig `paths` (`~/components/data-grid`, not
`../../app/components/data-grid`) — the deepest module the component is declared in, not
necessarily the entry point the host's own code imports from. It compiles either way, but a host that
also maintains a barrel (`~/components/pagination` re-exporting
`~/components/pagination/paginator`) may write the barrel in most of its own files while
this line prints the deep path. Check what an existing Story imports (step 2) and follow that when it
differs from `inspect`. Reconstructing the import from the module path in the id, rather than from
this line, produces one the host cannot resolve. If the line looks wrong outright — not just
different in style — the cause is the wrong tsconfig passed to `registry build`, not something to fix
by hand.

**It does not work in reverse.** An import you see in existing host code cannot be turned into a
registry id — guessing `app/components/pagination#Paginator` from a
`~/components/pagination` import returns not-found. ids come only from `component list` /
`component inspect`, never from reading an import statement.

### The Story coordinates

`storybook:` deep-links the first Story of the title, usually a playground. When you need the Story
that demonstrates one specific behaviour, take the name from `stories:` and open `story file:`. The
host's own Stories are the best evidence for how a component is meant to be composed — read one
before inventing a composition.

### Props

- The enum options are the whole list. A forked design system routinely renames them: the button
  variant set you remember from upstream is not the set here, and neither is the size scale. Two
  components in the same host can disagree about the same concept — a leading icon called
  `iconBefore` on one and `startIcon` on its neighbour, a size scale with `sm` on one and `xs2`
  on the other. There is no rule to infer; read each one.
- `required` means the prop must be given a value. Its *absence* does not prove the prop is
  optional: for components with a union props type the determination is unreliable, so it is dropped
  rather than guessed.
- `not-editable` means the value cannot be checked against anything. Function props reject a value
  outright; the rest reach the Story unchecked.
- A `default:` is the component's own default, so you can leave that prop out and know what you get.

### Slots

A `ReactNode` prop is reported as a **slot**, not a prop. `children` is the common one, but a slot
can have any name — an `icon` slot that takes the element, a `footer`, a `separator`, a `heading`.
`slots (1) icon required` means the component takes no children at all and the icon goes in a named
prop. This is a routine source of wrong JSX and there is no way to guess it.

## Opaque props and what they mean

A prop reported as `json` or `function` takes a value no literal can express. `inspect` prints one
level of the type's shape underneath it:

- `signature: (file: File) => void` is a function prop's call signature. Write the handler to that
  signature. Two or more lines under `signatures (2 overloads):` mean the prop accepts either call;
  pick one. A function prop with no `signature:` line is one whose type has no single call signature
  — usually a union of a function and a literal — and you have to read the host's source.
- `shape: SelectionState` followed by indented fields, each with its description, means the host has
  documented that type. Use the fields as written.
- `shape: Feature[]` followed by one line of `"bold" | "italic" | …` means the type is a union of
  literals: those are the values you may write, the same as an enum's `options`. A trailing
  `(+N more)` means the list was cut.
- `shape: RowModel<TRow> (@rowkit/table-core)` with no fields and no description means the host has
  documented nothing. The parenthesised name is the package that declares the type, so you can read
  it in `node_modules` if you need it; without it, the registry has told you everything it can.
  **You may say so plainly** — it is a fact about the host's source, not a failure on your part.
- `shape: RowAction[] (each item: fields below + exactly one of the variants)` followed by shared
  fields and then an `exactly one of:` group is a discriminated union: every item carries the shared
  fields, plus **exactly one** of the listed variants — not any combination. The variant fields have
  no `?` because within their branch they are required. Pick one variant per item; the host's type
  checker rejects mixing them.
- `shape: RowAction[]` with no fields, no description, and **no parenthesised package name**
  means the type is declared inside the host itself, not in a `node_modules` package — there is
  nothing to read in a dependency. Find and read the host source file that declares the type (grep
  the type name across the host) rather than running `--report`, which only surfaces documentation
  gaps and cannot show you a definition that does not exist yet.
- `shape: IconComponent` with a description like "pass the icon component" is the case that catches
  people: the prop wants the component reference (`icon={Plus}`), not an element
  (`icon={<Plus />}`). Only the description distinguishes those, which is why the next section
  matters.

## When the host has not documented a prop

Prop descriptions come from JSDoc on the host's props type. Measured on a production design system,
adding 8 lines of JSDoc to one component's props took `inspect`'s output for it from 277 B to
1301 B, and took an agent working from that output from a broken screen to a correct one. It is the
single highest-leverage change the host team can make to this workflow.

`registry build` reports how widespread the gap is — `documentedProps` out of `props`, and
`undocumentedRequiredOpaqueProps`, which counts required props that take a non-literal value and
describe it nowhere. `--report <path>` names them, ranked `required-opaque` first and grouped by
component.

So when you hit a prop you cannot fill in, raise it concretely rather than as a general suggestion:
run `registry build --report`, quote the count and the first few entries, and say that JSDoc on
those props — what the value's fields are, what happens when it is omitted, what the caller must do
— is what would unblock it. Do not guess a value in the meantime. Ask, or leave the prop out if it
is optional.

## When props could not be read at all

```
Note: props could not be read from the types. This list is not the real API, so read the host's source directly.
```

Components with a union props type, and components exported through a cast, defeat type extraction.
Almost nothing reaches the registry for them, and reading the host's source to learn the right prop
name **does not fix it on the Screen JSON route** — the registry still does not know the prop, so
validation rejects it with `UNKNOWN_PROP`. Supplement the registry with `registry metadata` and
`registry build --metadata` (`cli.md`). On the direct-authoring route you can simply write the props
you read from the source; the host's type checker is what verifies them.

If that Note is **absent**, the list is the real API. A short list means the component really does
take that little, and a missing `className` or `children` means it really does not accept one.
