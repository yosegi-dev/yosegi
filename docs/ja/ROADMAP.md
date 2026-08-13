# Yosegi — ロードマップ

[English](../ROADMAP.md) | 日本語

これから手を入れる予定のものと、まだ決めていない論点をまとめる。現時点で何ができるかは
[`README.ja.md`](../../README.ja.md)、Component Registry の仕組みは
[Component Registry](./registry.md) を参照。

## Registry の抽出

### 型から読めていない props を救済する

`className` / `children` しか取れないコンポーネントが 2 種ある。オーバーロードした呼び出し
シグネチャ型へのキャストと、サードパーティコンポーネントの再 export。TypeChecker で呼び出し
シグネチャの第 1 引数を直読みすれば取れる見込みがある。

代償は react-docgen-typescript の型変換（JSDoc・`defaultValue`・`required` の解決）を部分的に
再実装することで、食い違いうる抽出経路が 2 本になる。したがって、直読みが並列の抽出器としてではなく
「欠けたところだけを埋める」形に収まる設計であることを条件にする。それまでの回避策は `--metadata`
による補完で、対象は `component inspect` から辿れる。

### union の props 型でも required を使えるようにする

現在、props 型が union のコンポーネントでは `required` を一律に落としている。
react-docgen-typescript の判定がその条件下で信用できず、偽陽性が出ると正しい画面が弾かれるため。
TypeChecker で union を解決し、すべての分岐で必須の props だけを required とすれば、
偽陽性を戻さずに取りこぼしを回収できる。

## ランタイムとパッケージング

### `@yosegi/core` をファイルシステムから切り離す

`packages/core` を `node:fs` に縛っているのは `FileScreenRepository` だけ。これを
`@yosegi/core/node` サブパスへ分離すれば、core 本体をブラウザや Workers 環境でも使えるようになる。

### 7.1 が API を出すまで TypeScript 6.x に留まる

`typescript` の `<7` は意図的な上限。TypeScript 7.0 はコンパイラ API を同梱しておらず、
`require("typescript")` は `{ version, versionMajorMinor }` しか返さない。`source-registry.ts` と
`react-docgen-typescript` はどちらも 6.x の API の上に成り立っている。7 のホストは互換パッケージ
経由でその API を保てる。導入手順は [`registry.md`](./registry.md) に記載。

7.1 で新しい別の API が入る見込みで、現在は `typescript/unstable/*` として公開されている（`Program`
/ `Checker` は `unstable/sync`、ノード操作は `unstable/ast`）。移行には 2 つの条件が要る。API が
`unstable` を外れることと、`react-docgen-typescript` が 7 に対応すること。後者は上の抽出救済で置き換
える案とも繋がる。それまで上限は維持し、広げるのは改善ではなく退行になる。

## アダプタ間の機能差

`registry build --source` と `story import` は CLI にしか無く、MCP から使うエージェントは
Registry の生成と Story の読み戻しだけ CLI へ降りることになる。MCP / HTTP へ寄せるか、CLI 専用を
仕様として明示するかのどちらか。現状は後者（Skill に明記）で運用できてはいるが、
アダプタの機能が揃わないままではある。

## 検討中の論点

### 出力の形をどこまで広げるか

ファイルの形は決まった。1 つのモジュールが画面状態ごとに 1 つの export を運ぶ。CSF ターゲットでは
Story の export、コンポーネントターゲット（`screen generate --target component`。Storybook を
持たないホストをカバーする）では export された関数になる。どちらのターゲットも、共有のレンダラ
（`render.ts`）を通じて、どの状態も同じツリーとその差分から描画する。

残る論点はコンポーネント境界である。Screen JSON には「ここが再利用単位」という情報が無いため、
コンポーネントターゲットは、すべてのモック値を内部に持ち props を切り出さない、自己完結した
コンポーネント 1 つを書き出す。

- さらに進める利点: props の切り出し（どこを外から渡すか）を表現できれば、生成物をそのままアプリの
  コードに移せる。コンポーネントを表示する薄い Story は、ホストの他の Story と同じ形になる。
- 論点: どこを境界にするか。ファイルを 2 つ出すとホストの配置規約に踏み込む度合いも上がる。
- Screen JSON 側に境界の表現が入るまでは、props を切り出さない 1 ファイルを既定とする。

### キュレーションの使い方

`curation.recommended` は今のところ「Story があるか」だけを見ている。Registry には Story を持たない
コンポーネントも多く載るため、エージェントがどこまでそれらを使ってよいかの方針が要る。
`component list` の既定の並び順・フィルタに使うのが素直な線。

### 保存済み画面の id 移行

`<data-dir>/screens/` に保存した画面は、書いた時点のコンポーネント id を持つ。`--source` で作った
Registry は `<モジュールパス>#<exportName>`、`--index` 単独で作った Registry は短い id（`Button`）を
使う。両者は互換ではないので、一方で保存した画面をもう一方で検証し直すことはできない。移行や alias
の仕組みは、現在は存在しない。保存済み画面に残す価値のあるものが入る前に、移行処理か id の alias を
決める必要がある。
