# Screen JSON

[English](../screen-json.md) | 日本語

Yosegi が Story へ変換する画面ツリー。`screen generate` は何かを書き出す前にこれを Component
Registry と突き合わせて検証するので、このページは書き手（多くはエージェント）向けの仕様書になる。

Screen JSON は中間表現。一時ファイルとして扱ってよく、成果物ではない。

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

必須フィールドの欠落は検証の警告ではなく `INVALID_REQUEST` になる。

ScreenNode は `{ id, component, props, slots }` で、`props` と `slots` は空（`{}`）でも必須。ノード
の `id` は画面全体で一意であること。`slots.children` は JSX の children になり、それ以外の slot 名は
prop として渡される。

## コンポーネント id

型から作られた Registry の id は `<projectRoot からのモジュールパス>#<exportName>` の形を取る。

```
app/components/ui/button#Button
app/components/ui/card#CardHeader
```

この id をそのまま `component` に書く。1 ファイルが複数のコンポーネントを export する場合（`Card` /
`CardHeader` / `CardBody`）でも一意に定まるのはこの形だけで、export 名だけでは区別できない。
`CardHeader` とだけ書くと `COMPONENT_NOT_FOUND` になり、候補として完全な id が返る。

`--index` 単独モードは互換のため短い id（`Button`）のまま。[Component Registry](./registry.md)
を参照。

## 合成プリミティブ

Registry に無くても使える構造用のコンポーネント。import を必要としない。

| id | props | 出力 |
| --- | --- | --- |
| `Text` | `text` | JSX のテキストノード |
| `Box` | `className` | `<div className=...>`（`slots.children` を持てる） |
| `Heading` | `text` | `<h1 className="font-bold text-2xl tracking-tight">` |

実コンポーネントのラベルは、その `children` slot に `Text` を置いて表現する。

合成プリミティブは id の長さで見分ける。短い id（`"Text"`）は常にプリミティブを指し、ホストの
コンポーネントは完全な id（`"app/components/typography#Text"`）を使う。同名のコンポーネントが
Registry にもある場合、検証は完全
な id を候補に添えた `SYNTHETIC_NAME_SHADOWED` 警告を出す。プリミティブを使うこと自体は正当なのでエ
ラーではない。`Heading` も同様に、見出しコンポーネントを持たないホスト向けの既定にすぎない。見た目は
Yosegi の既定であって、ホストのタイポグラフィ定義には従わない。

## bindings / events

データ由来の値とイベントは `props` ではなく `bindings` / `events` に宣言する。どちらも `props` の中
ではなく ScreenNode の直下に置くが、**形が異なる**。

| フィールド | 形 | 例 |
| --- | --- | --- |
| `bindings` | `{ "<prop 名>": "<データ式の文字列>" }` | `"bindings": { "title": "segment.name" }` |
| `events` | `{ "<イベント名>": { "action": "<action 名>", "arguments": { ... } } }` | `"events": { "onClick": { "action": "navigate", "arguments": { "to": "/x" } } }` |

`bindings` の値は文字列そのもの。`{ "expression": "..." }` のようにオブジェクトで包むとスキーマ違反
（`INVALID_REQUEST`。正しい形は `hints` に出る）。`events` の `arguments` は省略できる。

どちらのキーも Manifest と突き合わせて検証される。存在しない prop を指す `bindings` のキーは
エラー（`UNKNOWN_BINDING_TARGET`）。存在しない prop に値を書くのと同じ間違いだからである。`events`
のキーは警告どまり（`UNKNOWN_EVENT_TARGET`）で、これは Manifest がイベントの一覧を持たず、ハンドラ
が関数型の prop としてしか現れないため。

binding の宛先は prop でなければならない。型から作られた Registry では `ReactNode` の prop は prop
ではなく **slot** になる。`children` も同様である。ノードのテキストをデータ由来にしたい場合は、その
コンポーネントが実際に宣言している文字列の prop へ binding するか、テキストは `slots.children` へ置
いたまま実装時に結線する。

`bindings` を持つ prop は型検証の対象外になる。値が具体化するのは実装時だからである。

関数型の prop に値は書けない（`FUNCTION_PROP_VALUE`）。ハンドラ名を文字列で書くと、Story には文字列
がそのまま出るためである。ハンドラは `events` に宣言する。関数以外で Registry が not-editable と
している prop には値を書けるが、形は検証されないので警告が出る（`NOT_EDITABLE_PROP_VALUE`）。

