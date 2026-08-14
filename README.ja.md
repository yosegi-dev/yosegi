# Yosegi

[English](./README.md) | 日本語

Storybook に登録済みのコンポーネントから画面 UI を組み立て、Story として書き出し、その Story を
実装へ転換する。使い手はコーディングエージェントで、入口は CLI・MCP サーバ・Agent Skill の 3 つ。
GUI は無い。

> 寄木細工（yosegi）は、小さな木片を寄せ集めて一つの模様を作る日本の木工技法。デザインシステムの
> コンポーネントを寄せて画面を組む、というこのツールの営みになぞらえている。

React + TypeScript のプロジェクト向け。Component Registry は TypeScript の型から作られ、出力は CSF
（`.stories.tsx`）。Storybook を持たないホストでは、素の React コンポーネントファイル
（`screen generate --target component`）を出力できる。

## 仕組み

1. **Component Registry** — ホストのソースの TypeScript の型を読んでコンポーネントのカタログにする。
   props、slots、enum の選択肢、実際に書く import specifier のすべてが既定では型から決まる。
   型で表現できないわずかな穴は `--metadata` で埋め、`--index` 単独で作った Registry には
   型情報が無い（[`docs/ja/registry.md`](./docs/ja/registry.md)）。
2. **参照** — `component inspect` はコンポーネントの props の正となる情報源。フォーク先で改名された
   variant、children ではなく名前付き slot になっている `ReactNode` prop、export 名が衝突する 2 つの
   コンポーネント。どれも React の知識からは導けない。画面の骨格や合成の作法は、ここではなくホスト自
   身の Story やテンプレートから得る。
3. **Story** — 成果物。エージェントはその事実を元に `.stories.tsx` を書く。静的な画面なら、先に
   Screen JSON を通して機械可読な検証（自力で直せるエラー）を得てもよい。
4. **レビュー** — Story はホストの Storybook に置かれ、そこで目視する。その前にホスト自身の型検査が
   JSX を実物の型と突き合わせる。Yosegi は独自の描画環境を持たない。
5. **実装** — 承認された Story を実ページにする。Yosegi が生成した Story であれば実装コンテキスト
   （貼れる import 文・使用 props・slot 構造・残っている結線）も出せる。

実運用の React デザインシステムでの実測: 120 ファイルから 265 コンポーネントを 4.2 秒、98.9% は
props まで型から取得、出力は決定的。詳細は [`docs/ja/registry.md`](./docs/ja/registry.md)。

## 使いどころ

- **画面モックを速く作る。** 画面を頼むと、エージェントがコンポーネントを調べ、Story を書き、チーム
  が Storybook でレビューする。描かれるのは実物のコンポーネントで、props も実物。
- **自社 API の当て推量をやめる。** エージェントは、上流ライブラリが受け取っていた props を書く
  のではなく、そのコンポーネントが何を受け取るかを Registry に訊く。
- **Figma を介さずイテレーションする。** レビューで見るものと実装で使うものが同じになる。新しい
  ビジュアル表現を決めるのは引き続き Figma の仕事。

詳細は [`docs/ja/workflows.md`](./docs/ja/workflows.md)。

Storybook 10.3 以降は公式の MCP サーバと Component Manifest を同梱する。Yosegi は競合ではなく
補完関係にあり、棲み分けは [`docs/ja/storybook-mcp.md`](./docs/ja/storybook-mcp.md) にまとめている。

## インストール

Node.js 20 以上。パッケージマネージャは何でもよい。Registry は TypeScript 6.x のコンパイラ API を通
して型を読むが、TypeScript 7 はその API を同梱しない。7 のホストは 1 パッケージのエイリアスが要る。
[TypeScript 7 のホスト](./docs/ja/registry.md#typescript-7-のホスト)を参照。

```sh
# npm
npm i -D @yosegi/yosegi
# pnpm
pnpm add -D @yosegi/yosegi
# yarn
yarn add -D @yosegi/yosegi
# bun
bun add -d @yosegi/yosegi
```

## クイックスタート

以下の `yosegi` は `npx yosegi`（`pnpm yosegi`、`yarn yosegi`、`bunx yosegi`）を指す。

```sh
# 型から Component Registry を作る
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --data-dir .yosegi

# コンポーネントを探す
yosegi component list --query card --data-dir .yosegi
yosegi component inspect "app/components/ui/button#Button" --data-dir .yosegi

# Screen JSON から Story を生成する
yosegi screen generate tmp/screen.json \
  --out app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" \
  --data-dir .yosegi
```

引数なしで `yosegi` を実行すると全コマンドが出る。
通しの手順: [`docs/ja/getting-started.md`](./docs/ja/getting-started.md)。

## Agent Skill

Yosegi の主な使い方はこれ。[`skills/yosegi/`](./skills/yosegi/) にワークフローがまとまっている
（英語）。`SKILL.md` が手順で、`references/` に Registry の読み方・コマンドリファレンス・
Screen JSON 仕様・エラー対応・実装ガイドが入っており、必要になった時点で開かれる。

```sh
npx skills add yosegi-dev/yosegi
```

または、インストール済みのパッケージからコピーする。

```sh
mkdir -p .claude/skills
cp -R node_modules/@yosegi/yosegi/skills/yosegi .claude/skills/
```

`SKILL.md` にはタイトル直下にバージョンの日付がある。入れた Skill が最新かは、
このリポジトリの同ファイルと日付を比べて確認する。使っているエージェントツールが読む場所
1 箇所だけに入れる。ホストリポジトリの別の場所に残った未追跡の複製は、まさにこの日付チェックが
検出すべき古い複製そのものになる。

あとは「既存のコンポーネントで画面案を作って」と頼む。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [はじめに](./docs/ja/getting-started.md) | チームでのセットアップと通しの手順 |
| [ワークフロー](./docs/ja/workflows.md) | ユースケース、上流・下流のループ、エラー code |
| [Storybook MCP と Yosegi](./docs/ja/storybook-mcp.md) | 公式 Storybook MCP との重なりと棲み分け |
| [Screen JSON](./docs/ja/screen-json.md) | コンポーネント id、合成プリミティブ、bindings / events |
| [CLI リファレンス](./docs/ja/cli.md) | 全コマンドとフラグ、および MCP ツール |
| [開発](./docs/ja/development.md) | パッケージ構成、ビルド、公開前検証 |
| [ロードマップ](./docs/ja/ROADMAP.md) | 予定している作業と未決の論点 |
| [Component Registry](./docs/ja/registry.md) | 型がカタログになる仕組みと実測 |
| [ベンチマーク](./docs/ja/benchmark.md) | Registry がエージェントの出力をどう変えるかを 4 つの UI ライブラリで実測 |

このリポジトリでの作業: [`AGENTS.md`](./AGENTS.md)、[`CONTRIBUTING.md`](./CONTRIBUTING.md)（英語）、
[ドキュメント規約](./docs/ja/conventions.md)。

## バージョニング

1.0 未満のあいだは、マイナーバージョンにも破壊的変更が入り得る。

## ライセンス

[MIT](./LICENSE)
