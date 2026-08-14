# Yosegi — ロードマップ

[English](../ROADMAP.md) | 日本語

これから手を入れる予定のものと、まだ決めていない論点をまとめます。現時点で何ができるかは
[`README.ja.md`](../../README.ja.md)、Component Registry の仕組みは
[Component Registry](./registry.md) を参照してください。

## Registry の抽出

### 型抽出を差し替え可能なインターフェースの背後に置く

`className` / `children` しか取れないコンポーネントが 2 種あります。オーバーロードした呼び出し
シグネチャ型へのキャストと、サードパーティコンポーネントの再 export。TypeChecker で呼び出し
シグネチャの第 1 引数を直読みすれば取れる見込みがあります。

当初の計画はこの直読みを react-docgen-typescript と並走させるもので、その代償はずっと変わりま
せんでした。型変換（JSDoc・`defaultValue`・`required` の解決）を部分的に再実装することになり、
食い違いうる抽出経路が 2 本になります。改めた方針は、抽出そのものを差し替え可能にすることです。
`registry build --source` が依存するインターフェースを定め、react-docgen-typescript を既定の
実装、TypeChecker の直読みをもう 1 つの実装とします。答えを持つ実装は常に 1 つなので、食い違いの
問題は「欠けたところだけを埋める」という規則を必要とせず、構造的に解消します。

このインターフェースはエコシステムに対する保険でもあります。react-docgen-typescript の動きは
止まっています（執筆時点で最後のリリースは 2025 年半ば）。TypeScript 7.1 の後継コンパイラ API は
いまだ `typescript/unstable/*` としての公開に留まります。そして Storybook は自前の docgen を
Volar / 言語サーバベースの実装（React Component Meta。Storybook 10.4 時点で実験的機能）へ
置き換えようとしているように見えます。どれが先に定まるかは Yosegi の制御下にありません。抽出器を
差し替え可能にしておけば、どれを採るとしても作り直しは避けられます。
それまでの回避策は変わらず `--metadata` による補完で、対象は `component inspect` から辿れます。

### union の props 型でも required を使えるようにする

現在、props 型が union のコンポーネントでは `required` を一律に落としています。
react-docgen-typescript の判定がその条件下で信用できず、偽陽性が出ると正しい画面が弾かれるため
です。TypeChecker で union を解決し、すべての分岐で必須の props だけを required とすれば、
偽陽性を戻さずに取りこぼしを回収できます。

### Story から利用例を抽出する

Registry が答えるのは「どんな props があるか」であり、それ以外は意図して答えません。
[`workflows.md`](./workflows.md) には、画面の骨格や合成の作法（ラッパー、フックの呼び出し、
ホスト固有の meta）は Registry ではなくホスト自身の Story やテンプレートから得る、と明記して
あります。現在のエージェントは `curation.storyFile` を辿り、Story を自分で読んでいます。

それを短縮する材料はすでに揃っています。Manifest は `storyFile` / `storyNames` を記録しており、
`story import` は Story のソースを TypeScript の AST で既に読んでいます。名指ししたコンポーネント
について Story の `args` と `render` を抽出し、利用例として返すコマンドが、計画している次の一歩に
なります。正直な限界もあります。今のインポータが読めるのは `render` 形式の Story だけで、手書きの
主流である `component` + `args` 形式は `STORY_NOT_FOUND` になります。だから抽出コマンドは `args`
を自力で読む必要があり、その出力は組み立ての土台になるツリーではなく、読むための抜粋になります。
利用例に必要なのはそこまでです。

## Registry の運用

### `registry status` を CI のゲートにする

`registry status` は `source: current` / `stale` / `unknown` を報告しますが、テキストとしてのみ
で、パイプラインはパースなしにこれで失敗できません。`--exit-code` フラグ（`stale` なら非ゼロ）が
あれば、古さを CI のゲートにできます。Registry をコミットしておけば、ソースの変更が素通りするのを
このチェックが止めます。

Registry をコミットすることは、provenance の問題も表面化させます。`builtWithCliPath` は実行中の
プロセスから取った絶対パスであり、記録される `inputs` はフラグを入力されたまま、絶対パスも
含めて保持します。マシンをまたいで共有すると、どちらもノイズになります。マシンローカルな項目と
共有可能な項目を分けるか、パスをプロジェクトルートからの相対で記録することが、コミットされた
Registry を正とみなすための前提条件になります。

## ランタイムとパッケージング

### `@yosegi/core` をファイルシステムから切り離す

`packages/core` を `node:fs` に縛っているのは `FileScreenRepository` だけです。これを
`@yosegi/core/node` サブパスへ分離すれば、core 本体をブラウザや Workers 環境でも使えるように
なります。

### 7.1 が API を出すまで TypeScript 6.x に留まる

`typescript` の `<7` は意図的な上限です。TypeScript 7.0 はコンパイラ API を同梱しておらず、
`require("typescript")` は `{ version, versionMajorMinor }` しか返しません。`source-registry.ts`
と `react-docgen-typescript` はどちらも 6.x の API の上に成り立っています。7 のホストは互換
パッケージ経由でその API を保てます。導入手順は [`registry.md`](./registry.md) に記載しています。

