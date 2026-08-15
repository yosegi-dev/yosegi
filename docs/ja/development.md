# 開発

[English](../development.md) | 日本語

Yosegi 自体の開発について。monorepo の構成、開発中に叩くコマンド、公開前の検証方法を扱います。
コントリビューションの作法は [`CONTRIBUTING.md`](../../CONTRIBUTING.md)（英語）にあります。

## パッケージ構成（Bun workspaces の monorepo）

- `packages/core` — `@yosegi/core`。フレームワーク非依存で、依存は zod のみ。
  - `.` … domain（Screen JSON のスキーマ、Validator、合成プリミティブ、候補提示）
  - `./app` … application（Composer / Service / Repository / ActorContext / 実装コンテキスト）
  - `./emit` … Screen JSON → CSF（`.stories.tsx`）
  - `./registry` … Storybook の index.json → Registry の正規化
  - `./testing` … テスト用フィクスチャ
- `packages/server` — `@yosegi/yosegi`。CLI / MCP / HTTP(Hono) アダプタと永続化。core の薄い
  ラッパー。`bin/yosegi.js` が唯一のコマンド入口。
  - `src/registry/source-registry.ts` … TypeScript の型からの Registry 生成
  - `src/importer/story-importer.ts` … Story（AST）→ Screen JSON

公開名が `@yosegi/yosegi` なのは、利用者がインストールするただ 1 つのパッケージであり `yosegi` の
bin を持つためです。ディレクトリ名が `server` のままなのは、配布物ではなくレイヤを表す名前だから
です。型抽出（react-docgen-typescript）と AST 解析はこちらに置き、core は zod のみに保ちます。

## Agent Skill の置き場所

正となるのはリポジトリルートの `skills/yosegi/`（`SKILL.md` と、そこから開かれる `references/`）で、
編集してよいのはここだけです。`npx skills add <owner>/<repo>` 系のインストーラはリポジトリ内の
`skills/<name>/SKILL.md` を探すので、この場所から動かせません。

`@yosegi/yosegi` にも同梱します。`node_modules` からコピーしたい利用者向けです。`files` はパッケー
ジディレクトリの外へ届かないため、`packages/server/scripts/sync-skills.ts` がルートの `skills/` を
`packages/server/skills/` へコピーします。これは生成物であり gitignore 対象で、`bun run build` と
パッケージの `prepack` の両方が更新します。`files` は `.gitignore` に優先するので、追跡されていなく
ても tarball には入り、公開されたコピーが古くなることはありません。

```sh
bun run sync:skills                                # ミラーを更新する（リポジトリルートから）
bun --filter '@yosegi/yosegi' sync:skills:check    # 書き換えずに差分だけ報告する
```

`packages/server/skills/` は絶対に編集しません。次の同期で捨てられます。

## コマンド

```sh
bun install

bun test        # 全パッケージ、その後 scripts/
bun typecheck
bun lint        # 自動修正は bun lint:fix
bun run build   # @yosegi/core → @yosegi/yosegi の依存順
bun run pack    # リリースが公開する tarball を、検証付きで作る
```

各パッケージは `tsc` で `dist/`（JS と `.d.ts`）を出し、`package.json` の `exports` はそこを指し
ます。開発中は各パッケージの `tsconfig.json` の `paths` が `@yosegi/*` をソースへ解決するので、
ビルド無しでも `bun test` と `tsc` が通ります。

`scripts/` は workspaces の外にあるため `bun --filter` は届きません。ルートの `bun test` と
`bun typecheck` が拾います。

CI（`.github/workflows/ci.yml`）は push・Pull Request・週次で lint / test / typecheck / build
を回します。

## 依存バージョンの管理

複数パッケージが使うバージョンはルート `package.json` の `catalog` に一度だけ書き、各パッケージは
`"catalog:"` で参照します。現在は `zod` だけです（core と server）。1 パッケージしか使わない依存は
そのパッケージに置きます。

公開パッケージが利用者へ露出する依存は、固定ではなくレンジにします。`zod` は core の `.d.ts` に構造
的な形で現れ利用者側のコピーと単一化する必要があるため、`typescript` はホストが既に持っており固定
すると 23MB のコピーがもう 1 つ入れ子になるためです。ルートの `typescript` は devDependency として
固定のままです。`dist` を作るコンパイラそのものだからです。

