import { describe, expect, it } from "bun:test";
import { type ComponentManifest, parseComponentManifest } from "@yosegi/core";
import {
	type ComponentListSummary,
	formatComponentInspect,
	formatComponentList,
	formatRegistryHeader,
	formatRegistryStatus,
	formatRegistryVersionWarning,
	summarizePropKind,
} from "./format.ts";

function button(overrides: Partial<ComponentManifest> = {}): ComponentManifest {
	return parseComponentManifest({
		id: "app/components/shadcn-ui/button#Button",
		name: "Button",
		category: "shadcn-ui",
		import: {
			packageName: "app/components/shadcn-ui/button",
			exportName: "Button",
		},
		props: {
			variant: {
				kind: "enum",
				options: ["default", "destructive", "outline"],
				defaultValue: "default",
			},
			label: { kind: "string", required: true },
			className: { kind: "string" },
			onClick: { kind: "function", editable: false },
		},
		slots: { children: {} },
		curation: { recommended: true, storyTitle: "Components/Button" },
		...overrides,
	});
}

function listSummary(
	overrides: Partial<ComponentListSummary> = {},
): ComponentListSummary {
	return {
		shown: 1,
		total: 1,
		filters: [],
		registry: { version: "src:abc123", generatedAt: null, inputs: null },
		...overrides,
	};
}

describe("summarizePropKind", () => {
	it("enum は選択肢の数を添える", () => {
		expect(summarizePropKind({ kind: "enum", options: ["a", "b", "c"] })).toBe(
			"enum(3)",
		);
	});

	it("enum 以外は kind をそのまま返す", () => {
		expect(summarizePropKind({ kind: "boolean" })).toBe("boolean");
	});
});

describe("formatComponentList", () => {
	it("id・カテゴリ・推奨・props 要約・slots を出す", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				shown: 1,
				total: 12,
			}),
		);
		expect(output).toContain("1 of 12 components");
		expect(output).toContain(
			"app/components/shadcn-ui/button#Button [shadcn-ui] recommended",
		);
		expect(output).toContain("props: label:string*");
		expect(output).toContain("variant:enum(3)");
		expect(output).toContain("slots: children");
	});

	// Overlooking a required prop stops generation at validation, so it's put first even in the summary.
	it("必須 props を先頭に並べる", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				shown: 1,
			}),
		);
		const propsLine = output
			.split("\n")
			.find((line) => line.includes("props:")) as string;
		expect(propsLine.indexOf("label:string*")).toBeLessThan(
			propsLine.indexOf("variant:enum(3)"),
		);
	});

	it("props が多いときは件数だけ示して inspect へ誘導する", () => {
		const manyProps: ComponentManifest["props"] = Object.fromEntries(
			Array.from({ length: 12 }, (_, i) => [
				`prop${i}`,
				{ kind: "string" } as const,
			]),
		);
		const output = formatComponentList(
			[button({ props: manyProps })],
			listSummary({
				shown: 1,
			}),
		);
		expect(output).toContain("(+4 more)");
	});

	it("フィルタ条件を見出しに書く", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				shown: 1,
				total: 30,
				filters: ["category=shadcn-ui", "query=button"],
			}),
		);
		expect(output).toContain(
			"1 of 30 components matching category=shadcn-ui query=button",
		);
	});

	// When there are zero results, make it clear whether the registry is empty or the filter is too narrow.
	it("0 件のときは次の手を案内する", () => {
		const output = formatComponentList(
			[],
			listSummary({
				shown: 0,
				total: 30,
				filters: ["query=zzz"],
			}),
		);
		expect(output).toContain("0 of 30 components");
		expect(output).toContain("No matches");
	});

	it("props も slots も無い部品は - で埋める", () => {
		const output = formatComponentList(
			[button({ props: {}, slots: {} })],
			listSummary({
				shown: 1,
			}),
		);
		expect(output).toContain("props: -");
		expect(output).toContain("slots: -");
	});
});

