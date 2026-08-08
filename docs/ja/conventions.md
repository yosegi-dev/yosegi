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
| 部品のカタログ | Component Registry、短くは "the registry" | Component Registry、短くは「Registry」 | 台帳, コンポーネント一覧, "component index" |
| 中間表現のツリー | Screen JSON | Screen JSON | Screen Definition, 画面定義, "screen spec" |
| `Text` / `Box` / `Heading` | synthetic primitives | 合成プリミティブ | built-ins, fallback components |
| Yosegi を走らせる対象のプロジェクト | the host | ホスト | your project, the client, the consumer app |
| 成果物 | Story（大文字始まり）、フォーマットは CSF | Story, CSF | story file, snapshot |
| インストールされるパッケージ | `@yosegi/yosegi` | `@yosegi/yosegi` | `@yosegi/server` — これはディレクトリ名でパッケージ名ではない |
| 手順をまとめた単位 | Agent Skill、短くは "the skill" | Agent Skill、短くは「Skill」 | plugin, prompt pack |

## 英語 / 日本語の対応

英語が正。ページや差分はまず英語で書き、そのあと日本語へ訳し、両方を同じコミットに載せる。訳した日本語は
`docs/ja/**` を対象に `bun run textlint`（`.textlintrc.json`）でチェックする。英語ページは対象外。

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

続いてリポジトリルートで、リンクとアンカーが解決すること、対のページが揃っていることを確認する。

```sh
python3 - <<'PY'
import pathlib, re, sys

md = sorted(pathlib.Path(".").glob("*.md")) + sorted(pathlib.Path("docs").glob("**/*.md"))
raw = {f: f.read_text() for f in md}
prose = {f: re.sub(r"^`{3}.*?^`{3}", "", t, flags=re.M | re.S) for f, t in raw.items()}
links = {f: re.sub(r"`[^`]*`", "", p) for f, p in prose.items()}
slug = lambda h: re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", h.strip().lower()))
heads = {f.resolve(): [slug(m) for m in re.findall(r"^#+\s+(.*)$", p, re.M)] for f, p in prose.items()}
bad = []
for f in md:
	for link in re.findall(r"\]\((?!https?:|mailto:)([^)\s]+)\)", links[f]):
		path, _, anchor = link.partition("#")
		target = (f.parent / path if path else f).resolve()
		if not target.exists():
			bad.append(f"{f}: missing file -> {link}")
		elif anchor and anchor not in heads.get(target, []):
			bad.append(f"{f}: missing anchor -> {link}")
for en in md:
	if en.parent.name == "ja" or not (en.parent.name == "docs" or en.name == "README.md"):
		continue
	ja = en.parent / "README.ja.md" if en.name == "README.md" else en.parent / "ja" / en.name
	if not ja.exists():
		bad.append(f"{en}: no Japanese twin")
	else:
		for label, pat, src in (("headings", r"^#+\s", prose), ("fences", r"^`{3}", raw), ("table rows", r"^\|", prose)):
			a, b = (len(re.findall(pat, src[p], re.M)) for p in (en, ja))
			if a != b:
				bad.append(f"{en.name} vs {ja.name}: {label} {a} != {b}")
print("\n".join(bad) or "docs ok")
sys.exit(1 if bad else 0)
PY
```

`docs/ja/**` を変更した場合（新規・再翻訳のいずれも）は `bun run textlint` を実行し、指摘を全て直す。
訳文に対する自己レビューであり、指摘が残ったままコミットしない。

最後に `bun lint`。

## 次に読む

- [`AGENTS.md`](../../AGENTS.md) — コード側の規約（英語）。
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — 変更を通すまでの流れ（英語）。
