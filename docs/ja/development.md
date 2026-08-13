# 開発

[English](../development.md) | 日本語

Yosegi 自体の開発について。monorepo の構成、開発中に叩くコマンド、公開前の検証方法を扱う。
コントリビューションの作法は [`CONTRIBUTING.md`](../../CONTRIBUTING.md)（英語）にある。

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
bin を持つため。ディレクトリ名が `server` のままなのは、配布物ではなくレイヤを表す名前だから。型抽出
（react-docgen-typescript）と AST 解析はこちらに置き、core は zod のみに保つ。

## Agent Skill の置き場所

正となるのはリポジトリルートの `skills/yosegi/`（`SKILL.md` と、そこから開かれる `references/`）で、
編集してよいのはここだけ。`npx skills add <owner>/<repo>` 系のインストーラはリポジトリ内の
`skills/<name>/SKILL.md` を探すので、この場所から動かせない。

`@yosegi/yosegi` にも同梱する。`node_modules` からコピーしたい利用者向け。`files` はパッケージディレ
クトリの外へ届かないため、`packages/server/scripts/sync-skills.ts` がルートの `skills/` を
`packages/server/skills/` へコピーする。これは生成物であり gitignore 対象で、`bun run build` とパッ
ケージの `prepack` の両方が更新する。`files` は `.gitignore` に優先するので、追跡されていなくても
tarball には入り、公開されたコピーが古くなることはない。

```sh
bun run sync:skills                                # ミラーを更新する（リポジトリルートから）
bun --filter '@yosegi/yosegi' sync:skills:check    # 書き換えずに差分だけ報告する
```

`packages/server/skills/` は絶対に編集しない。次の同期で捨てられる。

## コマンド

```sh
bun install

bun test        # 全パッケージ、その後 scripts/
bun typecheck
bun lint        # 自動修正は bun lint:fix
bun run build   # @yosegi/core → @yosegi/yosegi の依存順
bun run pack    # リリースが公開する tarball を、検証付きで作る
```

各パッケージは `tsc` で `dist/`（JS と `.d.ts`）を出し、`package.json` の `exports` はそこを指す。
開発中は各パッケージの `tsconfig.json` の `paths` が `@yosegi/*` をソースへ解決するので、ビルド
無しでも `bun test` と `tsc` が通る。

`scripts/` は workspaces の外にあるため `bun --filter` は届かない。ルートの `bun test` と
`bun typecheck` が拾う。

CI（`.github/workflows/ci.yml`）は push・Pull Request・週次で lint / test / typecheck / build
を回す。

## 依存バージョンの管理

複数パッケージが使うバージョンはルート `package.json` の `catalog` に一度だけ書き、各パッケージは
`"catalog:"` で参照する。現在は `zod` だけ（core と server）。1 パッケージしか使わない依存はその
パッケージに置く。

公開パッケージが利用者へ露出する依存は、固定ではなくレンジにする。`zod` は core の `.d.ts` に構造的
な形で現れ利用者側のコピーと単一化する必要があるため、`typescript` はホストが既に持っており固定する
と 23MB のコピーがもう 1 つ入れ子になるため。ルートの `typescript` は devDependency として固定の
まま。`dist` を作るコンパイラそのものだからである。

`bunfig.toml` は `install.linker = "isolated"` を設定しており、hoist されない `node_modules`
になる。各パッケージは自分が宣言したものしか見えない。hoist された配置では、他が引き込んでいる限り未
宣言の依存も解決してしまい、その間違いは、利用者が公開された tarball を当の依存を持たないツリーへイ
ンストールした時点で初めて表面化する。

## このリポジトリからホストに対して CLI を動かす

```sh
bun --filter '@yosegi/yosegi' cli <command>
```

cwd が `packages/server` になるので相対パスはその分ずれる。
`bun run build && node packages/server/bin/yosegi.js <command>` ならビルド成果物のほうを叩ける。公開
された `yosegi` コマンドが実際に動かすのはこちら。

`bin/yosegi.js` はパッケージの `exports` を経由せず `dist/adapters/cli/cli.js` を直接 import する。
公開 API は HTTP アダプタと MCP サーバも再 export しているので、経由すると CLI を 1 回叩くたびに
hono と MCP SDK まで読み込まれるため。

shebang は `node` で、利用者に必要なのは Node.js 20 以上だけ。これが成り立つのは、`src/` の相対
import が明示的に `.ts` 拡張子を持ち、ビルド用 tsconfig が `rewriteRelativeImportExtensions` を設定
しているから。`dist` は Node の ESM リゾルバが要求する `.js` 拡張子を持つ形になる。どちらか片方でも
欠けると Bun でしか読めない成果物になり、それを捕まえるのが `node-consumer` の CI ジョブ。

## 公開前の検証

`bun run build` が通っても、公開されるものが実際に動く保証にはならない。`files` の指定により tarball
は各パッケージの一部しか含まないためである。workspace の外から検証する。

```sh
bun run pack <tmp>          # tarball のパスを公開順に出力する

cd <a scratch project outside this repo>
npm install <tmp>/yosegi-core-0.1.0.tgz <tmp>/yosegi-yosegi-0.1.0.tgz
```