// Whether the registry is stale can't be judged from version alone. Since list is the
// command an agent runs first, that single output should also reveal when and from what it
// was built.
describe("formatComponentList の台帳の出所", () => {
	it("version と生成時刻を見出しに出す", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				registry: {
					version: "src:abc123",
					generatedAt: "2026-08-09T01:02:03.000Z",
					inputs: null,
				},
			}),
		);
		expect(output).toContain(
			"registry src:abc123  built 2026-08-09T01:02:03.000Z",
		);
	});

	it("記録された入力から再ビルドのコマンドを組み立てる", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				registry: {
					version: "src:abc123",
					generatedAt: "2026-08-09T01:02:03.000Z",
					inputs: {
						sources: ["app/components/**/*.tsx"],
						tsconfig: "./tsconfig.json",
						index: "http://localhost:6006/index.json",
					},
				},
			}),
		);
		expect(output).toContain(
			'rebuild: yosegi registry build --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --index http://localhost:6006/index.json',
		);
	});

	// Even a registry with no recorded inputs (built before this feature existed) should
	// still leave a hint that it might be stale.
	it("生成時刻が無ければ再ビルドを促す", () => {
		const output = formatComponentList([button()], listSummary());
		expect(output).toContain("built: not recorded (rebuild to record it)");
		expect(output).not.toContain("rebuild: yosegi");
	});

	// --quiet drops the whole provenance block (count line included) for a caller reading
	// many components in a row that has already seen it once.
	it("quiet オプションで台帳の出所と件数見出しを両方省く", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				shown: 1,
				total: 12,
				registry: {
					version: "src:abc123",
					generatedAt: "2026-08-09T01:02:03.000Z",
					inputs: null,
				},
			}),
			{ quiet: true },
		);
		expect(output).not.toContain("1 of 12 components");
		expect(output).not.toContain("registry src:abc123");
		expect(output).toContain(
			"app/components/shadcn-ui/button#Button [shadcn-ui] recommended",
		);
	});

	it("quiet オプションでも 0 件のときの案内は出す", () => {
		const output = formatComponentList(
			[],
			listSummary({ shown: 0, total: 30 }),
			{
				quiet: true,
			},
		);
		expect(output).not.toContain("0 of 30 components");
		expect(output).toContain("No matches");
	});

	// In an environment spanning multiple checkouts, the reader can't tell which path the
	// `yosegi` in the rebuild line refers to. Print it as-is whenever it's known.
	it("作った CLI の絶対パスを built と rebuild の間に出す", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				registry: {
					version: "src:abc123",
					generatedAt: "2026-08-09T01:02:03.000Z",
					inputs: { sources: ["app/components/**/*.tsx"] },
					cliPath: "/checkout/packages/server/bin/yosegi.js",
				},
			}),
		);
		expect(output).toContain("cli: /checkout/packages/server/bin/yosegi.js");
	});

	// A registry built before this was recorded has no cliPath. Handle it gracefully rather
	// than failing — simply omit the cli line.
	it("cliPath が無ければ cli 行を出さない", () => {
		const output = formatComponentList([button()], listSummary());
		expect(output).not.toContain("cli:");
	});

	// Don't drop any flag that affects the content, so typing the rebuild line verbatim
	// reproduces the same registry. Dropping storybook-url loses the deep links and even
	// changes the version hash.
	it("再ビルドのコマンドに storybook-url などの全フラグを含める", () => {
		const output = formatComponentList(
			[button()],
			listSummary({
				registry: {
					version: "src:abc123",
					generatedAt: "2026-08-09T01:02:03.000Z",
					inputs: {
						sources: ["app/components/**/*.tsx"],
						tsconfig: "./tsconfig.json",
						projectRoot: "./app",
						index: "http://localhost:6006/index.json",
						storybookUrl: "http://localhost:6006",
						version: "v1.2.3",
						metadata: "./meta.json",
						report: "tmp/report.json",
					},
				},
			}),
		);
		expect(output).toContain(
			'rebuild: yosegi registry build --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --project-root ./app --index http://localhost:6006/index.json --storybook-url http://localhost:6006 --version v1.2.3 --metadata ./meta.json --report tmp/report.json',
		);
	});
});

