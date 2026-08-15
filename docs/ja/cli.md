# CLI リファレンス

[English](../cli.md) | 日本語

全コマンドとフラグ。引数なしで `yosegi` を実行すると同じ一覧が短い形で出ます。

## CLI の呼び出し方

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

以下の `yosegi` は `npx yosegi`（`pnpm yosegi`、`yarn yosegi`、`bunx yosegi`）を指します。動作要件
は Node.js 22 以上。Yosegi のリポジトリ内で作業する場合は事情が異なります
（[開発](./development.md)）。

## 全コマンド共通のオプション

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--data-dir <dir>` | path | cwd 直下の `.yosegi` | Registry と保存済み画面の置き場。無ければ作成する。全コマンドへ同じ値を渡す |

繰り返し指定できるフラグ（`--source`、`--query`）はカンマ区切りも受け付けます。glob は必ず
クォートします（しないと CLI へ届く前にシェルが展開します）。

エラーは `error.code` を持つ JSON で返り、終了コードは 1 です。未知のコマンド・フラグは近い候補付き
で拒否され（`UNKNOWN_COMMAND` / `UNKNOWN_FLAG`）、必須引数の不足は `MISSING_ARGUMENT` を返します。
`--help`（`-h`）は usage を表示して終了コード 0、`--version` は `{ "version", "cliPath" }` を返して
終了コード 0 です。

## `registry build`

ホストの TypeScript の型から Component Registry を作ります。

```sh
yosegi registry build --source <glob> --tsconfig <path> [options]
yosegi registry build --index <path|url> [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--source <glob>` | glob | — | ホストのコンポーネントのソース。繰り返し・カンマ区切り可。`*.stories.*` / `*.test.*` は自動で除外 |
| `--tsconfig <path>` | path | — | ホストの tsconfig。`--source` と併用時は必須。`paths` を含む型解決設定をそのまま使う |
| `--project-root <dir>` | path | `--tsconfig` のあるディレクトリ | `--source` の glob とコンポーネント id のモジュールパスの基準。cwd は基準にしない |
| `--index <path\|url>` | path または URL | `--source` も無いときは cwd 直下の `storybook-static/index.json` | Storybook の `index.json`。Story 由来のカテゴリ・`curation.recommended`・Story タイトルが付く |
| `--storybook-url <url>` | URL | — | `--index` の取得元 Storybook のベース URL。ディープリンクを付ける。`--index` 併用時のみ効く |
| `--metadata <file>` | path | — | 型から読めなかったコンポーネントの props を手で補う。`--source` / `--index` どちらの経路でも効く |
| `--import-map <from=to,...>` | string | tsconfig の `paths` | Registry に保存する import specifier を上書きする。ホストの alias が tsconfig に無い場合のみ必要 |
| `--report <path>` | path | — | `{ stats, missed, undocumented, outsideSources }` を書き出す。抽出できなかった export、JSDoc を書く価値のある props（優先順）、`--source` の glob の外から props が参照するホストのファイル。`--source` 経路のみで、`--index` 単独のビルドでは警告なく無視される |
| `--out <path>` | path | `--data-dir` 直下の `registry.json` | Registry の書き出し先。中間ディレクトリは自動作成 |
| `--version <ref>` | string | 内容ハッシュ | Registry の `version` 文字列。Screen JSON が `componentRegistryVersion` へ写す値 |
| `--json` | boolean | `false` | テキスト出力の代わりに `{ out, version, count, stats, warnings, hints }` を単一オブジェクトで返す（`--index` 単独の経路では `stats` は `null`） |

```sh
yosegi registry build \
  --source "app/components/**/*.tsx" \
  --tsconfig ./tsconfig.json \
  --data-dir .yosegi
```

実行の最後に統計が出ます。`files: 0` は glob が 1 件も拾えなかったということ（警告も出ますが、合成プ
リミティブ 3 件入りの Registry はそのまま書き出されます）。`componentCandidates` は React コンポー
ネントと判定した export の件数です。`files` が正なのに 0 なら glob がコンポーネントを 1 つも覆って
いま
せん（警告も出ます。`.tsx` を含んでいるか確認してください）。`withNodeSlots: 0` かつ
`anyShapedProps` が高い場合、`--tsconfig` から `@types/react` が解決できていません。ReactNode の
props は `json` / `shape: any` に劣化し、slot は 1 つも検出されません（警告が直し方を示します）。
`propsUnreadable` が高い場合、渡した tsconfig がホストのものではない可能性が高いです。`props` に
対する `documentedProps` は JSDoc の付いている props の割合です。
`undocumentedRequiredOpaqueProps` は「必須で、リテラルでは値を書けず、どこにも説明が無い」props の
件数です。

`--report` の `undocumented` セクションがその props を列挙します。1 件は
`{ component, prop, kind, priority, recommended, shape? }` の形です。並びは `required-opaque` /
`optional-opaque` / `required-literal` / `optional-literal` の順で、上限 100 件、残りは `omitted`
に件数だけ残ります。上から潰していけば十分です。
[Component Registry](./registry.md#ホスト側が-inspect-を有用にするためにできること) を参照。

import specifier はホストの tsconfig の `paths` から解決するので、Registry は projectRoot 相対
パスではなくホストが書く 1 行（`~/components/button`）を報告します。alias が tsconfig の外に
ある場合だけ `--import-map "./app=~"` を渡します。

`--source` を省くと `--index` 単独で作ります。id は短いまま（`Button`）になり、props は
`--metadata` 頼りになります。[Component Registry](./registry.md) を参照。

## `registry metadata`

ホストの cva（class-variance-authority）の variants から `--metadata` ファイルの雛形を作ります。

```sh
yosegi registry metadata <componentId> [<componentId> ...] --tsconfig <path> [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--tsconfig <path>` | path | — | `--project-root` を渡さない場合は必須 |
| `--project-root <dir>` | path | `--tsconfig` のあるディレクトリ | `registry build` と同じ意味 |
| `--source <glob>` | glob | — | 短い id（`Button`）の場合のみ必要。この範囲から export 名を探す |
| `--out <path>` | path | 標準出力 | 雛形の書き出し先 |

```sh
yosegi registry metadata "app/components/ui/badge#Badge" \
  --tsconfig ./tsconfig.json --out tmp/metadata.json
```

`<module path>#<name>` 形式の id はそのパスから解決するので `--source` は省けます。雛形に入るのは
cva の variants だけで、variants でない props は入りません。実行のたびに `Note:` がそう告げます。

## `registry status`

Registry がホストのソースに対して今も最新かどうかを、作り直さずに報告します。

```sh
yosegi registry status [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--json` | boolean | `false` | テキスト要約ではなくステータスオブジェクト（`version`、`generatedAt`、`builtWith`、`builtWithCliPath`、`inputs`、`runningVersion`、`sourceCheck`、`indexCheck`）を返す |

```sh
yosegi registry status --data-dir .yosegi
```

記録済みの inputs から Registry の内容ハッシュを再計算し、`source: current` または `source: stale`
（作り直しコマンド付き）を返します。inputs が記録されていない Registry や `--version` で固定した
Registry は `source: unknown` を返します。再計算する元が無いためです。2 行目の `index:` 行は
Storybook 由来の層を同じ形式で報告します。ビルド後に recommended フラグや Story リンクが変わって
いれば `stale`、記録した index を読み直せなければ理由付きの `unknown` になります（dev サーバに
届かない場合など）。

## `component list`

登録されているコンポーネントを一覧します。

```sh
yosegi component list [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--category <name>` | string | — | カテゴリで絞り込む |
| `--query <text>` | string | — | id・名前・description への部分一致。繰り返し・カンマ区切り可で、複数語はいずれかに一致すればよい |
| `--json` | boolean | `false` | テキスト要約ではなく Manifest そのものを返す |
| `--quiet` | boolean | `false` | Registry の来歴ヘッダを省く |

```sh
yosegi component list --query card --data-dir .yosegi
```

見出しには使用中の Registry・その生成時刻・作り直すための `registry build` が出ます。この行は結果を
左右する全フラグ（`--storybook-url` を含む）を持つので、そのまま実行すれば同じ version とディープリ
ンクを再現できます。`--json` が返すフィールドは 8 つです。`version`、`generatedAt`、`builtWith`
（生成した Yosegi）、`builtWithCliPath`、`inputs`、`total`、`categories`、`components`。
記録前に作られた Registry は `built: not recorded` になり、実行中の CLI と別バージョンの
Yosegi が作った Registry は両方の版と作り直しコマンドを示す `Warning:` を出します。Registry が実際に
古くなっているかどうかは、この見出しを目で判断せず `registry status`（上記）で確認します。

## `component inspect`

1 コンポーネントの import 文・props（type・required・default・enum の選択肢・description）・slots を
返します。登録されていない id には最も近い候補が返ります。

```sh
yosegi component inspect <componentId> [<componentId> ...] [--json]
```

複数の id を 1 回で渡せます。来歴ヘッダは全体の上に 1 度だけ出て、`--json` は単一オブジェクトでは
なく配列を返します。複数のうち未知の id があれば、残りを出力した上で exit 1 になります。

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--json` | boolean | `false` | テキスト要約ではなく Manifest そのものを返す（id が 2 つ以上なら配列） |
| `--quiet` | boolean | `false` | Registry の来歴ヘッダを省く |

```sh
yosegi component inspect "app/components/ui/button#Button" --data-dir .yosegi
```

## `screen generate`

Screen JSON を Registry と突き合わせて検証し、Story（CSF）を書き出します。`--target component` を
渡すと、素の React コンポーネントファイルを書き出します。

```sh
yosegi screen generate <screen.json> --out <file.stories.tsx> [options]
yosegi screen generate <screen.json> --target component --out <file.tsx> [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--out <path>` | path | — | 必須。Story（またはコンポーネントファイル）の出力先。中間ディレクトリは自動作成 |
| `--target <story\|component>` | string | `story` | 何を出力するか。`component` は Storybook を持たないホスト向けに素の React コンポーネントファイルを書き出す |
| `--title <title>` | string | `Screens/<画面名>` | Story の `title` |
| `--story-name <name>` | string | `story`: `Default`、`component`: `Screen` | Story の export 名。JavaScript の識別子である必要がある。`--target component` では export される関数の名前になる |
| `--import-map <from=to,...>` | string | — | Registry の `packageName` をホストの import 指定子へ前方置換する。生成された import が解決しない場合はここを直す |
| `--framework <pkg>` | string | `@storybook/react` | `Meta` / `StoryObj` の import 元 |
| `--meta-template <file>` | path | — | meta 1 つを持つホストのファイル。`title` と `component` 以外がすべて引き継がれる |
| `--registry <file>` | path | `--data-dir` 直下の `registry.json` | 別の Registry を使う |

```sh
yosegi screen generate tmp/screen.json \
  --out app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" \
  --framework @storybook/react-vite \
  --data-dir .yosegi
```

検証エラーがあれば何も書かず、エラーの配列と終了コード 1 が返ります。警告は `Wrote <path>` の後に
出て、生成は止めません。code の一覧は[ワークフロー](./workflows.md#検証エラーの-code)にあります。

`--target component` は、import 群・fixture の const・画面の状態ごと（ベースと各 variant）の
export された関数 1 つずつを書き出します。このとき `--out` は `.tsx` で終わる必要があります
（`.stories.tsx` を除く）。CSF 専用のフラグ（`--title`・`--framework`・
`--meta-template`）は無視されず、`INVALID_ARGUMENT` で拒否されます。`story import` が読める
のは Story だけなので、コンポーネントファイルは読み戻せません。

## `screen context`

画面を実装へ転換するためのコンテキストを JSON で出します。

```sh
yosegi screen context <screen.json> [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--import-map <from=to,...>` | string | — | `screen generate` と同じ意味。出力される import が Story と一致する |
| `--route <path>` | string | — | 実装が置かれるルート。`target` に返る |
| `--preferred-path <path>` | path | — | 実装ファイルの希望パス。`target` に返る |
| `--out <file.json>` | path | 標準出力 | JSON の書き出し先 |
| `--registry <file>` | path | `--data-dir` 直下の `registry.json` | 別の Registry を使う |

```sh
yosegi screen context tmp/screen.json \
  --import-map "./app=~" --route /customers --data-dir .yosegi
```

出力の読み方は[ワークフロー](./workflows.md#下流-story-を実装へ転換する)にあります。

## `story import`

Story を Screen JSON へ読み戻します。解釈できなかった箇所は `warnings` に載ります。

```sh
yosegi story import <file.stories.tsx> [options]
```

| フラグ | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `--import-map <from=to,...>` | string | — | `screen generate` と同じ向き・同じ値を渡す。読み込み側は逆向きに解釈する |
| `--story-name <name>` | string | `render` を持つ最初の export | どの Story を取るか |
| `--screen-id <id>` | string | ファイル名から `.stories.*` を除いたもの | 生成される画面の id。英数字・`-`・`_` のみ |
| `--screen-name <name>` | string | Story の `title` の末尾セグメント | 画面の名前 |
| `--out <screen.json>` | path | 標準出力 | 指定するとファイルには Screen JSON だけを書き、警告は標準出力へ。省略時は `{ title, storyName, screen, warnings }` がまとめて標準出力へ |
| `--registry <file>` | path | `--data-dir` 直下の `registry.json` | 別の Registry を使う |

```sh
yosegi story import app/components/screens/customer-list.stories.tsx \
  --import-map "./app=~" --out tmp/screen.json --data-dir .yosegi
```

警告の code は[ワークフロー](./workflows.md#story-import-の警告)にあります。

## 画面ストアのコマンド

`--data-dir` に保存された画面を、ファイルパスではなく id で扱います。`screen generate` と
`screen context` はファイルを直接読むので、ストアなしでも使えます。ファイルパスを持たない MCP
ツールのために存在します。

```sh
yosegi screen push <file.json>              # 保存: 新規作成、または revision による更新
yosegi screen list
yosegi screen pull <screenId>               # screen export <screenId> も同じ
yosegi screen validate <screenId>
yosegi screen apply <screenId> <operations.json>
```

`screen validate` の対象は保存済みの画面だけです。Screen JSON ファイルは `screen generate` が実行の
一部として検証します。

## `mcp`

MCP ツールを stdio で提供し、クライアントが切断するまで動き続けます。他のコマンドと同様
`--data-dir` を取ります。

```sh
claude mcp add yosegi -- npx yosegi mcp
```

| MCP ツール | 引数 | CLI の対応 |
| --- | --- | --- |
| `search_components` | `query`, `category`, `detail`, `limit` | `component list` |
| `get_component` | `componentId` | `component inspect` |
| `list_categories` | — | `component list --json` の `categories` フィールド |
| `get_registry_status` | — | `registry status`。ただし provenance のみで、ソースの変化は再計算しない |
| `generate_story` | `root`, `title`, `storyName`, `importMap`, `framework`, `fixtures`, `variants`, `target` | `screen generate`。ただしファイルは書かずソースを文字列で返す |
| `generate_implementation_context` | `screenId`, `route`, `preferredPath`, `importMap` | `screen context`。保存済み画面の id で指定する |
| `validate_screen` | `screenId` | `screen validate` |
| `list_screens` / `get_screen` | — / `screenId` | `screen list` / `screen pull` |
| `create_screen` | `id`, `name`, `root` | `screen push` |
| `apply_screen_operations` | `screenId`, `baseRevision`, `operations` | `screen apply` |
| `duplicate_screen` | `screenId`, `newId`, `newName` | — |

`generate_story` が取る `root` は ScreenNode 単体であって Screen JSON 全体ではありません。
`importMap` は CLI と同じ文字列で、オブジェクトではありません。`target: "component"` は CSF の
代わりに素のコンポーネントファイルを返します。`title`（story ターゲットでは必須）と `framework` は
このターゲットには適用されず、拒否されます。`search_components` は `limit`（既定 50、上限 200）で
打ち切った要約を `total` / `truncated` とともに返し、`detail: "full"` で完全な Manifest を返し
ます。`registry build`・`registry metadata`・`story import` は CLI にしかなく、`--meta-template`
に相当する MCP の口もありません。

## 次に読む

- [ワークフロー](./workflows.md) — これらのコマンドがどうつながるか。
- [Screen JSON](./screen-json.md) — `screen generate` と `screen context` が読む形式。
