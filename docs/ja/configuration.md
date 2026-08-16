# 設定ファイル

[English](../configuration.md) | 日本語

`yosegi.config.json` は、渡さなければ全コマンドがフラグとして受け取るホスト固有のパスを保持します。
任意です。
フラグだけの呼び出しは今までどおり完結しています。

## 探索の規則

```sh
yosegi component list                          # cwd から上方へ探索する
yosegi component list --config ./tools/yosegi.config.json
```

`--config` が無いとき、Yosegi は cwd から親ディレクトリへ順に、ファイルシステムのルートまで `yosegi.config.json` を探します。
tsconfig の解決と同じ規則です。
最初に見つかったものが使われるため、ワークスペースのパッケージがリポジトリのルートを上書きできます。
1 つも見つからないことはエラーではありません。

`--config <path>` は全コマンドが受け付け、探索を省きます。
存在しないパスを指した場合は `CONFIG_NOT_FOUND` で失敗します。

## ファイル内のパスの解決

ファイル内のパスはすべて、cwd ではなくファイル自身のディレクトリを基準に読みます。
コミットした 1 つの config が、ホストのどこから実行しても同じ意味を持つのはこのためです。

`registry.source` は例外です。
この glob は `--source` の glob が元から持っていた基準、すなわち `--project-root`（既定は tsconfig のあるディレクトリ）を保ちます。
その基準はコンポーネント id の導出にも使われます。
ここで書き換えると、ビルドが生成する id まで変わってしまいます。

## スキーマ

```json
{
  "dataDir": ".yosegi",
  "registry": {
    "source": ["app/components/**/*.tsx"],
    "tsconfig": "./tsconfig.json",
    "metadata": "./tools/yosegi-metadata.json"
  },
  "emit": {
    "importMap": ["./app=~"],
    "metaTemplate": "./.storybook/screen-meta.tsx"
  },
  "examples": []
}
```

| キー | 型 | 既定値を与える対象 | 意味 |
| --- | --- | --- | --- |
| `$schema` | string | — | エディタから JSON Schema を指せるように受け付ける。Yosegi は無視し、Schema も同梱しない |
| `dataDir` | path | 全コマンドの `--data-dir` | Registry と保存済み画面の置き場 |
| `registry.source` | glob の配列 | `registry build` の `--source` | このファイルではなく `--project-root` を基準に解決する |
| `registry.tsconfig` | path | `registry build` の `--tsconfig` | 既定の `--project-root` もこれに追随して動く |
| `registry.metadata` | path | `registry build` の `--metadata` | 型から読めなかったコンポーネントの props を手で補う |
| `emit.importMap` | string の配列 | `screen generate` の `--import-map` | 1 要素につき `<from>=<to>` を 1 つ。フラグが取る 1 本の文字列へ連結する |
| `emit.metaTemplate` | path | `screen generate` の `--meta-template` | Story の meta を持たないファイルを書く `--target component` には適用しない |
| `examples` | object の配列 | — | ホストがテンプレートとして持つ画面のカタログ。検証のみで、まだ消費しない |

すべてのキーは任意なので、ホストが必要とする既定値だけを config に書けます。
`examples` の要素は `key`、`label`、`description`、`templatePath`、`componentName` を取り、すべて必須です。
`key` は配列の中で一意である必要があります。

## 優先順位

フラグが config に勝ち、config が組み込みの既定値に勝ちます。
併合はしません。
コマンドラインの `--source` は config の一覧へ追加するのではなく置き換えるため、ビルドを 1 つの glob へ絞り込めます。

```sh
yosegi registry build                          # --source と --tsconfig は config から
yosegi registry build --source "app/ui/**/*.tsx"   # この glob のみ。config の一覧は使わない
```

実際に採用された値が `registry build` の `inputs` に記録されます。
そのため `component list` が表示する再ビルドの行は再現可能なままで、`registry status` はビルドが実際に使った入力から再計算します。
[CLI リファレンス](./cli.md#registry-status)を参照してください。

## 拒否される場合

使えない config はコマンドをその場で失敗させ、いつもの `error.code` を持つ JSON と終了コード 1 を返します。
警告へ格下げすることはありません。
呼び出し側が効いていると信じている設定が実際には効いていない状態こそ、このファイルが避けなければならない失敗のかたちだからです。

| code | 原因 |
| --- | --- |
| `CONFIG_NOT_FOUND` | `--config` が存在しないファイルを指した。探索で見つからないことはエラーではない |
| `CONFIG_INVALID` | 解析できない JSON、型の違う値、スキーマが知らないキー、`examples` の重複キー |

未知のキーは `UNKNOWN_FLAG` と同じように最も近い候補を添えて返ります。
壊れた config は上方探索も止めます。
読み飛ばして先へ進むことはしません。

このファイルはただの JSON なので、読むために TypeScript のコンパイラ API は要りません。
コンパイラ無しで動くコマンドは、そのまま無しで動き続けます。

## 次に読むもの

- [CLI リファレンス](./cli.md) — 全コマンドとフラグ。
- [はじめに](./getting-started.md) — これらの既定値が短くする手順。