// Neither the version itself (a content hash) nor generatedAt can detect "an older Yosegi
// is missing newer fields". Only formatRegistryVersionWarning can say that.
describe("formatRegistryVersionWarning", () => {
	it("実行中の CLI と一致すれば黙る（null）", () => {
		expect(
			formatRegistryVersionWarning(
				{ builtWith: "0.1.0", inputs: null },
				"0.1.0",
			),
		).toBeNull();
	});

	it("食い違えば両方の版と再ビルド行を出す", () => {
		const message = formatRegistryVersionWarning(
			{
				builtWith: "0.0.9",
				inputs: {
					sources: ["app/components/**/*.tsx"],
					tsconfig: "./tsconfig.json",
					storybookUrl: "http://localhost:6006",
				},
			},
			"0.1.0",
		);
		expect(message).toContain("built by Yosegi 0.0.9, but this CLI is 0.1.0");
		expect(message).toContain(
			'yosegi registry build --source "app/components/**/*.tsx" --tsconfig ./tsconfig.json --storybook-url http://localhost:6006',
		);
	});

	// A registry with no builtWith (predating this record) defaults to "unknown, so rebuild".
	// If inputs is also missing, print the scaffold rebuild line.
	it("記録が無ければ不明として作り直しを促す", () => {
		const message = formatRegistryVersionWarning(
			{ builtWith: undefined, inputs: null },
			"0.1.0",
		);
		expect(message).toContain("unrecorded");
		expect(message).toContain(
			"yosegi registry build --source <glob> --tsconfig <path>",
		);
	});
});

// The header block `component list` shows, made reusable so `component inspect` can print
// the same provenance once above several components instead of duplicating it per id.
describe("formatRegistryHeader", () => {
	it("formatComponentList の見出しと同じ内容を出す", () => {
		const provenance = {
			version: "src:abc123",
			generatedAt: "2026-08-09T01:02:03.000Z",
			inputs: { sources: ["app/**/*.tsx"], tsconfig: "./tsconfig.json" },
			cliPath: "/checkout/bin/yosegi.js",
		};
		const header = formatRegistryHeader(provenance);
		expect(header).toContain(
			"registry src:abc123  built 2026-08-09T01:02:03.000Z",
		);
		expect(header).toContain("cli: /checkout/bin/yosegi.js");
		expect(header).toContain("rebuild: yosegi registry build");
	});
});

