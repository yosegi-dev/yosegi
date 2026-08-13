# ドキュメント規約

[English](../conventions.md) | 日本語

このリポジトリのドキュメントの書き方。`README.md`・`docs/` 配下・Agent Skill を編集する前に読むこと。

## ページの役割

1 ページが扱う主題は 1 つ。ある概念の説明はそれを所有するページにだけ置き、他のページはそこへリンクする。

| ページ | 何を書くか | 書かないこと |
| --- | --- | --- |
| `README.md` | 顔。冒頭数行で価値、5 ステップの仕組み、最小限の quickstart、そして各ページへのリンク | フラグの表、トラブルシューティング、リンク先が所有する内容 |
| `docs/getting-started.md` | ウォークスルー。前提・インストール・Story までとその先の実装までの手順 | フラグの全一覧、抽出の内部仕様 |
| `docs/cli.md` | リファレンスのみ。コマンドごとに書式・オプション表（フラグ / 型 / デフォルト / 意味）・短い例を 1 つ | 概念の説明、チュートリアル、コマンドを繋げた手順 |
| `docs/screen-json.md` | フォーマット仕様。フィールド・component id・合成プリミティブ・`bindings` / `events` | フラグ、およびこのファイルを生む往復 |
| `docs/workflows.md` | ユースケース、上流と下流のループ、エラーと警告の code | フラグの意味 |
| `docs/registry.md` | 型がカタログになる仕組み、実測、抽出できないパターン | コマンドリファレンス |
| `docs/storybook-mcp.md` | 公式 Storybook MCP との重なりと棲み分け | 他ページが所有する内容、Storybook 自身のドキュメントの再掲 |
| `docs/development.md` | このリポジトリでの作業。構成・コマンド・公開前の検証・リリース | ホストでの Yosegi の使い方 |
| `docs/ROADMAP.md` | 予定している作業と未決の論点 | すでに入っているもの |
| `docs/ja/conventions.md` | このページ | コードの規約。それは [`AGENTS.md`](../../AGENTS.md) にある |
| `skills/yosegi/**` | ホストへ配布され、エージェントが読む単位 | Skill の外へのリンク（後述） |

## 分量の方針

- 1 ステップはコマンドブロックと目的 1 行。それ以上は書かない。
- 読み手の次の行動を変えない文は削る。
- 接続のための埋め草、「前述のとおり」、前の段落の言い換えは書かない。
- 箇条書きより表、段落より箇条書きを優先する。
- 100 桁で折り返す。

## コマンド例

パッケージマネージャは 1 つのブロックにこの順で並べ、この形をそのまま使う。

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

- 呼び出し方はページごとに一度だけ示す（「以下の `yosegi` は `npx yosegi`（`pnpm yosegi`、
  `yarn yosegi`、`bunx yosegi`）を意味する」）。以降の例では `yosegi` だけを書く。
- glob は必ずクォートする（`--source "app/components/**/*.tsx"`）。クォートしないと CLI へ届く前に
  シェルが展開する。
