# Storybook MCP と Yosegi

[English](../storybook-mcp.md) | 日本語

Storybook は公式の AI 連携を同梱しており、「ホストのコンポーネントの型付きカタログをエージェントに渡し、Story を書かせる」という Yosegi の問題設定と重なります。
このページは双方が何を担うかを事実として並べ、片方で足りるか併用すべきかを判断できるようにします。

以下の事実は 2026 年 8 月に storybook.js.org のドキュメントとリリース記事で確認しました。Storybook はこれらの機能をプレビューと位置づけているので、詳細に依存する前に最新のドキュメントで確認してください。

## Storybook が提供するもの

Storybook 10.3（2026 年 4 月）が「Storybook MCP for React」を導入し、10.4（2026 年 5 月）がエージェント主導のセットアップを追加しました。10.5 時点の公式の構成要素は次の通りです。

| 要素 | 内容 |
| --- | --- |
| Component Manifest | `/manifests/components.json`。Storybook 内の CSF ファイルの静的解析と `reactDocgen` オプション経由の props 抽出から生成されます。プレビュー中のスキーマは「安定しておらず public API とみなすべきではない」と公式が明記しています |
| `@storybook/addon-mcp` | 稼働中の dev サーバの `/mcp` に立つ MCP サーバ。ツールセットは development（`get-changed-stories`、`get-storybook-story-instructions`、`preview-stories`）、docs（`list-all-documentation`、`get-documentation`、`get-documentation-for-story`）、testing（`run-story-tests`） |

現時点ではどちらも React 専用で、稼働中の Storybook が前提になります。MCP エンドポイントは dev サーバ上に立ち、Manifest は dev サーバかビルド済み Storybook が配信します。

## 重なる部分

型付きのコンポーネントカタログをエージェントに渡すことも、エージェントに Story を書かせることも、どちらのツールにもできます。
使うコンポーネントすべてに Story があり、エージェントの作業中つねに dev サーバを立てられるホストなら、公式 MCP だけで足りる場合があります。

## Yosegi にしかないもの

### JSX を書く前の検証

Screen JSON は宣言的な中間表現で、JSX を 1 行も書く前に Registry と突き合わせて検証されます。
エラーは機械可読な code と `suggestion` 付きで返り、エージェントはそれを反映して再実行します。[ワークフロー](./workflows.md#検証エラーの-code)にある自己修正ループがこれに当たります。Storybook のテストツールが検証するのは、コードができた後のランタイムです。

### Story を持たないコンポーネントへの到達

Manifest は CSF ファイルから生成されるので、Story の無いコンポーネントには構造的に届きません。Registry は TypeScript のソースを直接読みます。[Component Registry](./registry.md#実測結果) で実測した実運用のデザインシステムでは、278 コンポーネント中 60 が自身の Story を持ちませんでした。`CardHeader` のような、組み立てに欠かせないコンポーネントがそこに居ます。

### Story から実装への下り

`story import` は生成済みの Story を Screen JSON に読み戻し、`screen context` がそれを実装コンテキストへ展開します。
貼れる import 文、使用 props、slot 構造、結線タスクが得られます。
公式ツールの範囲は Story までで終わります。

### dev サーバ不要

Registry はソースファイルと tsconfig から作られます。Storybook の `index.json` は任意のキュレーション入力で、静的ファイルでもかまいません。
何も起動していなくてよいので、CI やチェックアウト直後でも使えます。Storybook 自体も必須ではありません。`screen generate --target component` が画面を素の React コンポーネントファイルとして書き出します。
そのため Storybook をまったく持たないホストでも画面の組み立てと検証はできます（[ワークフロー](./workflows.md#storybook-が無い場合)を参照）。

## 棲み分け

レンダー前の静的検証と画面の組み立ては Yosegi が持ちます。
レンダリング・インタラクションテスト・アクセシビリティ検査はランタイムの問いであり、Storybook MCP かブラウザに委ねるのが正しいやり方です。
両者は次のように繋がります。

1. Yosegi で画面を組んで検証し、`screen generate` が Story を書き出します。
2. ホストの型検査が JSX を実物のコンポーネント型と突き合わせます。
3. Storybook MCP の `run-story-tests`（と `preview-stories`）がランタイムで確認します。

各段は、前の段には見えないものを捕まえます。