tarball を作る手段は `bun run pack`（`scripts/pack.ts`）だけで、CI とリリースワークフローもこれを通
る。パッケージのディレクトリで `npm publish` してはいけない。npm は Bun の `catalog:` を解決できず
リテラル文字列のまま固めてしまい、利用者の install がすべて EUNSUPPORTEDPROTOCOL で落ちる
（`npm publish --dry-run` は警告しない）。スクリプトは `catalog:` や `workspace:` が残った tarball、
および自身の `exports` / `bin` / `main` / `types` が指すファイルを含まない tarball の出力を
拒否する。

インストールは Bun ではなく npm で行う。利用者に必要なのは Node だけなので、Bun で入ることは利用者が
入れられることの証明にならない。この経路は `node-consumer` の CI ジョブが毎 push で通しているため、
手でやるのはパッケージング自体を変更したときだけでよい。

検証中のバージョンが npm に無いあいだ、この install は失敗する。server の tarball が `@yosegi/core`
を厳密なバージョンで要求し、npm レジストリが 404 を返すため。検証のあいだだけローカルの tarball を指
す。

```json
"overrides": { "@yosegi/core": "file:<tmp>/yosegi-core-0.1.0.tgz" }
```

そのうえで、作業用プロジェクト側で次を確認する。

- `@yosegi/core` とそのサブパス（`/app`・`/emit`・`/registry`）が import でき、型も解決する。
- `node ./node_modules/.bin/yosegi` が動き usage を出す（引数なしでは終了コード 1 になるが、それは
  usage エラー。重要なのは Node が `dist` を読めたこと）。
- `node_modules/@yosegi/yosegi/skills/yosegi/` に `SKILL.md` と `references/` の**両方**がある。
  references が欠けた Skill は使い物にならない。
- `node_modules/@yosegi/yosegi/package.json` の `@yosegi/core` 依存は `workspace:*` でなく公開する
  バージョンになっている。`zod` も `catalog:` でなく実際のバージョンになっている。

最後の 2 つは毎回確認する価値がある。`bun pm pack` は `workspace:*` と `catalog:` の両方を実際の
バージョンへ置換する。ただし、その値を取るのは `package.json` ではなく `bun.lock` から。
バージョンを上げたりルートの `catalog` を書き換えたりしても `bun install` を回していなければ、
古い値、あるいは存在しないバージョンがそのまま固められ、何の警告も出ない。だから
`packages/server/package.json` の `@yosegi/core` は明示的なバージョンに固定し、`bun.lock` はバージョ
ンや catalog の変更と同じコミットで更新する。

## バージョニング

1.0 未満のあいだは、マイナーバージョンにも破壊的変更が入り得る。2 つのパッケージはバージョンを
揃えて上げ、`@yosegi/yosegi` は厳密に一致するバージョンの `@yosegi/core` を要求する。

## 公開

`.github/workflows/release.yml` が `v*` タグで両パッケージを公開する。npm の認証は
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC）で行うため、このリポジトリに
npm のトークンは一切無いし、今後も置いてはいけない。publish ジョブの `id-token: write` 権限が認証手
段のすべてである。あわせて provenance の証明書も生成される。公開された tarball がこのリポジトリのそ
のコミットから来たことを誰でも検証できるのはこれによる。

リリースは npm への公開だけ。ワークフローは GitHub Release を作らず、リリースノートも生成しない。
記録として残るのはタグとコミット履歴。

### 初回のみのセットアップ（オーナーのみ）

以下はリポジトリからは実行できない。スコープに対する権限を持つ npm アカウントが必要になる。

1. npm に `yosegi` organization（スコープ）を作る。スコープ付きパッケージは既定で restricted
   なので、両パッケージとも `publishConfig.access` を `public` にしている。
2. GitHub リポジトリを public にする。provenance が生成されるのは、public リポジトリが public
   パッケージを公開する場合だけ。
3. **各パッケージごとに** Trusted Publisher を設定する。
   `https://www.npmjs.com/package/@yosegi/core/access` と、`@yosegi/yosegi` の同じページ:
   - Organization or user: `yosegi-dev`
   - Repository: `yosegi`
   - Workflow filename: `release.yml`
   - Allowed actions: `npm publish`（2026-05-20 以降に作った設定では明示的に選ぶ必要がある。それ以前
     は既定で有効だった）

   このページはパッケージ単位なので、パッケージが存在して初めて現れる。一度も公開されていない名前に
   Publisher を設定できない場合は、`0.1.0` だけ手で公開し（`bun run pack` してから core、続いて
   `@yosegi/yosegi` の順に `npm publish <tarball>`）、Trusted Publisher を設定して次のリリースから
   ワークフローに任せる。いずれにせよ core を先に公開する。

### 各リリース

1. 両方の `package.json` の `version` と、`packages/server/package.json` の `@yosegi/core` 依存を
   上げる。続けて `bun install` を回し、`bun.lock` に新しいバージョンを記録させる。これらがタグと
   食い違っているとワークフローは公開を拒否する。
2. コミットし、タグを打って push する:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

ワークフローはまず lint / test / typecheck / build を回し、そのうえで core、続いて server
を公開する。順序は重要で、server は core を厳密なバージョンで要求するため、2 つの publish の間に入っ
た install は解決に失敗する。

## 次に読む

- [ロードマップ](./ROADMAP.md) — 予定している作業と未決の設計論点。
- [`AGENTS.md`](../../AGENTS.md) —
  コーディングエージェントとしてこのリポジトリで作業する場合（英語）。
- [ドキュメント規約](./conventions.md) — ページを編集する前に。
