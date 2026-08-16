# Yosegi — ロードマップ

[English](../ROADMAP.md) | 日本語

これから手を入れる予定のものと、まだ決めていない論点をまとめます。
現時点で何ができるかは [`README.ja.md`](../../README.ja.md)、Component Registry の仕組みは [Component Registry](./registry.md) を参照してください。

## 計画中の作業

優先度の順に並べます。
他の項目を待つ項目については、その項目の段落に記します。

### 1. `each` のイテレーション変数をスコープする

`each` が宣言するイテレーション変数は、何にも解決されません。
自然な書き方（`each: "customer in customers"` を持つノードで `customer.name` をバインドする）をすると、正しいリストに対して、対処のしようがない警告が 2 つ返ります。`customer.name` が出所のない名前として読まれるための `BOUND_REQUIRED_PROP` と、`customers` を参照するものが無いと見なされるための `UNUSED_FIXTURE` です。
正しい入力に対するノイズは、エージェントが自己修正の拠り所にする信号にとって最悪の事態なので、これを最優先とします。
変数をそのノードのサブツリーでスコープすれば、どちらも消えます。

### 2. fixture の値を props の kind と突き合わせる

fixtures はバインド先の props と突き合わせて検証されません。
数値 kind の props に文字列の fixture をバインドしても検証は通り、ホストの型チェックで初めて失敗します。fixture の値を Manifest の props の kind と突き合わせれば、他の形状エラーと同じ場所で捕まえられます。

### 3. Story から利用例を抽出する

Registry が答えるのは「どんな props があるか」であり、それ以外は意図して答えません。[`workflows.md`](./workflows.md) には、画面の骨格や合成の作法（ラッパー、フックの呼び出し、ホスト固有の meta）は Registry ではなくホスト自身の Story やテンプレートから得る、と明記してあります。
現在のエージェントは `curation.storyFile` を辿り、Story を自分で読んでいます。

それを短縮する材料はすでに揃っています。Manifest は `storyFile` / `storyNames` を記録しており、`story import` は Story のソースを TypeScript の AST で既に読んでいます。
名指ししたコンポーネントについて Story の `args` と `render` を抽出し、利用例として返すコマンドが、計画している次の一歩になります。
正直な限界もあります。
今のインポータが読めるのは `render` 形式の Story だけです。
そのため、手書きの主流である `component` + `args` 形式は、`--story-name` を渡さなければ `STORY_NOT_FOUND` になります。
渡した場合は `RENDER_NOT_STATIC` です。
したがって抽出コマンドは `args` を自力で読む必要があります。
その出力は組み立ての土台になるツリーではなく、読むための抜粋になります。
利用例に必要なのはそこまでです。

### 4. Storybook の Component Manifest を第 3 の入力にする

Storybook 10.5 の `storybook build` は Component Manifest（`/manifests/components.json`）を書き出します。
ここにはコンポーネントごとに `import` 文・`jsDocTags`・`subcomponents` が入り、Story ごとに id・名前・ソースの `snippet` が入ります。
これを `--index` と `--source` に並ぶ `registry build` の第 3 の入力として受け取れば、Yosegi が Story を自分でパースすることなく Registry に利用例を持ち込めます。Yosegi が Storybook を補完するという主張も、文章ではなく実装で裏付けられます。

設計の中心は、何が得られるかではなく、どう組み込むかです。Storybook は、preview の間この Manifest スキーマが public API ではないと明言しています。
したがって採用の条件は、opt-in のフラグ、Manifest のバージョンの明示的なチェック、そして形が想定と違ったときに `index.json` だけで得られるもの（キュレーションのみ）へ落とすフォールバックです。
この層が無ければ、Storybook のリリースが Yosegi の Registry の出力を動かします。

これは項目 3 を置き換えるのではなく、並び立ちます。Manifest が使えるホストでは項目 3 の大半が不要になり、使えないホスト（古い Storybook、または Manifest を無効にした場合）では項目 3 の自前の抽出が残ります。

### 5. ホストの設定ファイル（`yosegi.config.json`）