`bunfig.toml` は `install.linker = "isolated"` を設定しており、hoist されない `node_modules`
になります。各パッケージは自分が宣言したものしか見えません。hoist された配置では、他が引き込んでい
る限り未宣言の依存も解決してしまい、その間違いは、利用者が公開された tarball を当の依存を持たない
ツリーへインストールした時点で初めて表面化します。

この linker は、ここでは import していない 5 つのパッケージをルートが宣言している理由でもあります。
`@braintree/sanitize-url`・`cytoscape`・`cytoscape-cose-bilkent`・`dayjs`・`debug` の 5 つです。
いずれも mermaid の依存で、`vitepress-plugin-mermaid` がこれらを Vite の `optimizeDeps.include`
に入れます。その解決はルートから行われます。これらが無いと `docs:dev` は起動しますが図がすべて空に
なります。`docs:build` は影響を受けないので、確認は図のあるページを開いて行います。

## このリポジトリからホストに対して CLI を動かす

```sh
bun --filter '@yosegi/yosegi' cli <command>
```

cwd が `packages/server` になるので相対パスはその分ずれます。
`bun run build && node packages/server/bin/yosegi.js <command>` ならビルド成果物のほうを叩けます。
公開された `yosegi` コマンドが実際に動かすのはこちらです。

`bin/yosegi.js` はパッケージの `exports` を経由せず `dist/adapters/cli/cli.js` を直接 import し
ます。公開 API は HTTP アダプタと MCP サーバも再 export しているので、経由すると CLI を 1 回叩く
たびに hono と MCP SDK まで読み込まれるためです。

shebang は `node` で、利用者に必要なのは Node.js 22 以上だけです。これが成り立つのは、`src/` の相対
import が明示的に `.ts` 拡張子を持ち、ビルド用 tsconfig が `rewriteRelativeImportExtensions` を設定
しているからです。`dist` は Node の ESM リゾルバが要求する `.js` 拡張子を持つ形になります。どちらか
片方でも欠けると Bun でしか読めない成果物になり、それを捕まえるのが `node-consumer` の CI ジョブ
です。

## 公開前の検証

`bun run build` が通っても、公開されるものが実際に動く保証にはなりません。`files` の指定により
tarball は各パッケージの一部しか含まないためです。workspace の外から検証します。

```sh
bun run pack <tmp>          # tarball のパスを公開順に出力する

cd <a scratch project outside this repo>
npm install <tmp>/yosegi-core-0.1.0.tgz <tmp>/yosegi-yosegi-0.1.0.tgz
```

tarball を作る手段は `bun run pack`（`scripts/pack.ts`）だけで、CI とリリースワークフローもこれを
通ります。パッケージのディレクトリで `npm publish` してはいけません。npm は Bun の `catalog:` を
解決できずリテラル文字列のまま固め、利用者の install がすべて EUNSUPPORTEDPROTOCOL で落ちます
（`npm publish --dry-run` は警告しません）。スクリプトは `catalog:` や `workspace:` が残った
tarball、および自身の `exports` / `bin` / `main` / `types` が指すファイルを含まない tarball の出力
を拒否します。

インストールは Bun ではなく npm で行います。利用者に必要なのは Node だけなので、Bun で入ることは
利用者が入れられることの証明になりません。この経路は `node-consumer` の CI ジョブが毎 push で通して
いるため、手でやるのはパッケージング自体を変更したときだけでかまいません。

検証中のバージョンが npm に無いあいだ、この install は失敗します。server の tarball が
`@yosegi/core` を厳密なバージョンで要求し、npm レジストリが 404 を返すためです。検証のあいだだけ
ローカルの tarball を指します。

```json
"overrides": { "@yosegi/core": "file:<tmp>/yosegi-core-0.1.0.tgz" }
```

そのうえで、作業用プロジェクト側で次を確認します。

- `@yosegi/core` とそのサブパス（`/app`・`/emit`・`/registry`）が import でき、型も解決します。
- `node ./node_modules/.bin/yosegi` が動き usage を出します（引数なしでは終了コード 1 になります
  が、それは usage エラーです。重要なのは Node が `dist` を読めたことです）。
- `node_modules/@yosegi/yosegi/skills/yosegi/` に `SKILL.md` と `references/` の**両方**があります。
  references が欠けた Skill は使い物になりません。
- `node_modules/@yosegi/yosegi/package.json` の `@yosegi/core` 依存は `workspace:*` でなく公開する
  バージョンになっています。`zod` も `catalog:` でなく実際のバージョンになっています。