7.1 で新しい別の API が入る見込みで、現在は `typescript/unstable/*` として公開されています
（`Program` / `Checker` は `unstable/sync`、ノード操作は `unstable/ast`）。移行には、まだ満たされて
いない条件が 2 つ要ります。API が `unstable` を外れることと、`react-docgen-typescript` が 7 に対応
すること（または上の抽出インターフェースの背後で置き換えられること）。それまで上限は維持し、
広げるのは改善ではなく退行になります。

## Story の往復

### コンポーネントターゲットを読み戻す

`story import` が読むのは Story だけなので、`screen generate --target component` が書いたファイル
を Screen JSON へ読み戻すことはできません。この非対称と回避策（画面を後で直す可能性があるなら
Screen JSON を残す）は [`workflows.md`](./workflows.md) に明記してあります。インポータは既に 2 つ
の部分から成ります。CSF 固有の前半（meta を見つけ、Story の export を選ぶ）と、汎用の JSX →
ScreenNode 変換です。したがって、この穴を塞ぐのは前半のコンポーネントファイル変種です。export
された関数を見つけ、その返す JSX を同じ変換に渡します。それまで、この非対称は解消されず文書化
されたままです。

### fixtures・variants・`each` に残る小さな拡張

最初のバージョンでは、3 つの拡張を意図して外しました。

- fixtures はバインド先の props と突き合わせて検証されません。数値 kind の props に文字列の
  fixture をバインドしても検証は通り、ホストの型チェックで初めて失敗します。fixture の値を
  Manifest の props の kind と突き合わせれば、他の形状エラーと同じ場所で捕まえられます。
- variant はベースの Story の meta を丸ごと共有します。variant ごとの `parameters` / `tags` が
  あれば、ローディング状態だけ a11y チェックから外す、空状態にテストランナー用のタグを付ける、
  といったことを Screen JSON から出ずに行えます。
- `each` が宣言するイテレーション変数は何にも解決されません。`each: "customer in customers"`
  では、`customer.name` へのバインディングは `customers` fixture に裏付けられたものと認識されず、
  出所のない名前であるかのように警告されます。変数をそのノードのサブツリーでスコープすれば、
  リストの自然な書き方がそのまま検証を通ります。

## アダプタ間の機能差

読み取り側はおおむね揃いました。`list_categories` と `get_registry_status` は MCP ツールになり
ました。ただし `get_registry_status` が報告するのは provenance のみで、ソースのドリフトの再計算は
CLI の役割のままです。CLI 専用として残るのは `registry build --source` と `story import` で、MCP で
作業するエージェントは Registry の生成と Story の読み戻しでは依然 CLI へ降ります。この 2 つを
MCP / HTTP へ持ち込むか、CLI 専用を仕様として明示するかのどちらかです。現状は後者（Skill に明記）
で運用できてはいますが、アダプタの機能が揃わないままではあります。

## 検討中の論点

### 出力の形をどこまで広げるか

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

### キュレーションの使い方

`curation.recommended` は今のところ「Story があるか」だけを見ています。Registry には Story を
持たないコンポーネントも多く載るため、エージェントがどこまでそれらを使ってよいかの方針が要り
ます。`component list` の既定の並び順・フィルタに使うのが素直な線です。

### 保存済み画面の id 移行

`<data-dir>/screens/` に保存した画面は、書いた時点のコンポーネント id を持ちます。`--source` で
作った Registry は `<モジュールパス>#<exportName>`、`--index` 単独で作った Registry は短い id
（`Button`）を使います。両者は互換ではないので、一方で保存した画面をもう一方で検証し直すことは
できません。移行や alias の仕組みは、現在は存在しません。保存済み画面に残す価値のあるものが入る
前に、移行処理か id の alias を決める必要があります。

### Story が実際に表示されることを Yosegi が確認すべきか

`screen generate` はファイルで終わります。その Story がホストの Storybook に載ったかどうか（title
が解決する、import がビルドを通る、描画時に何も投げない）を、現在はホストの型チェックと人の目で
確かめています。機械による確認には分かりやすい 1 段目があります。リビルドした `index.json` にその
Story が現れることです。2 段目は一気に急になります。スクリーンショットや a11y のチェックを、ホスト
自身の Storybook（そのテストランナー、そのアドオン）を経由して仲介することになります。この 2 段目
が「Yosegi は自前のレンダリング環境を持たない」という出発点の線引きを圧迫します。仲介は所有では
ありませんが、作り始める前に境界を引いておく必要があります。

### 画面の差分は何を比較するのか

承認済みのモックと、そこから作った実装は、静かに乖離していきます。構造の差分（承認済みの
Screen JSON と現在のツリーを並べる）があれば、何が変わったか（ノードの削除、props の変更）を
レビュー任せにせず名指しできます。未解決なのは右辺です。実装は Story の形をしていないため、
何を通して読み戻すか（上のコンポーネントターゲットのインポータが出来たとすればそれか）が、
差分がそもそも可能かを決めます。

### デザイントークンを Registry に載せるべきか

現在の `className` は自由記述で、どんな文字列でも検証を通り、ホストの CSS が定義しないトークンは
レビューまで静かに抜けます。ホストのトークンを Registry へ抽出すれば、enum の props が既にそうで
あるのと同じやり方で `className` を検証可能にできます。引っかかるのは、トークンに単一のソースが
無いことです。Tailwind の設定、CSS 変数、CSS-in-JS のテーマと分かれるため、Registry はホストの
CSS 方言へ依存を持ち込むことになります。これはホストの TypeScript を読むより大きなコミットです。