ホストが Yosegi に伝えることはすべて CLI のフラグです（`--source`・`--tsconfig`・`--data-dir`・`--metadata`・`--import-map`・`--meta-template`）。
そしてそれらの置き場がどこにも無いため、どのコマンドでも同じ一式を並べ直すことになります。Skill は番号付きの手順の 1 つを「いま `--data-dir` を決めて、すべてのコマンドに同じものを渡す」ことに割いています。
既定値が cwd に追従するからです。
この注意書きは症状であり、問題は設定を置く場所そのものが無いことです。

計画しているのは `yosegi.config.json` 1 つで、cwd から上へ辿って発見します。
そこに書いたパスは cwd ではなく config 自身の位置を基準に解決するため、cwd への依存は注意喚起ではなく構造として消えます。
優先順位は CLI のフラグ > config > 既定値なので、現在動いている呼び出しはそのまま動き続けます。

持たせるセクションは `dataDir`・`registry`（`source`・`tsconfig`・`metadata`）・`emit`（`importMap`・`metaTemplate`）・`examples` です。`examples` は次の項目のカタログの置き場になります。
宣言用のファイルをもう 1 つ増やせば、ホストは再び 2 つのものを揃えて保つことになるからです。
形式は JSON であり、エディタの補完は `$schema` を配布する以上のものを必要としません。

### 6. Example テンプレートのカタログ化と複製

ホストが書き上げた画面は、次の画面の出発点として最良のものです。
そしてエージェントがそこから始める手立ては、現在ありません。
計画しているのは、ホスト自身が書いたテンプレートのカタログと、shadcn と同じ意味での複製（copy-and-own）です。
テンプレートは実際にレンダリングできる TSX であり、状態管理やテーブルのロジックまで含みます。
`example list` がカタログを提示し、`example apply` がテンプレートを新しい画面の置き場所へコピーし、コンポーネントの識別子を置き換え、出所を示すコメントを残します。

カタログはホストが書く宣言で、上の設定ファイルの `examples` セクションに置きます。
1 件ごとに key・label・description・`templatePath`・`componentName` を持ちます。
title の namespace（`Examples/*`）に置いた Story がプレビューを兼ねるため、キュレーションが既に読んでいる `storyFile` を通じて機械的に検出する余地も残ります。

これが効くのは、構築による正しさです。
新しい画面の骨格・状態管理・デザインシステムの慣用は、ゼロから生成されるのではなく、レビュー済みのコードから受け継がれます。
そのためエージェントの作業は差分に留まり、レビューも差分だけを読めば済みます。
これは、検証による正しさという反対側を担う項目 1・2 と対をなします。

基材は Screen JSON ではなく実ファイルであり、これは意図した選択です。
テンプレートの価値の多くは、Screen JSON が意図して表現しないもの（状態、ロジック、イベントの配線）にあります。
Screen JSON は、機械で検証できる静的なモックという役割のままです。
プレビューはホストの Storybook が担うため、出発点の線引きは保たれます。
Yosegi は依然として自前のレンダリング環境を持ちません。

先行するホストが、手書きのテンプレートと自作の複製スクリプトでこの流れを既に実証しています。
その一般化がこの項目であり、PoC を進めています。

### 7. `registry status` を CI のゲートにする

`registry status` は `source: current` / `stale` / `unknown` を報告しますが、テキストとしてのみで、パイプラインはパースなしにこれで失敗できません。`--exit-code` フラグ（`stale` なら非ゼロ）があれば、古さを CI のゲートにできます。Registry をコミットしておけば、ソースの変更が素通りするのをこのチェックが止めます。

Registry をコミットすることは、provenance の問題も表面化させます。`builtWithCliPath` は実行中のプロセスから取った絶対パスであり、記録される `inputs` はフラグを入力されたまま、絶対パスも含めて保持します。
マシンをまたいで共有すると、どちらもノイズになります。
マシンローカルな項目と共有可能な項目を分けるか、パスをプロジェクトルートからの相対で記録することが、コミットされた Registry を正とみなすための前提条件になります。

### 8. キュレーションを既定の並び順に適用する

