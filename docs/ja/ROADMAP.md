# Yosegi — ロードマップ

[English](../ROADMAP.md) | 日本語

これから手を入れる予定のものと、まだ決めていない論点をまとめます。現時点で何ができるかは
[`README.ja.md`](../../README.ja.md)、Component Registry の仕組みは
[Component Registry](./registry.md) を参照してください。

## 計画中の作業

優先度の順に並べます。他の項目を待つ項目については、その項目の段落に記します。

### 1. `each` のイテレーション変数をスコープする

`each` が宣言するイテレーション変数は、何にも解決されません。自然な書き方
（`each: "customer in customers"` を持つノードで `customer.name` をバインドする）をすると、
正しいリストに対して、対処のしようがない警告が 2 つ返ります。`customer.name` が出所のない名前
として読まれるための `BOUND_REQUIRED_PROP` と、`customers` を参照するものが無いと見なされる
ための `UNUSED_FIXTURE` です。正しい入力に対するノイズは、エージェントが自己修正の拠り所に
する信号にとって最悪の事態なので、これを最優先とします。変数をそのノードのサブツリーで
スコープすれば、どちらも消えます。

### 2. fixture の値を props の kind と突き合わせる

fixtures はバインド先の props と突き合わせて検証されません。数値 kind の props に文字列の
fixture をバインドしても検証は通り、ホストの型チェックで初めて失敗します。fixture の値を
Manifest の props の kind と突き合わせれば、他の形状エラーと同じ場所で捕まえられます。

### 3. Story から利用例を抽出する

Registry が答えるのは「どんな props があるか」であり、それ以外は意図して答えません。
[`workflows.md`](./workflows.md) には、画面の骨格や合成の作法（ラッパー、フックの呼び出し、
ホスト固有の meta）は Registry ではなくホスト自身の Story やテンプレートから得る、と明記して
あります。現在のエージェントは `curation.storyFile` を辿り、Story を自分で読んでいます。

それを短縮する材料はすでに揃っています。Manifest は `storyFile` / `storyNames` を記録しており、
`story import` は Story のソースを TypeScript の AST で既に読んでいます。名指ししたコンポーネント
について Story の `args` と `render` を抽出し、利用例として返すコマンドが、計画している次の一歩に
なります。正直な限界もあります。今のインポータが読めるのは `render` 形式の Story だけです。
そのため、手書きの主流である `component` + `args` 形式は、`--story-name` を渡さなければ
`STORY_NOT_FOUND` になります。渡した場合は `RENDER_NOT_STATIC` です。したがって抽出コマンドは
`args` を自力で読む必要があります。その出力は組み立ての土台になるツリーではなく、読むための
抜粋になります。利用例に必要なのはそこまでです。

### 4. `registry status` を CI のゲートにする

`registry status` は `source: current` / `stale` / `unknown` を報告しますが、テキストとしてのみ
で、パイプラインはパースなしにこれで失敗できません。`--exit-code` フラグ（`stale` なら非ゼロ）が
あれば、古さを CI のゲートにできます。Registry をコミットしておけば、ソースの変更が素通りするのを
このチェックが止めます。

Registry をコミットすることは、provenance の問題も表面化させます。`builtWithCliPath` は実行中の
プロセスから取った絶対パスであり、記録される `inputs` はフラグを入力されたまま、絶対パスも
含めて保持します。マシンをまたいで共有すると、どちらもノイズになります。マシンローカルな項目と
共有可能な項目を分けるか、パスをプロジェクトルートからの相対で記録することが、コミットされた
Registry を正とみなすための前提条件になります。

### 5. キュレーションを既定の並び順に適用する

`curation.recommended` は今のところ「Story があるか」だけを見ています。Registry には Story を
持たないコンポーネントも多く載るため、エージェントがどこまでそれらを使ってよいかの方針が要り
ます。`component list` の既定の並び順・フィルタに使うのが素直な線です。

設計で織り込むべき制約があります。コンポーネントごとに `recommended` を決めるのは `--source` の
Registry だけです。`index.json` だけで作った Registry は、index に載るものが構造上すべて Story を
持つため、全件に `true` を付けます。この経路ではこの項目は定数になり、並び順を与えません。

### 6. 型抽出を差し替え可能なインターフェースの背後に置く

`className` / `children` しか取れないコンポーネントが 2 種あります。オーバーロードした呼び出し
シグネチャ型へのキャストと、サードパーティコンポーネントの再 export。TypeChecker で呼び出し
シグネチャの第 1 引数を直読みすれば取れる見込みがあります。

