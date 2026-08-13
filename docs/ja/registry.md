# Component Registry

[English](../registry.md) | 日本語

Component Registry はホストのソースの TypeScript の型から生成される。このページでは抽出の仕組み、
その裏にある判断、そして実ホストでの実測を扱う。

- 実装: `packages/server/src/registry/source-registry.ts`
- CLI: `registry build --source <glob> --tsconfig <path> [--index <path|url>]`
- 計測日 2026-08-07、対象は実運用の React デザインシステム（`app/components/**`）

## 誰に効くか

Registry の効果は、ホストの部品が一般的な React 知識からどれだけ乖離しているかに比例する。改変してい
ない component ライブラリ、あるいはそれを薄くラップしただけのホストには効果が小さい。エージェントは
その API をたいてい何の助けもなく正しく推測できる。variant 名を独自に付け替え、独自の prop 語彙を
発明し、状態を実行時オブジェクトでモデル化し、ドメイン固有の enum を組んだホストほど効果は大きい。
それらは一般的な React 知識から推測しようがないため。

これは、その幅を意図的にカバーする 5 本の合成 fixture で計測した。改変していない shadcn/ui の画面と
薄い Next.js/Radix ラッパーから、中程度のカスタマイズを経て、API を全面的に付け替えて独自の実行時抽象
を持つ重度に乖離した in-house システムまでを並べた。各 fixture で同じ画面を 2 通り実装した——一般的な
React・ライブラリ知識のみで 1 回、`component inspect` を使って 1 回——そして `tsc` でチェックした。
Registry ありではどの fixture も型エラー 0 件に達した。無しでは、ほぼ改変していない fixture はもとも
と 0〜1 件で、カスタマイズ・乖離した fixture は 8〜17 件の幅に散らばった。生のエラー数それ自体は乖離
度の指標ではない。ある乖離した fixture は、中程度にカスタマイズした fixture よりエラー数が少なかった。
理由は、画面で使う部品数の少なさだけである。ただしその中身（単一モデルを期待する箇所に配列を
渡す、ドメイン enum の代わりに汎用トーンの enum を当てる、イベント名の取り違え）は種類として最も深い
誤りだった。これらの fixture は合成であり、この幅をカバーするために意図的に作られたもの。持ち帰るべき
は形——片端では効果ほぼゼロ、もう片端では効果大——であって、特定のホストで期待できる数値ではない。

## 3 つの情報源と役割

- **TypeScript の型が部品についての正。** props、slots、import 先はすべて型から導かれるので、ホストが
  Registry を手書きすることは無く、実装からずれることも無い。
- **Story はキュレーションの信号と使用例。** ホストがどれを使ってほしいのか、どう組み合わせるのかを
  示す。
- **Storybook は描画環境。** 組んだものを見る場所。

props を型から読めることが検証を可能にしている。`variant` のような enum は取りうる値が分かるので、
誤った値は選択肢付きの `INVALID_PROP_VALUE` として返り、人のレビューへ逃げていかない。Story の有無に
関わらず export されている部品はすべて見え、import 先はファイルパスからの推測ではなく確定値になる。