// registry status answers two separate questions — "is the source still current?" and
// "is the Storybook-derived curation layer still current?" — plus everything list's
// provenance line already shows. formatRegistryStatus only renders the
// RegistrySourceCheck / RegistryIndexCheck the caller hands it; recomputing them (and
// keeping an unreachable --index from contaminating the source verdict) is cli.ts's job.
describe("formatRegistryStatus", () => {
	const registry = {
		version: "src:abc123",
		generatedAt: "2026-08-09T01:02:03.000Z",
		builtWith: "0.1.0",
		builtWithCliPath: "/checkout/bin/yosegi.js",
		inputs: {
			sources: ["app/**/*.tsx"],
			tsconfig: "./tsconfig.json",
			storybookUrl: "http://localhost:6006",
		},
	};
	const currentSource = { checked: true, current: true } as const;
	const currentIndex = { checked: true, current: true } as const;

	it("current なら source / index: current とだけ出す", () => {
		const output = formatRegistryStatus(
			registry,
			"0.1.0",
			currentSource,
			currentIndex,
		);
		expect(output).toContain("registry src:abc123");
		expect(output).toContain("built: 2026-08-09T01:02:03.000Z");
		expect(output).toContain("built by Yosegi: 0.1.0");
		expect(output).toContain("cli: /checkout/bin/yosegi.js");
		expect(output).toContain("source: app/**/*.tsx");
		expect(output).toContain("tsconfig: ./tsconfig.json");
		expect(output).toContain("source: current");
		expect(output).toContain("index: current");
		expect(output).not.toContain("stale");
	});

	it("source が stale なら再ビルドのコマンドを出す", () => {
		const output = formatRegistryStatus(
			registry,
			"0.1.0",
			{ checked: true, current: false },
			currentIndex,
		);
		expect(output).toContain(
			"source: stale — source changed since this registry was built",
		);
		expect(output).toContain(
			'yosegi registry build --source "app/**/*.tsx" --tsconfig ./tsconfig.json --storybook-url http://localhost:6006',
		);
	});

	// The exact bug report this restructure fixes: Storybook down (or on a different
	// port) must not turn the source verdict into "unknown", and must not report a false
	// "current" either.
	it("index が unreachable でも source の current/stale はそのまま出す", () => {
		const output = formatRegistryStatus(registry, "0.1.0", currentSource, {
			checked: false,
			reason:
				"index unreachable: fetch failed — source check above is unaffected",
		});
		expect(output).toContain("source: current");
		expect(output).toContain(
			"index: unknown — index unreachable: fetch failed — source check above is unaffected",
		);
		expect(output).not.toContain("stale");
	});

	it("index だけ stale なら再ビルドのコマンドを出す", () => {
		const output = formatRegistryStatus(registry, "0.1.0", currentSource, {
			checked: true,
			current: false,
		});
		expect(output).toContain("source: current");
		expect(output).toContain(
			"index: stale — the Storybook-derived layer (recommended / story links) changed since this registry was built",
		);
		expect(output).toContain(
			'yosegi registry build --source "app/**/*.tsx" --tsconfig ./tsconfig.json --storybook-url http://localhost:6006',
		);
	});

	it("再計算できなければ unknown と理由を出す", () => {
		const reason = {
			checked: false,
			reason: "registry has no recorded inputs",
		} as const;
		const output = formatRegistryStatus(registry, "0.1.0", reason, reason);
		expect(output).toContain(
			"source: unknown — registry has no recorded inputs",
		);
		expect(output).toContain(
			"index: unknown — registry has no recorded inputs",
		);
		expect(output).not.toContain("stale");
	});

	// The CLI-version mismatch warning is a separate freshness signal from the source
	// check, so it's appended rather than replacing it.
	it("実行中の CLI と版が食い違えば警告も添える", () => {
		const output = formatRegistryStatus(
			{ ...registry, builtWith: "0.0.9" },
			"0.1.0",
			currentSource,
			currentIndex,
		);
		expect(output).toContain("built by Yosegi: 0.0.9 (running 0.1.0)");
		expect(output).toContain(
			"Warning: this registry was built by Yosegi 0.0.9",
		);
	});

	it("inputs が無ければ (not recorded) と出す", () => {
		const reason = {
			checked: false,
			reason: "registry has no recorded inputs",
		} as const;
		const output = formatRegistryStatus(
			{ version: "src:abc123" },
			"0.1.0",
			reason,
			reason,
		);
		expect(output).toContain("inputs:\n    (not recorded)");
	});
});