当初の計画はこの直読みを react-docgen-typescript と並走させるもので、その代償はずっと変わりま
せんでした。型変換（JSDoc・`defaultValue`・`required` の解決）を部分的に再実装することになり、
食い違いうる抽出経路が 2 本になります。改めた方針は、抽出そのものを差し替え可能にすることです。
`registry build --source` が依存するインターフェースを定め、react-docgen-typescript を既定の
実装、TypeChecker の直読みをもう 1 つの実装とします。答えを持つ実装は常に 1 つなので、食い違いの
問題は「欠けたところだけを埋める」という規則を必要とせず、構造的に解消します。

union の props 型でも `required` を使えるようにすることは、同じ作業に属します。現在、props 型が
union のコンポーネントでは `required` を一律に落としています。react-docgen-typescript の判定が
その条件下で信用できず、偽陽性が出ると正しい画面が弾かれるためです。union を解決し、すべての
分岐で必須の props だけを required とする処理は、同じ TypeChecker の直読みを必要とし、同じ関数
群に手を入れます。したがって別個の判断にはなりません。

このインターフェースはエコシステムに対する保険でもあり、そのことが、価値の順では中位にある
この項目を、ここで最も緊急なものにしています。react-docgen-typescript の動きは止まっています。
最後のリリースは 2025 年 6 月の 2.4.0 で、default branch にもそれ以降のコミットが無く、
TypeScript 7 でクラッシュするという報告（issue #538）は open のままです。Storybook は置き換えを
進めており、React Component Meta は Storybook 10.5 で `experimentalDocgenServer` として Manifest
生成に組み込まれました。Storybook は、安定化した後に MCP と Docs の両方でこれに標準化すると
表明しています。ただし単体の npm パッケージは公開されていないため、現時点で依存できるものでは
ありません。抽出器を差し替え可能にしておけば、どれを採るとしても作り直しは避けられます。
それまでの回避策は変わらず `--metadata` による補完で、対象は `component inspect` から辿れます。

### 7. コンポーネントターゲットを読み戻す

`story import` が読むのは Story だけなので、`screen generate --target component` が書いたファイル
を Screen JSON へ読み戻すことはできません。この非対称と回避策（画面を後で直す可能性があるなら
Screen JSON を残す）は [`workflows.md`](./workflows.md) に明記してあります。インポータは既に 2 つ
の部分から成ります。CSF 固有の前半（meta を見つけ、Story の export を選ぶ）と、汎用の JSX →
ScreenNode 変換です。したがって、この穴を塞ぐのは前半のコンポーネントファイル変種です。export
された関数を見つけ、その返す JSX を同じ変換に渡します。それまで、この非対称は解消されず文書化
されたままです。

### 8. 画面の差分は何を比較するのか

承認済みのモックと、そこから作った実装は、静かに乖離していきます。構造の差分（承認済みの
Screen JSON と現在のツリーを並べる）があれば、何が変わったか（ノードの削除、props の変更）を
レビュー任せにせず名指しできます。未解決なのは右辺です。実装は Story の形をしていないため、
何を通して読み戻すか（上のコンポーネントターゲットのインポータが出来たとすればそれか）が、
差分がそもそも可能かを決めます。

### 9. 保存済み画面の移行戦略

`<data-dir>/screens/` に保存した画面は、その下で動きうる 2 つのものに固定されています。保存済み
画面に残す価値のあるものが入る前に、どちらにも答えが要ります。

1 つ目はコンポーネント id です。`--source` で作った Registry は `<モジュールパス>#<exportName>`、
`--index` 単独で作った Registry は短い id（`Button`）を使います。両者は互換ではないので、一方で
保存した画面をもう一方で検証し直すことはできません。移行や alias の仕組みは、現在は存在しません。

2 つ目は `schemaVersion` です。パーサはこれをハードなリテラル（`z.literal("1.0")`）として扱い、
古い文書を受理して昇格させる分岐を持ちません。したがってバージョンを上げれば、保存済み画面と
手書きの Screen JSON がすべて `INVALID_REQUEST` で弾かれます。1.0 以前のバージョニングはその
破壊的変更を許容しており、だからこそ、それを取り込むリリースは片方ではなく 2 軸にまたがる移行の
道筋を必要とします。

### 10. 出力の形をどこまで広げるか

ファイルの形は決まりました。1 つのモジュールが画面状態ごとに 1 つの export を運びます。CSF ター
ゲットでは Story の export、コンポーネントターゲット（`screen generate --target component`。
Storybook を持たないホスト向け）では export された関数になります。どちらのターゲットも、共有の
レンダラ（`render.ts`）を通じて、どの状態も同じツリーとその差分から描画します。

残る論点はコンポーネント境界です。Screen JSON には「ここが再利用単位」という情報が無いため、
コンポーネントターゲットは、すべてのモック値を内部に持ち props を切り出さない、自己完結した
コンポーネント 1 つを書き出します。

- さらに進める利点: props の切り出し（どこを外から渡すか）を表現できれば、生成物をそのままアプリの
  コードに移せます。コンポーネントを表示する薄い Story は、ホストの他の Story と同じ形になります。
