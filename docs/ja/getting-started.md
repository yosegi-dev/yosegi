# はじめに

[English](../getting-started.md) | 日本語

何も無い状態から Storybook 上の Story まで、そしてその先の実装まで。

## 前提

- React + TypeScript のプロジェクト。Yosegi は TypeScript の型を読んで React を出力するので、どちらの工程にも他スタック向けの代替経路はありません。
- Storybook を推奨しますが、必須ではありません。
  Yosegi が出力する Story のレビュー面であり、以下の手順もこれを前提にします。
  Storybook が無いホストは `screen generate` に `--target component` を渡し、素の React コンポーネントファイルを受け取ります。
- ホストのコンポーネントを解決できる `tsconfig.json`（`paths` を含む）。
- Node.js 22 以上。Bun が要るのは Yosegi 自体を開発する場合のみです。

## インストール

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

以下の `yosegi` は `npx yosegi`（`pnpm yosegi`、`yarn yosegi`、`bunx yosegi`）を指します。
引数なしで実行すると全コマンドが出ます。

## Agent Skill を入れる

エージェントは以下の手順をこの Skill から学びます。
使っているエージェントが読む skills ディレクトリへ入れます（`.claude/skills/` は Claude Code のものです）。

```sh
npx skills add yosegi-dev/yosegi
```

または、インストール済みのパッケージからコピーします。
こちらは Skill を手元に入っているバージョンに固定します。

```sh
mkdir -p .claude/skills
cp -R node_modules/@yosegi/yosegi/skills/yosegi .claude/skills/
```

ディレクトリごとコピーします。`SKILL.md` は作業中に `references/` を開かせます。
アップグレード後はコピーし直します。
エージェントは古い複製を黙って読むことがあるので、挙動がこれらのページと食い違うときは `SKILL.md` のタイトル直下にあるバージョンの日付をこのリポジトリの同ファイルと比べます。

使っているエージェントツールが実際に読む場所 1 箇所だけに入れます。
以前使っていたツールの名残や手動で試した際の複製が別の場所に残っていると、まさにこのバージョン日付のチェックが検出すべき「古い複製」そのものになります。
同じリポジトリに 2 つ残さず、片方は削除します。

## MCP サーバを登録する（任意）

```sh
claude mcp add yosegi -- npx yosegi mcp
```

Skill はどちらでも動きます。CLI のほうが守備範囲は広く、Registry の生成と Story の読み戻しは CLI にしかありません。

## 通しの手順

```sh
# 1. ホストの型から Component Registry を作る
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --data-dir .yosegi

# 2. 使うコンポーネントを探し、props を確定させる
yosegi component list --query card --data-dir .yosegi
yosegi component inspect "app/components/ui/card#CardHeader" --data-dir .yosegi

# 3. ホストの規約を読む（AGENTS.md、デザイントークン、既存の複合 Story）

# 4a. .stories.tsx を直接書く。これが既定であり、JSON の形を持たない値を必要とするコンポーネントが
#     1 つでもあれば（ランタイムのオブジェクト、コンポーネント参照、条件分岐）唯一の選択肢

# 4b. 静的な画面なら tmp/screen.json を書き、そこから Story を生成する
yosegi screen generate tmp/screen.json \
  --out app/components/screens/customer-list.stories.tsx \
  --title "Screens/Customer list" \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --data-dir .yosegi

# 5. ホストの型検査をかけ、次にフォーマッタをかけ、ホストの Storybook で確認する

# 6. 実装へ移す。Yosegi が生成した Story なら Screen JSON を読み戻して展開できる。手書きの Story
#    なら代わりに Story を読む（「ワークフロー」を参照）
yosegi story import app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" --out tmp/screen.json --data-dir .yosegi

yosegi screen context tmp/screen.json \
  --import-map "./app=~" --route /customers --data-dir .yosegi
```

`--data-dir` は全コマンドへ同じ値を渡します。Registry と保存済み画面の置き場で、既定はカレントディレクトリ直下の `.yosegi` です。
Yosegi は中身をすべて無視する `.gitignore` とともにこのディレクトリを作ります。
Registry をコミットしたい場合は、そのファイルに `!registry.json` を足してください。
このファイルが書き換えられることはありませんが、削除した場合は次のコマンドで復活します。

`registry build` はこのディレクトリへ `.gitignore` を書き出します。
リンタとフォーマッタは `.gitignore` を読まないので、それぞれの設定でもこのディレクトリを除外します。

必須なのは手順 1 と 2 です。
コンポーネントの本当の props・enum の選択肢・slots・import specifier を、推測ではなくここで確定させます。
出力はホストのリポジトリに入り、ホストのコードとしてレビューされるので、手順 3 も省略できません。
どちらも [Agent Skill](../../skills/yosegi/SKILL.md) が扱います。

## 一度だけやっておくとよいこと

- `registry build` をリポジトリのスクリプトにします（`bun run yosegi:registry`）。`--source` / `--tsconfig` / `--index` を毎回思い出さずに済みます。
- Story に必要な meta の定型（`tags`、Docs ページ、デザイン参照）をテンプレートファイルに書き、`screen generate --meta-template` へ渡します。
- ホストの Story 規約・デザイントークン・真似する価値のある複合 Story をエージェントに示します。
- 型から props を読めないコンポーネントがあれば `registry metadata` で `--metadata` の雛形を作り、コミットして、上のスクリプトへ組み込みます。

## 次に読む

- [Screen JSON](./screen-json.md) — 手順 4b で書くツリー。
- [ワークフロー](./workflows.md) — 上流・下流のループとエラー code。
- [CLI リファレンス](./cli.md#cli-の呼び出し方) — 全コマンドとフラグ。