describe("formatComponentInspect", () => {
	it("import 文・enum の選択肢・必須・既定値を出す", () => {
		const output = formatComponentInspect(button());
		expect(output).toContain(
			'import { Button } from "app/components/shadcn-ui/button"',
		);
		expect(output).toContain("props (4)");
		expect(output).toContain("label  string  required");
		expect(output).toContain('options: "default" | "destructive" | "outline"');
		expect(output).toContain('default: "default"');
		expect(output).toContain("story: Components/Button");
	});

	// Make it possible to distinguish props whose value isn't validated even if written from
	// writable props.
	it("編集対象外の props に not-editable を付ける", () => {
		expect(formatComponentInspect(button())).toContain(
			"onClick  function  not-editable",
		);
	});

	it("slots の required / maxItems を出す", () => {
		const output = formatComponentInspect(
			button({ slots: { children: { required: true, maxItems: 2 } } }),
		);
		expect(output).toContain("children  required  maxItems: 2");
	});

	// A registry without propsFromTypes (built from index.json) has no argTypes, so props
	// stays empty unless explicit metadata fills it in.
	it("propsFromTypes が無く props が空なら注意書きを出す", () => {
		const output = formatComponentInspect(button({ props: {} }));
		expect(output).toContain("read the host's source directly");
	});

	// Even for a registry built from index.json, if explicit metadata supplied the props, they reflect reality.
	it("propsFromTypes が無くても props があれば注意書きを出さない", () => {
		const output = formatComponentInspect(
			button({ props: { className: { kind: "string" } } }),
		);
		expect(output).not.toContain("read the host's source directly");
	});

	it("props を読めている部品には注意書きを出さない", () => {
		expect(formatComponentInspect(button())).not.toContain(
			"read the host's source directly",
		);
	});

	it("propsFromTypes が false なら注意書きを出す", () => {
		const output = formatComponentInspect(button({ propsFromTypes: false }));
		expect(output).toContain("read the host's source directly");
		// Reading the source alone isn't enough to pass Screen JSON validation, so point to
		// the supplementation option too.
		expect(output).toContain("--metadata");
	});

	// If the note also showed up for a component that genuinely only accepts className (e.g.
	// AlertTitle), it would become indistinguishable from a component where type extraction failed.
	it("propsFromTypes が true なら props が className だけでも注意書きを出さない", () => {
		const output = formatComponentInspect(
			button({
				props: { className: { kind: "string" } },
				propsFromTypes: true,
			}),
		);
		expect(output).not.toContain("read the host's source directly");
	});
});

describe("formatComponentInspect の pass-through 注記", () => {
	it("passthrough があれば props の後に 1 行だけ出す", () => {
		const output = formatComponentInspect(
			button({
				passthrough: "button DOM props (onClick, aria-*, …) pass through",
			}),
		);
		expect(output).toContain(
			"also accepts: button DOM props (onClick, aria-*, …) pass through",
		);
	});

	it("passthrough が無ければ何も出さない", () => {
		expect(formatComponentInspect(button())).not.toContain("also accepts:");
	});
});

describe("formatComponentInspect の Story 情報", () => {
	it("Story ファイルと Story 名を出す", () => {
		const output = formatComponentInspect(
			button({
				curation: {
					recommended: true,
					storyTitle: "Components/Button",
					storyCount: 3,
					storyFile: "./app/components/shadcn-ui/button.stories.tsx",
					storyNames: ["Playground", "Loading", "WithIcon"],
				},
			}),
		);
		expect(output).toContain(
			"story file: ./app/components/shadcn-ui/button.stories.tsx",
		);
		expect(output).toContain("stories: Playground, Loading, WithIcon");
	});

	it("Story を持たない部品には Story の行を出さない", () => {
		const output = formatComponentInspect(
			button({ curation: { recommended: false } }),
		);
		expect(output).not.toContain("story file:");
		expect(output).not.toContain("stories:");
	});

	it("ホストが書く specifier があれば import 行はそちらを使う", () => {
		const output = formatComponentInspect(
			button({
				import: {
					packageName: "./app/components/shadcn-ui/button.tsx",
					exportName: "Button",
					specifier: "~/components/shadcn-ui/button",
				},
			}),
		);
		expect(output).toContain(
			'import { Button } from "~/components/shadcn-ui/button";',
		);
	});

	it("specifier が無ければ packageName から拡張子を落として出す", () => {
		const output = formatComponentInspect(
			button({
				import: {
					packageName: "./app/components/shadcn-ui/button.tsx",
					exportName: "Button",
				},
			}),
		);
		expect(output).toContain(
			'import { Button } from "./app/components/shadcn-ui/button";',
		);
	});

	it("default export は波括弧なしの import 行で出す", () => {
		const output = formatComponentInspect(
			button({
				import: {
					packageName: "./app/components/examples/empty-state.tsx",
					exportName: "EmptyStatePage",
					kind: "default",
					specifier: "~/components/examples/empty-state",
				},
			}),
		);
		expect(output).toContain(
			'import EmptyStatePage from "~/components/examples/empty-state";',
		);
	});
});

