---
layout: home

hero:
  name: Yosegi
  text: 手元のコンポーネントから画面を組む
  tagline: Storybook に登録済みのコンポーネントから画面 UI を組み立て、Story として書き出し、その Story を実装へ転換します。使い手はコーディングエージェントで、入口は CLI・MCP サーバ・Agent Skill の 3 つです。GUI はありません。
  image:
    light: /brand/yosegi-symbol.svg
    dark: /brand/yosegi-symbol-light.svg
    alt: Yosegi
  actions:
    - theme: brand
      text: はじめる
      link: /ja/getting-started
    - theme: alt
      text: ワークフロー
      link: /ja/workflows
    - theme: alt
      text: GitHub
      link: https://github.com/yosegi-dev/yosegi

features:
  - title: 型から作られる Registry
    details: ホストのソースの TypeScript の型が、そのままコンポーネントのカタログになります。props、slots、enum の選択肢、実際に書く import specifier のすべてが型から決まり、手書きするものはありません。
  - title: 成果物は Story
    details: エージェントはその事実を元に .stories.tsx を書きます。静的な画面なら、先に Screen JSON を通して機械可読な検証（自力で直せるエラー）を得てもかまいません。
  - title: レビューはホストの Storybook で
    details: Story はホストの Storybook に置かれ、そこで目視します。その前にホスト自身の型検査が JSX を実物の型と突き合わせます。Yosegi は独自の描画環境を持ちません。
  - title: そして実ページになる
    details: 承認された Story は実装コンテキストを伴います。貼れる import 文、使用 props、slot 構造、残っている結線。
---

## 実運用のデザインシステムでの実測

120 ファイルから 278 コンポーネントを約 4 秒、98.9% は props まで型から取得、出力は決定的です。
型がカタログになる仕組みと数値の詳細は [Component Registry](./registry.md) にあります。

さらに 4 つの UI ライブラリでベンチマークしました。
コンポーネントの API をソース、パッケージの `.d.ts`、Registry のどれで渡しても、エージェントは同じクリーンな画面を出します。
Registry が変えるのは、正しくあることの価格です。
デザインシステム規模で最小の読解量、ソースの 5 分の 1、パッケージ同梱の `.d.ts` の 3 分の 1。
同じ出力を、最小のコンテキストで: [ベンチマーク](./benchmark.md)。

## インストール

Node.js 22 以上。
パッケージマネージャは何でもかまいません。

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

主な使い方である Agent Skill を入れます。

```sh
npx skills add yosegi-dev/yosegi
```

あとは「既存のコンポーネントで画面案を作って」と頼みます。

> 寄木細工（yosegi）は、小さな木片を寄せ集めて一つの模様を作る日本の木工技法です。
> デザインシステムのコンポーネントを寄せて画面を組む、というこのツールの営みになぞらえています。