いずれの宣言も、意図を JSON で載せた申し送りコメントとして生成物の Story に残り、`story import` が
読み戻す。

```tsx
{/* TODO(yosegi): {"bindings":{"title":"segment.name"}} */}
{/* TODO(yosegi): {"events":{"onClick":{"action":"navigate","arguments":{"to":"/customers/new"}}}} */}
```

### binding はモックの値ではない

binding は「実装時にどこから値が来るか」の宣言であって、モックが表示できる値は持たない。同名の
[fixture](#fixtures) が値を供給する場合だけが例外になる。fixture が無ければ、optional な prop は
prop が出力されないだけでモックは描画できる。**required** な prop の場合、エミッタは prop を落とさ
ずに式そのものを JSX へ書き（`rows={customers}`）、検証は `BOUND_REQUIRED_PROP` を警告する。その名
前は Story に存在しないので、ホストの型検査はそこで止まる。binding の先頭と同じ名前の fixture を宣
言するか、`props` にモック値を与え、binding は意図として残す。例外は required なハンドラで、何もし
ない `() => {}` が埋められるため `events` への宣言だけでよい。

## fixtures

`fixtures` は画面のモックデータ層。名前付きの JSON 値で、生成される Story では import と meta の
間に、書いた順で、トップレベルの `const <名前> = <値>;` 宣言になる。式が fixture 名から始まる
binding は、実在する値への参照になる——モックが表示する値と実装が置き換える結線先を、1 つの宣言が
両方運ぶ。

```json
{
	"fixtures": { "customers": [{ "name": "Sato" }, { "name": "Suzuki" }] },
	"root": {
		"id": "table", "component": "app/components/table#Table", "props": {}, "slots": {},
		"bindings": { "rows": "customers" }
	}
}
```

これは `const customers = [...]` と `rows={customers}` を出力する。値が実在するため、binding は
optional な prop でも JSX へ書かれる。required な prop で `BOUND_REQUIRED_PROP` 警告が消えるのも
同じ理由である。`story import` は const を `fixtures` へ復元するので、往復は無損失。参照元の
binding を持たない fixture は、出力こそされるが `UNUSED_FIXTURE` 警告が付く。

fixture 名は JavaScript の識別子であること。また `meta` / `Meta` / `StoryObj` は使えない
（スキーマ違反、`INVALID_REQUEST`）。これらは生成される Story が自ら宣言する名前で、binding が
書かれたとおりに参照する以上、fixture の const はリネームできないからである。Story の export 名
（`Default`、または `--story-name`）と同じ名前は生成時に弾かれる。fixture 名と衝突する
コンポーネント import はサフィックス付きの別名へ退避する。

fixtures が持てるのは JSON だけ。JSON の形を持たない値——テーブルインスタンス、コンポーネント参照、
関数——は依然として表現できないので、そうした画面は Story を直接書く。

## when / each / repeat

ノードは `when`（条件表示）と `each`（繰り返し）も持てる。どちらも文法の無い自由記述の文字列で、
検証もされない。どちらも JSX は生成しない。宣言自体は `bindings` / `events` と同じ申し送り
コメントに載る。

```tsx
{/* TODO(yosegi): {"when":"customers.length > 0","each":"customer in customers"} */}
```

`repeat`（2〜20 の整数）は `each` の構造版で、生成時にサブツリーがその数の複製へ展開されるため、
手でノードを複製しなくてもモックは一覧に見える。両者は独立していて、たいてい併用する——`each` は
実装時に**何が**繰り返されるかを、`repeat` はモックが複製を何個見せるかを言う。Screen JSON 上は
1 ノードのまま。複製の id には `-1`〜`-N` サフィックスが付き、サフィックス後の id が既存ノードの
id と衝突すると `DUPLICATE_NODE_ID` エラーになる。ルートの `repeat` は弾かれ（`REPEAT_ON_ROOT`）、
値域外は `REPEAT_OUT_OF_RANGE` になる。

fixtures と違い、`repeat` は往復で生き残らない。生成された Story は展開済みの複製を素の JSX として
持ち、`story import` はそれを `repeat` フィールドの無い個別ノードとして読み戻す。取り込んだ Story
から JSON ルートに再入する場合は自分で畳み直すこと。

## 次に読む

- [ワークフロー](./workflows.md) — 検証ループ、エラー code、Story から実装への転換。
- [CLI リファレンス](./cli.md) — Screen JSON を読み書きするコマンド。