// If props flattened to json only showed the name and not-editable, there'd be no way to
// write a value at implementation time. Pin down that the first-level shape is shown, and
// that it isn't over-shown.
describe("formatComponentInspect の shape 表示", () => {
	function withShape(shape: unknown): string {
		return formatComponentInspect(
			button({
				props: {
					selectAll: parseComponentManifest({
						id: "x#X",
						name: "X",
						import: { packageName: "x", exportName: "X" },
						props: { selectAll: { kind: "json", editable: false, shape } },
						slots: {},
					}).props.selectAll,
				},
			}),
		);
	}

	it("フィールドを型と説明ごと並べる", () => {
		const output = withShape({
			type: "SelectAllState",
			fields: [
				{ name: "canSelectAll", type: "boolean", description: "出せるか。" },
				{ name: "label", type: "string", optional: true },
			],
		});
		expect(output).toContain("shape: SelectAllState");
		expect(output).toContain("canSelectAll  boolean  出せるか。");
		// optional is shown with a `?`.
		expect(output).toContain("label?");
	});

	it("配列は要素型に [] を添える", () => {
		expect(withShape({ type: "Row", array: true, fields: [] })).toContain(
			"shape: Row[]",
		);
	});

	it("切り落としたフィールドは残り件数だけ示す", () => {
		const output = withShape({
			type: "WideOptions",
			fields: [{ name: "a1", type: "string" }],
			truncated: 13,
		});
		expect(output).toContain("(+13 more)");
	});

	it("shape が無い props には shape 行を出さない", () => {
		expect(formatComponentInspect(button())).not.toContain("shape:");
	});

	// The discriminant that matters most for a union like SelectionAction is "exactly one
	// of onClick/items is required" — a flat list with both marked `?` reads as "both
	// optional", which is wrong. variants are grouped under an "exactly one of:" heading
	// and shown WITHOUT `?`, since each is required within the one branch it belongs to.
	it("shared フィールドと variant フィールドを分けて出し、variant には ? を付けない", () => {
		const output = withShape({
			type: "SelectionAction",
			array: true,
			union: true,
			fields: [{ name: "label", type: "string", description: "表示ラベル。" }],
			variants: [
				{
					name: "onClick",
					type: "() => void",
					description: "クリック時に呼ばれる。",
				},
				{
					name: "items",
					type: "SelectionActionItem[]",
					description: "ドロップダウンの項目。",
				},
			],
		});
		expect(output).toContain(
			"shape: SelectionAction[] (each item: fields below + exactly one of the variants)",
		);
		expect(output).toContain("exactly one of:");
		expect(output).toContain("label");
		expect(output).not.toContain("onClick?");
		expect(output).not.toContain("items?");
		expect(output).toContain("onClick");
		expect(output).toContain("items");
	});

	// A variant field that's genuinely optional even within its own branch still keeps
	// the `?` — only the misleading "optional because merged across branches" case is dropped.
	it("variant 自体が branch 内でも optional なら ? を残す", () => {
		const output = withShape({
			type: "Widget",
			union: true,
			fields: [],
			variants: [{ name: "onClick", type: "() => void", optional: true }],
		});
		expect(output).toContain("onClick?");
	});

	// Without variants, a discriminated union whose branches share every field (no
	// pick-one to convey) still gets a plain union note.
	it("variant の無い union には variant 前提の注記を付けない", () => {
		const output = withShape({
			type: "Kind",
			union: true,
			fields: [{ name: "kind", type: '"a" | "b"' }],
		});
		expect(output).toContain("shape: Kind (union)");
		expect(output).not.toContain("exactly one of:");
	});

	// Without the union flag, no note is added, as before (a regression check for regular
	// object types and intersection types).
	it("union でない shape には注記を付けない", () => {
		const output = withShape({
			type: "SelectAllState",
			fields: [{ name: "canSelectAll", type: "boolean" }],
		});
		expect(output).toContain("shape: SelectAllState");
		expect(output).not.toContain("union");
	});

	// A third-party type that isn't expanded leaves only a name, so add where to look it up too.
	it("第三者の型は名前の後ろにパッケージ名を添える", () => {
		expect(
			withShape({
				type: "Table<TData>",
				package: "@tanstack/react-table",
				fields: [],
			}),
		).toContain("shape: Table<TData> (@tanstack/react-table)");
	});

	it("名前の付いた union は名前の下にメンバーを並べる", () => {
		const output = withShape({
			type: "Feature",
			array: true,
			fields: [],
			members: ['"bold"', '"italic"'],
		});
		expect(output).toContain("shape: Feature[]");
		expect(output).toContain('"bold" | "italic"');
	});

	// If the type name is the members themselves, splitting into two lines just says the same thing twice.
	it("名前の無い union はメンバーだけを 1 行で出す", () => {
		const output = withShape({
			type: "string | number",
			fields: [],
			members: ["string", "number"],
		});
		expect(output).toContain("shape: string | number");
		expect(
			output.split("\n").filter((line) => line.includes("string | number")),
		).toHaveLength(1);
	});

	// `string | number[]` reads as "string or an array of number".
	it("メンバーが並ぶ型に [] を付けるときは括弧で括る", () => {
		expect(
			withShape({
				type: "string | number",
				array: true,
				fields: [],
				members: ["string", "number"],
			}),
		).toContain("shape: (string | number)[]");
	});

	it("切り落としたメンバーは残り件数だけ示す", () => {
		const output = withShape({
			type: "WideFeature",
			fields: [],
			members: ['"f1"'],
			truncated: 21,
		});
		expect(output).toContain('"f1" (+21 more)');
	});
});