- 論点: どこを境界にするか。ファイルを 2 つ出すとホストの配置規約に踏み込む度合いも上がります。
- Screen JSON 側に境界の表現が入るまでは、props を切り出さない 1 ファイルを既定とします。

### 11. リビルドした index に Story が現れることを確認する

`screen generate` はファイルで終わります。その Story がホストの Storybook に載ったかどうか（title
が解決する、import がビルドを通る、描画時に何も投げない）を、現在はホストの型チェックと人の目で
確かめています。機械による確認の 1 段目は安価です。材料が既にあるからです。CLI は `index.json` を
パスからでも起動中の開発サーバの URL からでも読めますし、`registry status` はその index の鮮度を
既に扱っています。生成した Story がリビルドした index に現れるかの確認は、その両方を再利用します。
その上の段は非目標です。後述します。

## ランタイムとパッケージング

### コンパイラ API が届かない間は TypeScript 6.x に留まる

`typescript` の `<7` は意図的な上限です。TypeScript 7.0 は 2026-07-08 に GA となり npm の
`latest` でもあるため、新規のホストは既定でこれを踏みます。そしてコンパイラ API を同梱しておらず、
`require("typescript")` は `{ version, versionMajorMinor }` しか返しません。`source-registry.ts`
と `react-docgen-typescript` はどちらも 6.x の API の上に成り立っています。7 のホストは互換
パッケージ経由でその API を保てます。導入手順は [`registry.md`](./registry.md) に記載しています。

後継の API は `typescript/unstable/*` として公開されています（`Program` / `Checker` は
`unstable/sync`、ノード操作は `unstable/ast`）。7.1 の Iteration Plan は
microsoft/TypeScript#63703 にあります（Beta 2026-09-09、RC 2026-10-20、Stable 2026-11-10）。
そこで安定化の対象として挙がるのは Content Mapper・Emit・Language Service の 3 つです。Yosegi と
react-docgen-typescript が実際に必要とする `Program` / `Checker` は含まれていません。したがって
7.1 は上限が外れる期日ではなく、再評価のきっかけとなる日付です。

Language Service が先に安定するという事実自体が、上の抽出インターフェースの論拠になります。
それを土台にした実装のほうが、Checker を土台にしたものより早く手が届きます。

### `@yosegi/core` とファイルシステム

`packages/core` を `node:fs` に縛っているのは `FileScreenRepository` だけです。これを
`@yosegi/core/node` サブパスへ分離すれば、core 本体をブラウザや Workers 環境でも使えるように
なります。これを待っている consumer はいません。したがって今すぐ計画する作業ではありません。
HTTP のアプリを組み込む使い方がサポート対象となった段階で再訪する、パッケージングの論点として
扱います。

## 検討中の論点

### HTTP アダプタは何のためにあるのか

アダプタの機能は不揃いというより入れ子です。CLI ⊃ MCP ⊃ HTTP。MCP に無いものは決着しています。
Registry の生成、metadata の雛形出し、Story の読み戻し、`registry status` のソースドリフト再計算の
半分は、仕様として CLI 専用です。Skill の CLI リファレンスにもその旨を記載しています。HTTP の差は
もっと大きくなります。公開しているのは health・registry・components・screens・operations・
duplicate・validate・implementation context です。生成系のエンドポイントは 1 つもありません。

論点はその差をどう埋めるかではなく、埋めるかどうかです。HTTP アダプタには文書化された consumer が
無い一方で、`hono` は全ユーザーが install する必須依存です。この依存に見合う使い道を得るか、
公開する範囲から外すかのどちらかです。

## 非目標

### デザイントークンを Registry に載せること

`className` は自由記述のままとします。どんな文字列でも検証を通り、ホストの CSS が定義しない
トークンはレビューまで静かに抜けます。ホストのトークンを Registry へ抽出すれば、enum の props が
既にそうであるのと同じやり方で検証可能にできますが、トークンには単一のソースがありません。
Tailwind の設定、CSS 変数、CSS-in-JS のテーマと分かれるため、Registry はホストの CSS 方言へ依存を
持ち込むことになります。これはホストの TypeScript を読むよりはるかに大きなコミットであり、
この論点は開いたままにするのではなく決着したものとします。

### スクリーンショットや a11y のチェックを仲介すること

生成した Story をホスト自身の Storybook（そのテストランナー、そのアドオン）に通し、
スクリーンショットや a11y の結果を受け取ることは、Yosegi では行いません。仲介はレンダリング環境を
所有することではありませんが、ホストのブラウザスタックを Yosegi のクリティカルパスに載せます。
出発点の線引きは、まさにそれを避けるために引かれています。機械による確認は項目 11 の index の
チェックまでとします。