- 長いコマンドは `\` で折り、1 行 1 フラグにする。`--data-dir` は省略せず書く。

## 用語

| 概念 | 英語 | 日本語 | 使わない語 |
| --- | --- | --- | --- |
| コンポーネントのカタログ | Component Registry、短くは "the registry" | Component Registry、短くは「Registry」 | `台帳`、`コンポーネント一覧`、`"component index"` |
| UI の構成単位 | `component` | コンポーネント | `部品`、地の文の `component` |
| Registry の 1 コンポーネント分の記録 | `manifest`（`ComponentManifest`） | Manifest | 小文字のままの `manifest` |
| 検証の失敗 | `error` | エラー | `error` のまま |
| 生成を止めない指摘 | `warning` | 警告 | `warning` のまま |
| Story 由来の信号 | `curation` | キュレーション | `curation` のまま |
| ホストの外から来るコード | `third-party` | サードパーティ | `第三者` |
| 別モジュールの export の公開 | `re-export` | 再 export | `再エクスポート` |
| 別のコンポーネントを包むもの | `wrapper` | ラッパー | `wrapper` のまま |
| MCP / dev サーバ | `server` | サーバ | `サーバー` |
| 固定された単一のバージョン | `exact version` | 厳密なバージョン | `実バージョン` |
| 置換後の実在するバージョン | `a real version` | 実際のバージョン | `実バージョン` |
| npm レジストリ | `npm registry` | npm レジストリ | 単なる `レジストリ`（Registry と紛れる） |
| 中間表現のツリー | Screen JSON | Screen JSON | Screen Definition, 画面定義, "screen spec" |
| `Text` / `Box` / `Heading` | synthetic primitives | 合成プリミティブ | built-ins, fallback components |
| Yosegi を走らせる対象のプロジェクト | the host | ホスト | your project, the client, the consumer app |
| 成果物 | Story（大文字始まり）、フォーマットは CSF | Story, CSF | story file, snapshot |
| インストールされるパッケージ | `@yosegi/yosegi` | `@yosegi/yosegi` | `@yosegi/server` — これはディレクトリ名でパッケージ名ではない |
| 手順をまとめた単位 | Agent Skill、短くは "the skill" | Agent Skill、短くは「Skill」 | plugin, prompt pack |

## 英語 / 日本語の対応

英語が正。ページや差分はまず英語で書き、そのあと日本語へ訳し、両方を同じコミットに載せる。訳した日本語
（`README.ja.md` と `docs/ja/**`）は `bun run textlint`（`.textlintrc.json`）でチェックする。英語ページは
対象外。

- `docs/x.md` には必ず `docs/ja/x.md` の対があり、`README.md` にはリポジトリ直下に並ぶ `README.ja.md`
  がある。両方を同じコミットで変更する。
- H1 の下の行が言語切り替え。英語側は `English | [日本語](./ja/x.md)`、日本語側は
  `[English](../x.md) | 日本語`。
- 見出しは同じ順で同じ数、コードブロックと表も同じ。コードブロック内のコメントは訳すが、コマンド自体は
  訳さない。
- 日本語ページどうしは兄弟なので `./x.md` でリンクする（両方 `docs/ja/` にいる）。英語専用のリンク先へは
  1 階層上（`../x.md`、`docs/` 配下の別ページ）か 2 階層上（`../../x.md`、`AGENTS.md` や
  `CONTRIBUTING.md` などリポジトリ直下のファイル）で辿る。識別子・フラグ・エラー code・パスはどちらでも
  英語のまま。
- `skills/` は英語のみ。ホストで作業するエージェントが読むものだから。

## 翻訳レビューの観点

日本語ページを英語の原文と突き合わせるときは、訳文が次を満たすことを確認する。

- 原文に無い評価・結論・理由づけを足していない。
- ヘッジ（may・usually・still など）は原文にある場所へそのまま残す。落とさず、勝手に足さない。
- 否定と条件節は書かれたとおりに保つ。条件を理由に読み替えない。
- 見出しは条件まで含めて訳す。
- 複数ページに現れる同一の英文には、どのページでも同一の訳文を当てる。
- 用語表に無い訳語を持ち込まない。
- 訳出後は、東アジア文字幅で数えて 100 桁で折り返し直す。
- 英語のダッシュ（—）を「——」で写さない。括弧への置き換えか文の分割で受ける。

## 匿名性

- 実在するホストプロジェクト名や社名、ホスト固有のコンポーネント名、ローカルの絶対パスは書かない
  （clone のパスは `<repo>` と書く）。例の id は
  `app/components/ui/button#Button` という一般的な形にする。
- 実測は対象を一般化して書き（"a production React design system"）、話題のコンポーネントは説明に
  置き換える（"a charting-library wrapper"）。

## Skill の自己完結

- `skills/yosegi/` は本質的な内容について `docs/` や URL に依存してはならない。`SKILL.md` が案内する先は
  `references/` だけであり、`docs/` と重なる内容は意図的に重複させ、同期は手作業で保つ。
- 編集するのは `skills/yosegi/`。`packages/server/skills/` は生成されたミラーで、絶対に編集しない。

## コミット前のチェック

ページに載せた全コマンドを、このリポジトリの外にある React + TypeScript のホストで実行する。`docs/` の例は
CLI が入っている前提なので、`bin/yosegi.js` 経由で叩く。

```sh
cd <scratch-host>
node <repo>/packages/server/bin/yosegi.js registry build \
  --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --data-dir .yosegi
```

続いてリポジトリルートで次を確認する。リンクとアンカーが解決すること。対のページが揃っている
こと（見出しと表は行数が同じ、フェンスは訳されるコメントを除いて内容まで同じ）。各行が東アジア
文字幅で数えて 100 桁に収まっていること（表・コードブロック・front matter は除く）。

```sh
bun run check:docs
```

スクリプトの実体は `scripts/check-docs.ts` で、CI が push のたびに実行する。

`docs/ja/**` を変更した場合（新規・再翻訳のいずれも）は `bun run textlint` を実行し、指摘を全て直す。
訳文に対する自己レビューであり、指摘が残ったままコミットしない。

最後に `bun lint`。

## 次に読む

- [`AGENTS.md`](../../AGENTS.md) — コード側の規約（英語）。
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — 変更を通すまでの流れ（英語）。