最後の 2 つは毎回確認する価値があります。`bun pm pack` は `workspace:*` と `catalog:` の両方を実際
のバージョンへ置換します。ただし、その値を取るのは `package.json` ではなく `bun.lock` からです。
バージョンを上げたりルートの `catalog` を書き換えたりしても `bun install` を回していなければ、
古い値、あるいは存在しないバージョンがそのまま固められ、何の警告も出ません。だから
`packages/server/package.json` の `@yosegi/core` は明示的なバージョンに固定し、`bun.lock` はバー
ジョンや catalog の変更と同じコミットで更新します。

## バージョニング

1.0 未満のあいだは、マイナーバージョンにも破壊的変更が入り得ます。2 つのパッケージはバージョンを
揃えて上げ、`@yosegi/yosegi` は厳密に一致するバージョンの `@yosegi/core` を要求します。

## 公開

`.github/workflows/release.yml` が `v*` タグで両パッケージを公開します。npm の認証は
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC）で行うため、このリポジトリに
npm のトークンは一切無く、今後も置いてはいけません。publish ジョブの `id-token: write` 権限が認証
手段のすべてです。あわせて provenance の証明書も生成されます。公開された tarball がこのリポジトリの
そのコミットから来たことを誰でも検証できるのはこれによります。

リリースは npm への公開だけです。ワークフローは GitHub Release を作らず、リリースノートも生成し
ません。
記録として残るのはタグとコミット履歴です。

### 初回のみのセットアップ（オーナーのみ）

以下はリポジトリからは実行できません。スコープに対する権限を持つ npm アカウントが必要になります。

1. npm に `yosegi` organization（スコープ）を作ります。スコープ付きパッケージは既定で restricted
   なので、両パッケージとも `publishConfig.access` を `public` にしています。
2. GitHub リポジトリを public にします。provenance が生成されるのは、public リポジトリが public
   パッケージを公開する場合だけです。
3. **各パッケージごとに** Trusted Publisher を設定します。
   `https://www.npmjs.com/package/@yosegi/core/access` と、`@yosegi/yosegi` の同じページ:
   - Organization or user: `yosegi-dev`
   - Repository: `yosegi`
   - Workflow filename: `release.yml`
   - Allowed actions: `npm publish`（2026-05-20 以降に作った設定では明示的に選ぶ必要があります。
     それ以前は既定で有効でした）

   このページはパッケージ単位なので、パッケージが存在して初めて現れます。一度も公開されていない名前
   に Publisher を設定できない場合は、`0.1.0` だけ手で公開し（`bun run pack` してから core、続いて
   `@yosegi/yosegi` の順に `npm publish <tarball>`）、Trusted Publisher を設定して次のリリースから
   ワークフローに任せます。いずれにせよ core を先に公開します。

### 各リリース

1. バージョンが記録されている箇所をまとめて上げ、1 つのコミットにします。

   | 対象 | 場所 |
   | --- | --- |
   | 各パッケージ自身のバージョン | 両方の `package.json` の `version` |
   | 両者のあいだの固定 | `packages/server/package.json` の `@yosegi/core` 依存 |
   | `bun pm pack` が置換に使う値 | `bun install` 経由で `bun.lock` |

   これらがタグと食い違っているとワークフローは公開を拒否します。ソースにバージョンを書いた箇所は
   ありません。`yosegiVersion()`（`packages/server/src/config.ts`）が `package.json` を読み、CLI の
   `--version`、Registry の `builtWith`、MCP サーバの `initialize` の応答はすべてこれを通ります。
   新しいリテラルが増えていないかがレビューで見る点です。`skills/yosegi/SKILL.md` はバージョンでは
   なく日付を持ちますが、これはリリースではなく Skill の内容を最後に変えた時点を指します。
2. コミットし、タグを打って push します:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

ワークフローはまず lint / test / typecheck / build を回し、そのうえで core、続いて server
を公開します。順序は重要で、server は core を厳密なバージョンで要求するため、2 つの publish の間に
入った install は解決に失敗します。

## 次に読む

- [ロードマップ](./ROADMAP.md) — 予定している作業と未決の設計論点。
- [`AGENTS.md`](../../AGENTS.md) —
  コーディングエージェントとしてこのリポジトリで作業する場合（英語）。
- [ドキュメント規約](./conventions.md) — ページを編集する前に。