`curation.recommended` は今のところ「Story があるか」だけを見ています。Registry には Story を持たないコンポーネントも多く載るため、エージェントがどこまでそれらを使ってよいかの方針が要ります。`component list` の既定の並び順・フィルタに使うのが素直な線です。

設計で織り込むべき制約があります。
コンポーネントごとに `recommended` を決めるのは `--source` の Registry だけです。`index.json` だけで作った Registry は、index に載るものが構造上すべて Story を持つため、全件に `true` を付けます。
この経路ではこの項目は定数になり、並び順を与えません。

### 9. 型抽出を差し替え可能なインターフェースの背後に置く

`className` / `children` しか取れないコンポーネントが 2 種あります。
オーバーロードした呼び出しシグネチャ型へのキャストと、サードパーティコンポーネントの再 export。TypeChecker で呼び出しシグネチャの第 1 引数を直読みすれば取れる見込みがあります。

当初の計画はこの直読みを react-docgen-typescript と並走させるもので、その代償はずっと変わりませんでした。
型変換（JSDoc・`defaultValue`・`required` の解決）を部分的に再実装することになり、食い違いうる抽出経路が 2 本になります。
改めた方針は、抽出そのものを差し替え可能にすることです。`registry build --source` が依存するインターフェースを定め、react-docgen-typescript を既定の実装、TypeChecker の直読みをもう 1 つの実装とします。
答えを持つ実装は常に 1 つなので、食い違いの問題は「欠けたところだけを埋める」という規則を必要とせず、構造的に解消します。

union の props 型でも `required` を使えるようにすることは、同じ作業に属します。
現在、props 型が union のコンポーネントでは `required` を一律に落としています。react-docgen-typescript の判定がその条件下で信用できず、偽陽性が出ると正しい画面が弾かれるためです。union を解決し、すべての分岐で必須の props だけを required とする処理は、同じ TypeChecker の直読みを必要とし、同じ関数群に手を入れます。
したがって別個の判断にはなりません。

このインターフェースはエコシステムに対する保険でもあり、そのことが、価値の順では中位にあるこの項目を、ここで最も緊急なものにしています。react-docgen-typescript の動きは止まっています。
最後のリリースは 2025 年 6 月の 2.4.0 で、default branch にもそれ以降のコミットが無く、TypeScript 7 でクラッシュするという報告（issue #538）は open のままです。Storybook は置き換えを進めており、React Component Meta は Storybook 10.5 で `experimentalDocgenServer` として Manifest 生成に組み込まれました。Storybook は、安定化した後に MCP と Docs の両方でこれに標準化すると表明しています。
ただし単体の npm パッケージは公開されていないため、現時点で依存できるものではありません。
抽出器を差し替え可能にしておけば、どれを採るとしても作り直しは避けられます。
それまでの回避策は変わらず `--metadata` による補完で、対象は `component inspect` から辿れます。

### 10. コンポーネントターゲットを読み戻す

`story import` が読むのは Story だけなので、`screen generate --target component` が書いたファイルを Screen JSON へ読み戻すことはできません。
この非対称と回避策（画面を後で直す可能性があるなら Screen JSON を残す）は [`workflows.md`](./workflows.md) に明記してあります。
インポータは既に 2 つの部分から成ります。CSF 固有の前半（meta を見つけ、Story の export を選ぶ）と、汎用の JSX → ScreenNode 変換です。
したがって、この穴を塞ぐのは前半のコンポーネントファイル変種です。export された関数を見つけ、その返す JSX を同じ変換に渡します。
それまで、この非対称は解消されず文書化されたままです。

### 11. 画面の差分は何を比較するのか

承認済みのモックと、そこから作った実装は、静かに乖離していきます。
構造の差分（承認済みの Screen JSON と現在のツリーを並べる）があれば、何が変わったか（ノードの削除、props の変更）をレビュー任せにせず名指しできます。
未解決なのは右辺です。
実装は Story の形をしていないため、何を通して読み戻すか（上のコンポーネントターゲットのインポータが出来たとすればそれか）が、差分がそもそも可能かを決めます。

### 12. 保存済み画面の移行戦略

