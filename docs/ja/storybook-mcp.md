# Storybook MCP と Yosegi

[English](../storybook-mcp.md) | 日本語

Storybook は公式の AI 連携を同梱しており、「ホストのコンポーネントの型付きカタログをエージェントに
渡し、Story を書かせる」という Yosegi の問題設定と重なる。このページは双方が何を担うかを事実として
並べ、片方で足りるか併用すべきかを判断できるようにする。

以下の事実は 2026 年 8 月に storybook.js.org のドキュメントとリリース記事で確認した。Storybook は
これらの機能をプレビューと位置づけているので、詳細に依存する前に最新のドキュメントで確認すること。

## Storybook が提供するもの

Storybook 10.3（2026 年 4 月）が「Storybook MCP for React」を導入し、10.4（2026 年 5 月）が
エージェント主導のセットアップを追加した。10.5 時点の公式の構成要素は次の通り。

| 要素 | 内容 |
| --- | --- |
| Component Manifest | `/manifests/components.json`。Storybook 内の CSF ファイルの静的解析と `reactDocgen` オプション経由の props 抽出から生成される。プレビュー中のスキーマは「安定しておらず public API とみなすべきではない」と公式が明記している |
| `@storybook/addon-mcp` | 稼働中の dev サーバの `/mcp` に立つ MCP サーバ。ツールセットは development（`get-changed-stories`、`get-storybook-story-instructions`、`preview-stories`）、docs（`list-all-documentation`、`get-documentation`、`get-documentation-for-story`）、testing（`run-story-tests`） |

現時点ではどちらも React 専用で、稼働中の Storybook が前提になる。MCP エンドポイントは dev サーバ
上に立ち、Manifest は dev サーバかビルド済み Storybook が配信する。

## 重なる部分

型付きのコンポーネントカタログをエージェントに渡すことも、エージェントに Story を書かせることも、ど
ちらのツールにもできる。使うコンポーネントすべてに Story があり、エージェントの作業中つねに dev サー
バを立てられるホストなら、公式 MCP だけで足りる場合がある。

## Yosegi にしかないもの

### JSX を書く前の検証

Screen JSON は宣言的な中間表現で、JSX を 1 行も書く前に Registry と突き合わせて検証される。エラーは
機械可読な code と `suggestion` 付きで返り、エージェントはそれを反映して再実行する。
[ワークフロー](./workflows.md#検証エラーの-code)にある自己修正ループがこれに当たる。Storybook の
テストツールが検証するのは、コードができた後のランタイムである。

### Story を持たないコンポーネントへの到達

Manifest は CSF ファイルから生成されるので、Story の無いコンポーネントには構造的に届かない。
Registry は TypeScript のソースを直接読む。[Component Registry](./registry.md#実測結果) で実測した
実運用のデザインシステムでは、278 コンポーネント中 60 が自身の Story を持たなかった。`CardHeader`
のような、組み立てに欠かせないコンポーネントがそこに居る。

### Story から実装への下り

`story import` は生成済みの Story を Screen JSON に読み戻し、`screen context` がそれを実装コンテキ
ストへ展開する。貼れる import 文、使用 props、slot 構造、結線タスクが得られる。公式ツールの範囲は
Story までで終わる。

### dev サーバ不要

Registry はソースファイルと tsconfig から作られる。Storybook の `index.json` は任意のキュレーション
入力で、静的ファイルでもよい。何も起動していなくてよいので、CI やチェックアウト直後でも使える。
Storybook 自体も必須ではない。`screen generate --target component` が画面を素の React コンポーネント
ファイルとして書き出す。そのため Storybook をまったく持たないホストでも画面の組み立てと検証はできる
（[ワークフロー](./workflows.md#storybook-が無い場合)を参照）。

## 棲み分け

レンダー前の静的検証と画面の組み立ては Yosegi が持つ。レンダリング・インタラクションテスト・
アクセシビリティ検査はランタイムの問いであり、Storybook MCP かブラウザに委ねるのが正しい。両者は
次のように繋がる。

1. Yosegi で画面を組んで検証し、`screen generate` が Story を書き出す。
2. ホストの型検査が JSX を実物のコンポーネント型と突き合わせる。
3. Storybook MCP の `run-story-tests`（と `preview-stories`）がランタイムで確認する。

各段は、前の段には見えないものを捕まえる。