型では表現できない少数の部品については `--metadata` が手作業で穴を埋める。
[きれいに抽出できないパターン](#きれいに抽出できないパターン)を参照。

## 仕組み

型の抽出には
[react-docgen-typescript](https://github.com/styleguidist/react-docgen-typescript) を使う。Storybook が
argTypes を生成するのと同じ実装なので、Registry の内容がホストの Storybook での見え方から乖離しにくい。
`@yosegi/core` は zod のみに保つ方針なので、型抽出は `@yosegi/yosegi` に置いている。

### TypeScript 7 のホスト

TypeScript 7.0 はコンパイラ API を同梱しておらず、型抽出は 6.x の API の上に成り立っている。
そのため 7 を入れているホストは、TypeScript チームが公開している互換パッケージへ `typescript` を
エイリアスする必要がある。`tsc` は 7 のまま、ツールには 6.x の API が渡る。

```sh
# npm
npm install -D typescript@npm:@typescript/typescript6
# pnpm
pnpm add -D typescript@npm:@typescript/typescript6
# yarn
yarn add -D typescript@npm:@typescript/typescript6
# bun
bun add -d typescript@npm:@typescript/typescript6
```

これでツリー上の `typescript` は 1 つになり、Yosegi と共有される。エイリアスが無い場合、
`registry build` は解決した version と上記コマンドを添えて失敗する。Yosegi 側にコピーが入るだけでは
解決しない。パッケージマネージャが react-docgen-typescript をホストのツリー最上位へ巻き上げるため、
`@yosegi/yosegi` 配下のコピーではなくホストの 7 を見てしまう。

### id と import

- `id` = `<projectRoot からのモジュールパス>#<exportName>`（例: `app/components/ui/card#CardHeader`）
- `import.packageName` = Storybook の `componentPath` と同じ形（`./app/components/ui/card.tsx`）
- `import.exportName` = 実際の名前付き export
- `import.specifier` = ホストの tsconfig `paths` を解決したモジュールパス（`~/components/ui/card`）。
  コンパイルは通るが、ホスト自身のコードが実際に書く specifier とは限らない
- `import.kind` = default export なら `"default"`。名前付きの場合は付かない

この `モジュールパス#exportName` 形式が Registry id の正式な形（決定事項）。1 ファイルが複数の部品を
export する場合（`Card` / `CardHeader` / `CardBody`）を区別できるのはこの形だけで、名前だけでは足り
ない。

`--source` を伴わない `--index` 単独での生成にも対応している。この経路には読むべき型が無いので、id は
短く（`Button`）props も無い。`--source` と併用するキュレーション用、あるいは `--metadata` の手書きを
前提とした簡易用途という位置づけ。

`--project-root` は glob と id の基準で、既定は `--tsconfig` のあるディレクトリ（ホストのパッケージ
ルート）。`app/components` を基準にすれば id は `ui/card#CardHeader` と短くなるが、
`import.packageName` の基準とずれるので既定は変えていない。

**`packageName` はパス、`specifier` は import 文**。tsconfig の `paths` で alias を張っているホストは
`./app/components/ui/card.tsx` とは書かない。だから、パスしか報告しない Registry はエージェントへ
解決できない 1 行を渡すことになる。そのため Registry 生成時にホストの `paths` を解いて生パスと併せて保存し、
`component inspect` と `screen generate` はどちらもそちらを使う。複数の alias が当たる場合は
より深い substitution の方を採用する（`"~/*": ["./app/*"]` が総当たりの `"*": ["./*"]` に勝つ）。末尾の
`/index` は落とし、どの alias にも当たらないファイルは相対パスのままにする。tsconfig の外（bundler の `resolve.alias` 等）
で alias を張っているホストは `registry build --import-map "./app=~"` で解決ごと上書きできる。

`screen generate` の `--import-map` は後段の別の仕組みで、生成時に `packageName` を書き換え、
`specifier` より優先される。既にこのフラグを渡しているパイプラインの出力は変わらない。

`specifier` が指すのは部品が宣言されている最も深いモジュールであって、ホストが実際に import したがる
入口とは限らない。バレル（`~/components/pagination/paginator` を re-export する
`~/components/pagination`）を併設しているホストは、自前のコードの大半でバレルを書く。それでも
`specifier` は深い方のパスを報告することがある。どちらもコンパイルは通るが、ホストの支配的な流儀に合う
のは片方だけ。実運用ホストでの計測では、同じディレクトリでバレルの import が 22 回、深い方のパスが 10 回現れ、
example のテンプレートはバレルを使っていた。`specifier` は「解決済みでコンパイルが通るパス」として
扱い、「ホストが好む方」だという主張だとは受け取らないこと。

### default export

default export はモジュール上の名前を持たないので、宣言側の名前を使う。`export default function
ContentCard` と `export default ContentCard` はどちらも `ContentCard` になる。import の書き方は
`import.kind: "default"` に残す。これは見た目より効く。ページ相当の合成例は慣習的に
`export default function` で書かれるので、これが無いと Registry からは丸ごと見えない。

同じ実体を named と default の両方で export しているファイルは、named の方で 1 件だけ登録する。
無名の default export（`export default () => ...`）は id にも JSX のタグ名にもできる名前が無いので
載せず、`--report` に `unnamed-default` として報告する。

export 名は `displayName` ではなく TypeChecker が返すモジュールの export 名を使う。
`ForwardedText.displayName = "Text"` のように実際の export 名と表示名を入れ替える部品があるため、
`displayName` を基準にすると id が壊れる。react-docgen-typescript の `componentNameResolver` へ
`(exp) => exp.getName()` を渡している。さらに、自前の `checker.getExportsOfModule()` から得た
export 名と突き合わせている。

### props の型の変換

| 型 | Registry での扱い |
| --- | --- |
| `string` / `number` / `boolean` | 同名の kind |
| 文字列・数値リテラルの union | `enum` + `options` |
| `null` を含む union | `nullable: true`（`options` からは除く） |
| `ReactNode` / `ReactElement` | prop ではなく **slot** |
| 関数型（`=>` を含む） | `function` / `editable: false` + `signatures` |
| それ以外 | `json` / `editable: false` + `shape`（呼び出せる型なら `signatures`） |
| JSDoc | `description` |

`shouldExtractValuesFromUnion` を有効にすると、任意 prop はすべて `name: "enum"` として届く
（`string \| undefined` も union だから）。型名からは何も分からないので、順序はこうなる。リテラルの
一覧を取り出せたときだけ enum として扱い、それ以外は `raw` の型テキストから判断する。cva の
`VariantProps` は `"md" | "lg" | null` の形で届くので、この経路で enum になる。

`options` の並びは TypeScript がリテラル型を生成した順であって、宣言順とは限らない。同じ入力に対して
安定はしているが、順序に意味を持たせてはいけない。

### HTML 属性と衝突する variants

`React.HTMLAttributes<T> & VariantProps<typeof variants>` で組む部品は、cva の `color` variant が
`HTMLAttributes` の非推奨 `color` 属性と衝突する。このとき react-docgen-typescript は React
側の宣言から型を取るため、`"primary" | "danger"` が `string` へ潰れる。宣言元も React として報告され、
propFilter に落とされる。

**ホスト側の宣言を採る**（決定事項）。TypeChecker は交差型を正しく解決して `"primary" | "danger"` を
返すので、衝突した props だけを型から読み直して差し替える。

判定は「props 型のこのプロパティが `@types/react` の外に宣言を 1 つ以上持つか」。TypeChecker が交差型に
対して作る合成シンボルは衝突した両側の宣言を持ち、`VariantProps` のような mapped type でも宣言は cva
ではなく variants を定義しているホストのファイルを指す。`Omit<InputHTMLAttributes<T>, "size">` のように
React の属性をユーティリティ型で包んだだけの props は宣言が `@types/react` のままなので該当しない。
280 個の HTML 属性が流れ込まないのはこのおかげ。

読み直しを衝突した props に限っているのは、props の型解決が TypeScript のリテラル型生成順に影響し、
広げると無関係な部品の `options` の並びまで変わってしまうため。

### `required` の判定

props 型が union の部品では `required` を落とす（決定事項）。

react-docgen-typescript の required 判定は、props 型に union が入った時点で型との対応が取れなくなる。
どちらに転ぶかは props 型の組み立て方次第で、両方向に間違える。

- 必須のプロパティが任意へ格下げされる（検証の取りこぼし）
- 片方の分岐にしか無いプロパティが `required: true` で届く（**正しい画面が
  `MISSING_REQUIRED_PROP` で弾かれる**）

実害が大きいのは後者なので、union の props 型では `required` を一律で落とし、「確実に必須と言えない
限り必須にしない」側へ倒している。取りこぼしは残るが偽陽性は消える。計測対象のホストでは、props 型を
`SingleProps | MultipleProps` とする部品が 1 つ該当した。そこでは、2 つの props から `required` が
落ちている。

### slot の自動発見

`ReactNode` / `ReactElement` を受け取る prop は値ではなく子要素の置き場なので、props から外して
`slots` に載せる。これが名前付き slot の自動発見になる。計測対象のホストでは 7 つの props が slot へ
移った。いずれも `ReactNode` 型の icon・separator・heading・footer・label の各 prop。

### `className` と `children`

どちらも上の React 由来フィルタで落ちるが、その部品の props 型に実際に現れる場合だけ戻す。props を
自前の interface で閉じている部品（`interface Props { date: Date }`）や Fragment を返すだけの部品には
どちらも付かない。`HTMLAttributes` / `ComponentProps<'div'>` を展開している部品、`className` を自分で
宣言している部品、`PropsWithChildren` で包まれている部品には、受け取る方が付く。

既定では足さない。受け取らない props を配る Registry は、黙っている Registry より悪い。Story を書く
拠り所は `component inspect` なので、捏造された prop はそのままホストの `TS2322` になる。計測対象の
ホストでは、268 部品のうち 99 部品が受け取らない `className` / `children` を持っていた。

なお `children` は prop ではなく slot なので、`bindings` の宛先にはできない。

react-docgen-typescript が props を読めない部品では、この 2 つだけを呼び出しシグネチャの第 1 引数から
TypeChecker で直接読む。他が読めなくてもここまでは確定できるため。props 型そのものに辿り着けない場合は
何も足さない。実在する prop を落とす方が、実在しない prop を作るより害が小さい。

### カテゴリとキュレーション

すべての部品が `category` を持つ。`--index` が無い場合は `--project-root` から見たその部品の
ディレクトリ（`app/components/ui`）になる。基準の直下にある部品は `uncategorized` になる。`--index` が
ある場合は index.json の entry を実装ファイル（`componentPath`）単位に畳んで Manifest と突き合わせる。
一致した部品は Story の title の先頭セグメント（`Components`）を代わりに取る。`--metadata` の指定は
どちらにも優先する。

一致した部品には次も付く。

- `references.storybook`: Story へのディープリンク（`--storybook-url` 併用時）
- `curation`: `{ recommended, storyTitle, storyCount, storyFile, storyNames }`

`curation` は `ComponentManifest`（`packages/core/src/domain/component-manifest.ts`）に載る。型から
機械的に作った Registry は存在する export をすべて列挙するので、ホストが使ってほしい部品と内部の実装
詳細が並んでしまう。Story の有無はホストが発する唯一の「これは使ってよい」という信号なので、Manifest
に残している。

Story を持たない部品は `curation.recommended = false` になるが、除外はしない。`CardHeader` のように
自前の Story は無いが組み立てには必要な部品が落ちないのは、このおかげ。

`references.storybook` が指すのは title の *先頭* Story で、多くは `--playground` なので特定の振る舞い
を説明しない。props では答えられない問い（「空状態はどう見えるのか」）を持ったエージェントが開ける
ファイルと探せる Story 名を渡すため、`storyFile` と `storyNames` を残している。index.json に元から
入っている情報なので、追加のコストは無い。

### ホスト側が `inspect` を有用にするためにできること

props の説明は props 型に書かれた JSDoc からしか来ない。次のように書かれた props 型は

```tsx
type DataGridProps = {
	/** 描画する行。1 行 1 オブジェクト。 */
	rows: RowModel<Row>;
};
```

その prop の `description` になる。コメントが無ければ `inspect` が言えるのは `rows: json` だけで、
エージェントは何を渡すべきか推測するしかない。**共有コンポーネントの props に JSDoc を書くことが、
ホストチームがこのワークフローに対してできる最も効果の大きい 1 手**であり、Yosegi 側のコストはゼロ。
コメントは人にとってもホスト自身の IDE にとっても元から有用なもの。

後述のデザインシステムの 1 部品で実測した。props に JSDoc を 8 行足しただけで `component inspect` の
出力は 277 B から 1301 B になった。その出力だけを渡したエージェントの成果物は、壊れた画面
（チェックボックスが無い・レイアウトを崩す inline width・何も効かない値を入れた設定 prop）から
正しい画面へ変わった。2 回の実行の間でコードは何も変えていない。

型情報だけでは *構造的* な誤りしか防げない——prop 名の誤り、enum 値の誤り、関数シグネチャの誤り、必須
prop の欠落。別の比較では、2 つの fixture の部品 API を同一（props と型が同じ）にした上で JSDoc だけ
を変えたところ、Registry ありではどちらも `tsc` エラー 0 件に達した。型だけでコンパイルを通すには十分
だったため。JSDoc を書いた側だけが、コンパイルは通るのに誤っている失敗を避けられた。1 つは
`onRemove: () => void` という prop をトグルの handler であるかのように呼んでしまう誤り。もう 1 つは
excess-property checking をすり抜けて silent な UI バグとしてしか現れない render-callback prop の
誤用。コメントが無い側では、エージェントは「よくある React のパターン」を推測して意味を埋めていた——
その fixture ではたまたま正しかったが、Registry が教えたものではない。これは JSDoc が埋める、型シス
テムでは埋められない隙間であり、`tsc` の集計には決して入らない。

型が言えないことを書く。

| 書くこと | 書かなくてよいこと |
| --- | --- |
| `json` prop が何を期待するか。フィールド単位で、どれが効くか | 型名の言い換え |
| prop を省略したときにコンポーネントが当てる既定値 | 推測に委ねること |
| 呼び出し側の責務。再取得・クローズ・永続化など | `onSave: () => void` だけ |
| 併用できない props、単独では意味を持たない props | 何も書かないこと |

`registry build` はこれがどれだけ書かれているかを測る。サマリは `props` / `documentedProps` /
`opaqueProps`、`undocumentedRequiredOpaqueProps` と
`withUndocumentedRequiredOpaqueProps` を出す。後者 2 つは「必須で、リテラルでは値を書けず、
description も無い」props で、実装をその場で止めるのはこれ。`--report <path>` はそれを 1 件ずつ
名指しする。一覧の形は [`docs/ja/cli.md`](./cli.md#registry-build) を参照。

### 除外

JSDoc に `@yosegi-internal` を持つ export は Registry に入れない。TypeScript がこれをタグ名 `yosegi` と
コメント `-internal` に分割することがあるので、どちらの形も受け付ける。

## 実測結果

`app/components/**/*.tsx`（`*.stories.*` / `*.test.*` を除く）に対して実行した。

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --index http://localhost:6006/index.json \
  --storybook-url http://localhost:6006 \
  --out tmp/registry.json --report tmp/report.json
```

`6006` はこの実行時のホストの Storybook ポートであり、そのままコピーする値ではない。再現する場合は
自分のホストのポートを使う。

| 指標 | 値 |
| --- | --- |
| 走査したファイル | 120 |
| コンポーネントと判定した export | 278 |
| うち props まで型から読めた | 275（98.9%） |
| props を読めなかった | 3 |
| prop を 1 つ以上持つ | 258 |
| 抽出できた enum（union） | 72 |
| 抽出できた ReactNode slot | 7（名前付き slot のみ） |
| 対応する Story を持つ（recommended） | 218 |
| Story を持たない（型からのみ発見可能） | 60 |
| 抽出した props | 1247 |
| うち description を持つ | 293（23.5%） |
| リテラルでは値を書けない props（`json` / `function`） | 479 |
| うち型名だけに縮んでいるもの | 111（signature と union メンバーの追加前は 460） |
| 必須・不透明・description 無し | 75（45 コンポーネント） |
| 所要時間 | 約 3.9〜4.4 秒 |

278 のうち 60 は自前の Story を持たず型からしか辿れない。残りの多くは 1 ファイルが複数の部品を export
しているもので、組み立てに不可欠な部品はそこにいる。

動かす余地があるのは documentation の数値。props の 76.5% は型以上のことを何も言っていない。うち
必須かつ不透明な 75 件は、その沈黙が不便ではなく致命的になる部分で、サマリが名指しで出すのはこれ。

出力は決定的である。同じ入力を 2 回流してバイト単位で同一の結果になることを確認した。`version` の内容
ハッシュも安定している。

HTML 属性との衝突を解決したことで、propFilter に落とされていた 3 部品・4 つの props を回収できた。

| 部品 | prop | 結果 |
| --- | --- | --- |
| 見出しの部品 | `color` | `enum`（7 択） |
| チャートライブラリのラッパー | `height` / `width` | `json` |
| コマンドパレット | `defaultValue` | `json` |

同じ `color` でも、ホストのテキスト部品のものは回収できない。その部品は props をまったく読めないため
（後述のパターン 1）。

規模が大きくなった場合の見通し: 120 ファイルで 4 秒強。大半は `ts.createProgram` の型解決なので、
ファイル数にほぼ比例して伸びると見てよい。CI の毎ジョブで回すには重いが、Registry の作り直しが必要
なのは Story が増えたときと部品が変わったときだけなので、実用上は困らない。

### きれいに抽出できないパターン

**1. オーバーロードされた呼び出しシグネチャ型へのキャスト**

```ts
type TextComponent = {
  (props: ParagraphTextProps & React.RefAttributes<HTMLParagraphElement>): React.ReactElement | null;
  (props: SpanTextProps & React.RefAttributes<HTMLSpanElement>): React.ReactElement | null;
};
const Text = ForwardedText as TextComponent;
```

react-docgen-typescript はこの `Text` をそもそも返さず、`customComponentTypes` を渡しても変わらない。
最小再現ではオーバーロード型へのキャストだけでは再現しないので、実ファイルの型グラフにある別の要因が
引き金になっている。放っておくと、生成された Story でこの部品の variant 系 props が欠ける。

**抽出器側での救済は見送る**（決定事項）。TypeChecker で呼び出しシグネチャの第 1 引数を直接読めば
おそらく動く。ただし react-docgen-typescript の型変換（JSDoc・`defaultValue`・`required` の解決）を
部分的に再実装することになり、抽出経路が 2 本になる。計測対象のホストで影響を受けるのは 3 部品だけで、しかも
TypeChecker で確定できた分の `className` / `children` を持つ Manifest として Registry には載っている。

**2. サードパーティ製部品の再 export**

```ts
const Form = FormProvider;              // フォームライブラリから
const ChartTooltip = Primitive.Tooltip; // チャートライブラリから
```

これらも props を読めない。パターン 1 と合わせて 3 部品。TypeChecker は「呼ぶと React 要素を返す値」と
までは判定できるので、TypeChecker で確定できた分の `className` / `children` を持つ Manifest として
Registry には載る。抽出レポートは `props-unreadable` として記録する。救済を見送る理由はパターン 1 と同じ。

**この 3 部品への対処は `--metadata` で埋めること。** Registry が props を知らないままでは、実在する
prop を Screen JSON に書いた時点で `UNKNOWN_PROP` になり画面を組めない。明示的な metadata は型から得た
props より優先され、こうして埋めた部品は `propsUnreadable` にも `--report` の取りこぼしにも数えられ
ない。`component inspect` は Manifest の `propsFromTypes` を見てその旨を告げるので、埋めるべき候補は
そこから見つかる。

**3. オブジェクト型の union は選択肢を列挙できない**

アイコンのコンポーネント型のように、単一の型名で表された union は `options` に落とせないので
`json` / `editable: false` になる。`shape` がその一部を埋める。メンバーが全てリテラルかプリミティブ
なら `shape.members` に並ぶ（`string | number`、エディタの機能一覧配列の裏にある 15 個の名前など）。
オブジェクト型の union は依然として名前だけになる。分岐ごとに必須フィールドが違うので、共通部分を
並べるとホストの型検査が落とす値を書かせることになるため。

**4. 薄いラッパーはサードパーティの API をそのまま通す**

サードパーティのライブラリを包んだ部品では、包まれた側の props がすべて見える。「この部品の API」と
しては正しいが、API が大きいと Registry が膨らむ。あるチャートライブラリのラッパーは 176 個の props を
返した。278 部品のうち 30 個を超える props を持つのは 3 つだけ。

同じ通し方は、型チェックを通る prop が動作する保証にもならないことを意味する。包んでいる primitive に
`...props` を spread するラッパーは、ラッパー自身の挙動が想定していない prop も primitive が受け付け
る限り通してしまう。一例がメニュー項目の `onClick` handler で、キーボード選択で発火するのは
`onSelect` だけ、という場合。`tsc` にはこの隙間は見えない。prop に description を書くか、包んでいるライブラリ自身
のドキュメントを読むことでしか埋まらない。

## 決定事項

1. **id の正式な形は `モジュールパス#exportName`** であり、`--source` が主経路。`--index` 単独は短い
   id と props 無しになるので、「`--source` と併用するキュレーション用、あるいは `--metadata` の
   手書きを前提とした簡易用途」と位置づける。
2. **union の props 型では `required` を落とす。** 偽陽性（正しい画面を弾く）から遠ざかる側へ倒し、
   取りこぼしは既知の制約として受け入れる。
3. **HTML 属性と衝突する variants ではホスト側の定義を採る。** 判定は `@types/react` の外に宣言を持つ
   かどうかで、読み直すのは衝突した props だけ。
4. **`props-unreadable` な 3 部品は抽出器で救済しない**（見送り）。抽出経路をもう 1 本増やすには影響
   範囲が小さすぎ、Registry には載っている。対処は `--metadata`。
5. **`--project-root` の既定は tsconfig のあるディレクトリ。**
6. **明示的な metadata（`--metadata`）は型から得た props に優先する。** 穴を埋めるために書いた値が、
   不完全な型由来の定義に負けるのでは埋める意味が無い。両経路で効き、どの部品にも当たらなかった id は
   警告として名指しする。黙って捨てると気付く手段が無くなるため。

これらの制約の行き先は[ロードマップ](./ROADMAP.md)で追っている。