`<data-dir>/screens/` に保存した画面は、その下で動きうる 2 つのものに固定されています。
保存済み画面に残す価値のあるものが入る前に、どちらにも答えが要ります。

1 つ目はコンポーネント id です。`--source` で作った Registry は `<モジュールパス>#<exportName>`、`--index` 単独で作った Registry は短い id（`Button`）を使います。
両者は互換ではないので、一方で保存した画面をもう一方で検証し直すことはできません。
移行や alias の仕組みは、現在は存在しません。

2 つ目は `schemaVersion` です。
パーサはこれをハードなリテラル（`z.literal("1.0")`）として扱い、古い文書を受理して昇格させる分岐を持ちません。
したがってバージョンを上げれば、保存済み画面と手書きの Screen JSON がすべて `INVALID_REQUEST` で弾かれます。1.0 以前のバージョニングはその破壊的変更を許容しており、だからこそ、それを取り込むリリースは片方ではなく 2 軸にまたがる移行の道筋を必要とします。

### 13. 出力の形をどこまで広げるか

ファイルの形は決まりました。1 つのモジュールが画面状態ごとに 1 つの export を運びます。CSF ターゲットでは Story の export、コンポーネントターゲット（`screen generate --target component`。Storybook を持たないホスト向け）では export された関数になります。
どちらのターゲットも、共有のレンダラ（`render.ts`）を通じて、どの状態も同じツリーとその差分から描画します。

残る論点はコンポーネント境界です。Screen JSON には「ここが再利用単位」という情報が無いため、コンポーネントターゲットは、すべてのモック値を内部に持ち props を切り出さない、自己完結したコンポーネント 1 つを書き出します。

- さらに進める利点: props の切り出し（どこを外から渡すか）を表現できれば、生成物をそのままアプリのコードに移せます。
  コンポーネントを表示する薄い Story は、ホストの他の Story と同じ形になります。
- 論点: どこを境界にするか。
  ファイルを 2 つ出すとホストの配置規約に踏み込む度合いも上がります。
- Screen JSON 側に境界の表現が入るまでは、props を切り出さない 1 ファイルを既定とします。

### 14. リビルドした index に Story が現れることを確認する

`screen generate` はファイルで終わります。
その Story がホストの Storybook に載ったかどうか（title が解決する、import がビルドを通る、描画時に何も投げない）を、現在はホストの型チェックと人の目で確かめています。
機械による確認の 1 段目は安価です。
材料が既にあるからです。CLI は `index.json` をパスからでも起動中の開発サーバの URL からでも読めますし、`registry status` はその index の鮮度を既に扱っています。
生成した Story がリビルドした index に現れるかの確認は、その両方を再利用します。
その上の段は非目標です。
後述します。

## ランタイムとパッケージング

### コンパイラ API が届かない間は TypeScript 6.x に留まる

`typescript` の `<7` は意図的な上限です。TypeScript 7.0 は 2026-07-08 に GA となり npm の `latest` でもあるため、新規のホストは既定でこれを踏みます。
そしてコンパイラ API を同梱しておらず、`require("typescript")` は `{ version, versionMajorMinor }` しか返しません。`source-registry.ts` と `react-docgen-typescript` はどちらも 6.x の API の上に成り立っています。7 のホストは互換パッケージ経由でその API を保てます。
導入手順は [`registry.md`](./registry.md) に記載しています。

後継の API は `typescript/unstable/*` として公開されています（`Program` / `Checker` は `unstable/sync`、ノード操作は `unstable/ast`）。7.1 の Iteration Plan は microsoft/TypeScript#63703 にあります（Beta 2026-09-09、RC 2026-10-20、Stable 2026-11-10）。
そこで安定化の対象として挙がるのは Content Mapper・Emit・Language Service の 3 つです。Yosegi と react-docgen-typescript が実際に必要とする `Program` / `Checker` は含まれていません。
したがって 7.1 は上限が外れる期日ではなく、再評価のきっかけとなる日付です。

Language Service が先に安定するという事実自体が、上の抽出インターフェースの論拠になります。
それを土台にした実装のほうが、Checker を土台にしたものより早く手が届きます。

### `typescript` は peer dependency にせず `dependency` のままとする