// A function prop's name alone isn't enough to write a call. Pin down that the signature is
// shown on a single line.
describe("formatComponentInspect の signature 表示", () => {
	function withSignatures(signatures: string[]): string {
		return formatComponentInspect(
			button({
				props: {
					onSelect: parseComponentManifest({
						id: "x#X",
						name: "X",
						import: { packageName: "x", exportName: "X" },
						props: {
							onSelect: { kind: "function", editable: false, signatures },
						},
						slots: {},
					}).props.onSelect,
				},
			}),
		);
	}

	it("シグネチャが 1 本なら 1 行で出す", () => {
		expect(withSignatures(["(file: File) => void"])).toContain(
			"signature: (file: File) => void",
		);
	});

	// State the count up front, so it isn't missed that multiple call shapes are possible.
	it("オーバーロードは本数を添えて並べる", () => {
		const output = withSignatures([
			"(value: string) => string",
			"(value: number, digits: number) => string",
		]);
		expect(output).toContain("signatures (2 overloads):");
		expect(output).toContain("(value: number, digits: number) => string");
	});

	it("signatures が無い props には signature 行を出さない", () => {
		expect(formatComponentInspect(button())).not.toContain("signature");
	});
});

// When the description spans multiple lines, indenting only the first line and letting the
// rest fall back to column 0 would make it unreadable which lines belong to which prop.
describe("formatComponentInspect の複数行の説明", () => {
	function described(description: string): string[] {
		return formatComponentInspect(
			button({ props: { label: { kind: "string", description } } }),
		)
			.split("\n")
			.filter((line) => line.includes("行目"));
	}

	it("2 行目以降も同じ深さへ揃える", () => {
		const lines = described("1 行目。\n2 行目。");
		expect(lines).toEqual(["      1 行目。", "      2 行目。"]);
	});

	it("JSDoc の行頭の余白を落としてから揃える", () => {
		const lines = described("1 行目。\n   - 2 行目。");
		expect(lines).toEqual(["      1 行目。", "      - 2 行目。"]);
	});
});
