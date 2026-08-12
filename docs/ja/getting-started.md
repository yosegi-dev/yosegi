# はじめに

[English](../getting-started.md) | 日本語

何も無い状態から Storybook 上の Story まで、そしてその先の実装まで。

## 前提

- Storybook を持つ React + TypeScript のプロジェクト。Yosegi は TypeScript の型を読んで CSF を
  出力するので、どちらの工程にも他スタック向けの代替経路は無い。
- ホストのコンポーネントを解決できる `tsconfig.json`（`paths` を含む）。
- Node.js 20 以上。Bun が要るのは Yosegi 自体を開発する場合のみ。

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

以下の `yosegi` は `npx yosegi`（`pnpm yosegi`、`yarn yosegi`、`bunx yosegi`）を指す。引数なしで
実行すると全コマンドが出る。

## Agent Skill を入れる

エージェントは以下の手順をこの Skill から学ぶ。使っているエージェントが読む skills ディレクトリへ
入れる（`.claude/skills/` は Claude Code のもの）。

```sh
npx skills add yosegi-dev/yosegi
```

または、インストール済みのパッケージからコピーする。こちらは Skill を手元に入っている
バージョンに固定する。

```sh
mkdir -p .claude/skills
cp -R node_modules/@yosegi/yosegi/skills/yosegi .claude/skills/
```

ディレクトリごとコピーする。`SKILL.md` は作業中に `references/` を開かせる。アップグレード後は
コピーし直す。エージェントは古い複製を黙って読むことがあるので、挙動がこれらのページと食い違う
ときは `SKILL.md` のタイトル直下にあるバージョンの日付をこのリポジトリの同ファイルと比べる。

使っているエージェントツールが実際に読む場所 1 箇所だけに入れる。以前使っていたツールの名残や
手動で試した際の複製が別の場所に残っていると、まさにこのバージョン日付のチェックが検出すべき
「古い複製」そのものになる。同じリポジトリに 2 つ残さず、片方は削除する。

## MCP サーバを登録する（任意）

```sh
claude mcp add yosegi -- npx yosegi mcp
```

Skill はどちらでも動く。CLI のほうが守備範囲は広く、Registry の生成と Story の読み戻しは CLI に
しか無い。

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

# 4a. .stories.tsx を直接書く。これが既定であり、JSON リテラルで書けない値を必要とするコンポーネントが
#     1 つでもあれば（ランタイムのオブジェクト、コンポーネント参照、繰り返し、条件分岐）唯一の選択肢

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

`--data-dir` は全コマンドへ同じ値を渡す。Registry と保存済み画面の置き場で、既定はカレント
ディレクトリ直下の `.yosegi`。

必須なのは手順 1 と 2。コンポーネントの本当の props・enum の選択肢・slots・import specifier は、そこ
からしか得られない。出力はホストのリポジトリに入り、ホストのコードとしてレビューされるので、手順 3
も省略できない。どちらも [Agent Skill](../../skills/yosegi/SKILL.md) が扱う。

## 一度だけやっておくとよいこと

- `registry build` をリポジトリのスクリプトにする（`bun run yosegi:registry`）。`--source` /
  `--tsconfig` / `--index` を毎回思い出さずに済む。
- Story に必要な meta の定型（`tags`、Docs ページ、デザイン参照）をテンプレートファイルに書き、
  `screen generate --meta-template` へ渡す。
- ホストの Story 規約・デザイントークン・真似する価値のある複合 Story をエージェントに示す。
- 型から props を読めないコンポーネントがあれば `registry metadata` で `--metadata` の雛形を作り、上
  のスクリプトへ組み込む。

## 次に読む

- [Screen JSON](./screen-json.md) — 手順 4b で書くツリー。
- [ワークフロー](./workflows.md) — 上流・下流のループとエラー code。
- [CLI リファレンス](./cli.md#cli-の呼び出し方) — 全コマンドとフラグ。
