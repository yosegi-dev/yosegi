# Storybook MCP と Yosegi

[English](../storybook-mcp.md) | 日本語

Storybook は公式の AI 連携を同梱しており、「ホストのコンポーネントの型付きカタログをエージェントに渡し、Story を書かせる」という Yosegi の問題設定と重なります。
このページは双方が何を担うかを事実として並べ、片方で足りるか併用すべきかを判断できるようにします。

以下の事実は 2026 年 8 月に storybook.js.org のドキュメントとリリース記事で確認しました。Storybook はこれらの機能をプレビューと位置づけているので、詳細に依存する前に最新のドキュメントで確認してください。

## Storybook が提供するもの

Storybook 10.3（2026 年 4 月）が「Storybook MCP for React」を導入し、10.4（2026 年 5 月）がエージェント主導のセットアップを追加しました。10.5 時点の公式の構成要素は次の通りです。

| 要素 | 内容 |
| --- | --- |
| Component Manifest | Storybook 内の CSF ファイルの静的解析と、そのソースからの props 抽出で作られる、コンポーネントの JSON カタログ。Story 由来なので、Story が語る内容（使用例のスニペットなど）を持ちます。プレビュー中のスキーマは「安定しておらず public API とみなすべきではない」と公式が明記しています |
| `@storybook/addon-mcp` | その Storybook の上に立つ MCP サーバ。カタログをエージェントへ渡すほか、ドキュメント用と Story テスト実行用のツールセットを備えます |

現時点ではどちらも React 専用です。
稼働中の dev サーバだけが入口ではなくなりました。Chromatic で Storybook を公開すると MCP サーバも一緒に公開され、`@storybook/mcp` は自前でホストしたいチーム向けに `createStorybookMcpHandler()` を提供します。
稼働中のインスタンスに作用するツールセットは、いまも dev サーバを必要とします。

## 重なる部分

型付きのコンポーネントカタログをエージェントに渡すことも、エージェントに Story を書かせることも、どちらのツールにもできます。
使うコンポーネントすべてに Story があり、エージェントの作業中に Storybook をビルドまたは起動できるホストなら、公式 MCP だけで足りる場合があります。

この重なりは、狭まるより広がる方向にあります。
Storybook の「Design Systems with Agents」RFC は Yosegi と同じ問題から出発しています。
デザインシステムのコンポーネントに手を伸ばさず、エージェントが自前のコンポーネントを作り直してしまう、という問題です。
そこで提案されている参照サーバは `component list`・`--query`・`component inspect` と同じ 3 つの操作の上に立っており、すでに Claude Code から繋げる実験実装もあります。
以下の棲み分けは、確定した役割分担ではなく、現時点で両者がどこに居るかとして読んでください。

## Yosegi にしかないもの

### JSX を書く前の検証

Screen JSON は宣言的な中間表現で、JSX を 1 行も書く前に Registry と突き合わせて検証されます。
エラーは機械可読な code と `suggestion` 付きで返り、エージェントはそれを反映して再実行します。[ワークフロー](./workflows.md#検証エラーの-code)にある自己修正ループがこれに当たります。Storybook のテストツールが検証するのは、コードができた後のランタイムです。

### Story を持たないコンポーネントへの到達

Manifest は CSF ファイルから生成されるので、自身の Story を持たないコンポーネントに届くのは、どこかの Story の meta が subcomponent として手で宣言した場合だけです。
誰も宣言しなかったものは射程の外に残ります。
Registry は TypeScript のソースを直接読むので、export されたコンポーネントはどちらであれ載ります。[Component Registry](./registry.md#実測結果) で実測した実運用のデザインシステムでは、278 コンポーネント中 60 が自身の Story を持ちませんでした。`CardHeader` のような、組み立てに欠かせないコンポーネントがそこに居ます。

### Story から実装への下り

`story import` は生成済みの Story を Screen JSON に読み戻し、`screen context` がそれを実装コンテキストへ展開します。
貼れる import 文、使用 props、slot 構造、結線タスクが得られます。
公式ツールの範囲は Story までで終わります。

### Storybook のビルドも不要

Registry はソースファイルと tsconfig だけから作られます。
Manifest は `storybook build` か dev サーバの産物なので、インストールでき、設定でき、ビルドできる Storybook を前提にします。
Yosegi はそのどちらも前提にしないため、CI でも、チェックアウト直後でも、Storybook をまったく持たないホストでも使えます。`screen generate --target component` が画面を素の React コンポーネントファイルとして書き出します（[ワークフロー](./workflows.md#storybook-が無い場合)を参照）。
Storybook の `index.json` は任意のキュレーション入力で、静的ファイルでもかまいません。

この前提の違いが、差を構造的なものにしています。CSF が入力である限り、解析する Story を持たないホストには、そもそもビルドできる Manifest がありません。

## 棲み分け

レンダー前の静的検証と画面の組み立ては Yosegi が持ちます。
レンダリング・インタラクションテスト・アクセシビリティ検査はランタイムの問いであり、Storybook MCP かブラウザに委ねるのが正しいやり方です。
この範囲の棲み分けは安定していますが、その上のカタログの層は安定していません。
両者は次のように繋がります。

1. Yosegi で画面を組んで検証し、`screen generate` が Story を書き出します。
2. ホストの型検査が JSX を実物のコンポーネント型と突き合わせます。
3. Storybook MCP の `run-story-tests`（と `preview-stories`）がランタイムで確認します。

各段は、前の段には見えないものを捕まえます。
