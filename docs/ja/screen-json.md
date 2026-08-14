# Screen JSON

[English](../screen-json.md) | 日本語

Yosegi が Story へ変換する画面ツリー。`screen generate` は何かを書き出す前にこれを Component
Registry と突き合わせて検証するので、このページは書き手（多くはエージェント）向けの仕様書になり
ます。

Screen JSON は中間表現です。一時ファイルとして扱ってよく、成果物ではありません。

## 形

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

## トップレベルのフィールド

| フィールド | 必須 | 値 |
| --- | --- | --- |
| `schemaVersion` | はい | `"1.0"` |
| `id` | はい | 英数字・`-`・`_` のみ（`/^[A-Za-z0-9_-]+$/`）。画面ストアでファイル名になるため `/` や `..` は弾かれる |
| `name` | はい | 人が読む画面名。既定の `title`（`Screens/<name>`）の元になる |
| `componentRegistryVersion` | はい | 生成した Registry の `version`。`<data-dir>/registry.json` か `component list --json` から取る。食い違いは警告どまり |
| `revision` | はい | 0 以上の整数。`0` から始める |
| `root` | はい | ルートの ScreenNode |
| `status` | いいえ | `"draft"`（既定）または `"published"` |
| `fixtures` | いいえ | モックデータ: `{ "<名前>": <任意の JSON 値> }`。[fixtures](#fixtures) を参照 |
| `variants` | いいえ | `root` への名前付き差分で表す画面状態。[variants](#variants) を参照 |

必須フィールドの欠落は検証の警告ではなく `INVALID_REQUEST` になります。

ScreenNode は `{ id, component, props, slots }` で、`props` と `slots` は空（`{}`）でも必須です。
ノードの `id` は画面全体で一意であること。`slots.children` は JSX の children になり、それ以外の
slot 名は prop として渡されます。

## コンポーネント id

型から作られた Registry の id は `<projectRoot からのモジュールパス>#<exportName>` の形を取ります。

```
app/components/ui/button#Button
app/components/ui/card#CardHeader
```

この id をそのまま `component` に書きます。1 ファイルが複数のコンポーネントを export する場合
（`Card` / `CardHeader` / `CardBody`）でも一意に定まるのはこの形だけで、export 名だけでは区別でき
ません。`CardHeader` とだけ書くと `COMPONENT_NOT_FOUND` になり、候補として完全な id が返ります。

`--index` 単独モードは互換のため短い id（`Button`）のままです。[Component Registry](./registry.md)
を参照してください。

## 合成プリミティブ

Registry に無くても使える構造用のコンポーネントです。import を必要としません。

| id | props | 出力 |
| --- | --- | --- |
| `Text` | `text` | JSX のテキストノード |
| `Box` | `className` | `<div className=...>`（`slots.children` を持てる） |
| `Heading` | `text` | `<h1 className="font-bold text-2xl tracking-tight">` |

実コンポーネントのラベルは、その `children` slot に `Text` を置いて表現します。

合成プリミティブは id の長さで見分けます。短い id（`"Text"`）はプリミティブを指し、ホストの
コンポーネントは完全な id（`"app/components/typography#Text"`）を使います。唯一の例外は `--index`
単独の Registry で、ホストの id も短いため、名前が衝突するとホストのコンポーネント側に解決され
ます。ソースから作った Registry に同名のコンポーネントがある場合、検証は完全な id を候補に添えて
`SYNTHETIC_NAME_SHADOWED` 警告を出します（ノードごとではなく名前ごとに 1 回）。プリミティブを使う
こと自体は正当なのでエラーではありません。`Heading` も同様に、見出しコンポーネントを持たないホスト
向けの既定にすぎません。見た目は Yosegi の既定であって、ホストのタイポグラフィ定義には従いません。

## bindings / events

データ由来の値とイベントは `props` ではなく `bindings` / `events` に宣言します。どちらも `props` の
中ではなく ScreenNode の直下に置きますが、**形が異なります**。

| フィールド | 形 | 例 |
| --- | --- | --- |
| `bindings` | `{ "<prop 名>": "<データ式の文字列>" }` | `"bindings": { "title": "segment.name" }` |
| `events` | `{ "<イベント名>": { "action": "<action 名>", "arguments": { ... } } }` | `"events": { "onClick": { "action": "navigate", "arguments": { "to": "/x" } } }` |

`bindings` の値は文字列そのものです。`{ "expression": "..." }` のようにオブジェクトで包むとスキーマ
違反
です（`INVALID_REQUEST`。正しい形は `hints` に出ます）。`events` の `arguments` は省略できます。

どちらのキーも Manifest と突き合わせて検証されます。存在しない prop を指す `bindings` のキーは
エラー（`UNKNOWN_BINDING_TARGET`）。存在しない prop に値を書くのと同じ間違いだからです。`events`
のキーは警告どまり（`UNKNOWN_EVENT_TARGET`）で、これは Manifest がイベントの一覧を持たず、ハンドラ
が関数型の prop としてしか現れないためです。

binding の宛先は prop でなければなりません。型から作られた Registry では `ReactNode` の prop は
prop ではなく **slot** になります。`children` も同様です。ノードのテキストをデータ由来にしたい場合
は、そのコンポーネントが実際に宣言している文字列の prop へ binding するか、テキストは
`slots.children` へ置いたまま実装時に結線します。

`bindings` の記述そのものは prop の型と突き合わされません。値が具体化するのは実装時だからです。
一方、`props` に書いたモック値は binding の有無にかかわらず通常どおり検証されます。binding が検証を
免除することはありません。

関数型の prop に値は書けません。`FUNCTION_PROP_VALUE` はエラーで、生成は止まります。ハンドラ名を
文字列で書くと Story に文字列がそのまま出るためです。ハンドラは `events` に宣言します。リテラル
では表現できない kind（`json`、`reactNode`）の prop には値を書けますが、形は検証されないので警告に
とどまります（`NOT_EDITABLE_PROP_VALUE`）。ソースから作った Registry はその種類の prop を
not-editable にします。`--metadata` で宣言した同種の prop にその印が無い場合、
値は警告なく受理されます。

いずれの宣言も、意図を JSON で載せた申し送りコメントとして生成物の Story に残り、`story import` が
読み戻します。

```tsx
{/* TODO(yosegi): {"bindings":{"title":"segment.name"}} */}
{/* TODO(yosegi): {"events":{"onClick":{"action":"navigate","arguments":{"to":"/customers/new"}}}} */}
```

### binding はモックの値ではない

binding は「実装時にどこから値が来るか」の宣言であって、モックが表示できる値は持ちません。同名の
[fixture](#fixtures) が値を供給する場合だけが例外になります。fixture が無ければ、optional な prop は
prop が出力されないだけでモックは描画できます。**required** な prop の場合、エミッタは prop を落とさ
ずに式そのものを JSX へ書き（`rows={customers}`）、検証は `BOUND_REQUIRED_PROP` を警告します。その名
前は Story に存在しないので、ホストの型検査はそこで止まります。binding の先頭と同じ名前の fixture を
宣言するか、`props` にモック値を与え、binding は意図として残します。例外は required なハンドラで、何
もしない `() => {}` が埋められるため `events` への宣言だけでかまいません。

## fixtures

`fixtures` は画面のモックデータ層です。名前付きの JSON 値で、生成される Story では import と meta の
間に、書いた順で、トップレベルの `const <名前> = <値>;` 宣言になります。式が fixture 名から始まる
binding は、実在する値への参照になります。モックが表示する値と実装が置き換える結線先を、1 つの宣言が
両方運びます。

```json
{
	"fixtures": { "customers": [{ "name": "Sato" }, { "name": "Suzuki" }] },
	"root": {
		"id": "table", "component": "app/components/table#Table", "props": {}, "slots": {},
		"bindings": { "rows": "customers" }
	}
}
```

これは `const customers = [...]` と `rows={customers}` を出力します。値が実在するため、binding は
optional な prop でも JSX へ書かれます。required な prop で `BOUND_REQUIRED_PROP` 警告が消えるのも
同じ理由です。`story import` は const を `fixtures` へ復元するので、往復は無損失です。参照元の
binding を持たない fixture は、出力こそされますが `UNUSED_FIXTURE` 警告が付きます。

fixture 名は JavaScript の識別子であること。また `meta` / `Meta` / `StoryObj` は使えません
（スキーマ違反、`INVALID_REQUEST`）。これらは生成される Story が自ら宣言する名前で、binding が
書かれたとおりに参照する以上、fixture の const はリネームできないからです。Story の export 名
（`Default`、または `--story-name`）と同じ名前は生成時に弾かれます。fixture 名と衝突する
コンポーネント import はサフィックス付きの別名へ退避します。

fixtures が持てるのは JSON だけです。JSON の形を持たない値（テーブルインスタンス、コンポーネント
参照、関数）は依然として表現できません。そうした画面は Story を直接書きます。

## variants

`variants` は画面のほかの状態（ローディング、エラー、空）を、`root` への名前付き差分として表現し
ます。生成時に各エントリの `operations` がベースの木へ適用され、その結果が同じファイル内の追加の
`export const <name>: Story` になります。1 つの Story モジュールが全状態を運び、レビュアーは
Storybook でそれらを並べて見られます。import・fixtures・meta は共有され、`description` はその
variant の export 直上の JSDoc になります。

```json
{
	"variants": [
		{
			"name": "Loading",
			"description": "Rows are being fetched.",
			"operations": [
				{ "type": "setProps", "nodeId": "table", "props": { "loading": true } }
			]
		},
		{
			"name": "Empty",
			"operations": [
				{ "type": "setProps", "nodeId": "table", "props": { "rows": [] } }
			]
		}
	]
}
```

この例は [fixtures](#fixtures) の画面の続きで、その画面ではルートが `table` ノード自身になります。
`removeNode` はルートを対象にできない（`VARIANT_OPERATION_FAILED`）ため、空状態は代わりに
`rows: []` を設定します（`props` の値は binding より優先されます）。ルートがレイアウトコンテナの
画面なら、子ノードの削除でも空状態を表現できます。

operation は `screen apply` と MCP ツール `apply_screen_operations` が受け取るのと同じ形をして
います。

| `type` | フィールド | 効果 |
| --- | --- | --- |
| `addNode` | `target: { parentNodeId, slot, index? }`, `node` | サブツリーを挿入する（`index` の既定は末尾） |
| `removeNode` | `nodeId` | ノードを取り除く（ルートは不可） |
| `moveNode` | `nodeId`, `target` | ノードを切り離し、`target` へ挿入する |
| `replaceNode` | `nodeId`, `node` | サブツリーを差し替える（ルートも可） |
| `setProps` / `setBinding` / `setEvent` | `nodeId`, `props` / `bindings` / `events`, `merge?` | 既存のレコードへマージする。`merge: false` は置き換える |
| `duplicateNode` | `nodeId`, `newId?` | id を振り直した複製をノードの直後へ挿入する |

`name` は export の識別子になるため、fixture 名と同じ規則に従います。JavaScript の識別子であること、
`meta` / `Meta` / `StoryObj` でないこと、variant 同士で一意であること、fixture 名と同じでないこと
（いずれも `INVALID_REQUEST`）。ベースの Story の export 名（`Default`、または `--story-name`）と
同じ名前は生成時に弾かれます。

検証はすべての variant に及びます。適用後の木がベースと同じように検証され、その issue は variant 名
を持つ `variant` フィールドを運びます。`path` は operations 適用**後**の木を指します。適用できない
operation（ベースの木に無い `nodeId` など）は `VARIANT_OPERATION_FAILED` になります。ベースから受け
継いだだけの issue はベース側で 1 回だけ報告されます。

`repeat` と同じく、variants は往復で生き残りません。`story import` は 1 回の実行で 1 つの export を
読みます（どれを読むかは `--story-name` で選ぶ）。残りの export は `MULTIPLE_STORIES` 警告で名指し
され、差分が `variants` へ再構成されることはありません。

## when / each / repeat

ノードは `when`（条件表示）と `each`（繰り返し）も持てます。どちらも文法の無い自由記述の文字列で、
検証もされません。どちらも JSX は生成しません。宣言自体は `bindings` / `events` と同じ申し送り
コメントに載ります。

```tsx
{/* TODO(yosegi): {"when":"customers.length > 0","each":"customer in customers"} */}
```

`repeat`（2〜20 の整数）は `each` の構造版で、生成時にサブツリーがその数の複製へ展開されるため、
手でノードを複製しなくてもモックは一覧に見えます。両者は独立していて、たいてい併用します。`each` は
実装時に**何が**繰り返されるかを、`repeat` はモックが複製を何個見せるかを言います。Screen JSON 上は
1 ノードのままです。複製の id には `-1`〜`-N` サフィックスが付き、サフィックス後の id が既存ノードの
id と衝突すると `DUPLICATE_NODE_ID` エラーになります。ルートの `repeat` は弾かれ
（`REPEAT_ON_ROOT`）、値域外は `REPEAT_OUT_OF_RANGE` になります。

fixtures と違い、`repeat` は往復で生き残りません。生成された Story は展開済みの複製を素の JSX として
持ち、`story import` はそれを `repeat` フィールドの無い個別ノードとして読み戻します。取り込んだ
Story から JSON の経路に入り直す場合は自分で畳み直してください。

## 次に読む

- [ワークフロー](./workflows.md) — 検証ループ、エラー code、Story から実装への転換。
- [CLI リファレンス](./cli.md) — Screen JSON を読み書きするコマンド。