`packages/server` は `typescript` を `>=5.4.0 <7` の `dependency` として宣言しており、これを維持します。
peer dependency 化が方向でしたが、2026-08-16 に npm 11・pnpm 10・bun 1.3 で実地にインストールして検証しました。
7 のホストの下に 6 系のコピーが入れ子で入ることは、受け入れるコストとします。

判断を左右する前提は成り立ちますが、得るものがありません。
ホストの `typescript@npm:@typescript/typescript6` というエイリアスが提供する `typescript` の名前は、宣言した範囲とも peer の要求とも unify します。
npm でも pnpm でも警告は出ません。
ただし `@typescript/typescript6` は 10KB の shim であり、`@typescript/old: npm:typescript@^6` を通して実体のコンパイラを引き込みます。
つまり約 24MB はどちらにせよ入ります。

一方で失うものは実在します。
エイリアスを持たない素の 7 のホストでは `npm install` が `ERESOLVE` で失敗し、optional な peer にしても回避できません。
pnpm と bun ではインストールは通りますが、実行時に生の `TypeError` でクラッシュします。
遅延ロードしているのは `docgen.ts` だけで、5 つのモジュールがトップレベルで `typescript` を import しているためです。
そして同じホストは現状の `dependencies` なら動いています。
pnpm の isolated なレイアウトが Yosegi 自身の 6 系を与えるからです。
つまりこの変更は、今動いているホストを壊します。

再訪するのは、それらのトップレベルの `import * as ts` が遅延化された後です。
これは別途進めており、コンパイラ API が欠けている場合に生の `TypeError` ではなく `docgen.ts` が既に出しているエラーを出すようにするものです。

### `@yosegi/core` とファイルシステム

`packages/core` を `node:fs` に縛っているのは `FileScreenRepository` だけです。
これを `@yosegi/core/node` サブパスへ分離すれば、core 本体をブラウザや Workers 環境でも使えるようになります。
これを待っている consumer はいません。
したがって今すぐ計画する作業ではありません。HTTP のアプリを組み込む使い方がサポート対象となった段階で再訪する、パッケージングの論点として扱います。

## 検討中の論点

### HTTP アダプタは何のためにあるのか

アダプタの機能は不揃いというより入れ子です。CLI ⊃ MCP ⊃ HTTP。MCP に無いものは決着しています。Registry の生成、metadata の雛形出し、Story の読み戻し、`registry status` のソースドリフト再計算の半分は、仕様として CLI 専用です。Skill の CLI リファレンスにもその旨を記載しています。HTTP の差はもっと大きくなります。
公開しているのは health・registry・components・screens・operations・duplicate・validate・implementation context です。
生成系のエンドポイントは 1 つもありません。

論点はその差をどう埋めるかではなく、埋めるかどうかです。HTTP アダプタには文書化された consumer が無い一方で、`hono` は全ユーザーが install する必須依存です。
この依存に見合う使い道を得るか、公開する範囲から外すかのどちらかです。

## 非目標

### デザイントークンを Registry に載せること

`className` は自由記述のままとします。
どんな文字列でも検証を通り、ホストの CSS が定義しないトークンはレビューまで静かに抜けます。
ホストのトークンを Registry へ抽出すれば、enum の props が既にそうであるのと同じやり方で検証可能にできますが、トークンには単一のソースがありません。Tailwind の設定、CSS 変数、CSS-in-JS のテーマと分かれるため、Registry はホストの CSS 方言へ依存を持ち込むことになります。
これはホストの TypeScript を読むよりはるかに大きなコミットであり、この論点は開いたままにするのではなく決着したものとします。

### スクリーンショットや a11y のチェックを仲介すること

生成した Story をホスト自身の Storybook（そのテストランナー、そのアドオン）に通し、スクリーンショットや a11y の結果を受け取ることは、Yosegi では行いません。
仲介はレンダリング環境を所有することではありませんが、ホストのブラウザスタックを Yosegi のクリティカルパスに載せます。
出発点の線引きは、まさにそれを避けるために引かれています。
機械による確認は項目 14 の index のチェックまでとします。
