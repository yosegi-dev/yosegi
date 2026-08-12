import { describe, expect, it } from "bun:test";
import { join, relative } from "node:path";
import {
	indexRegistry,
	parseScreenDefinition,
	validateScreen,
	withSyntheticComponents,
} from "@yosegi/core";
import { buildImportMapResolver, emitCsf } from "@yosegi/core/emit";
import type { ComposerMetadata, StorybookIndex } from "@yosegi/core/registry";
import {
	buildRegistryFromSource,
	type SourceRegistryResult,
} from "./source-registry.ts";

const FIXTURE_ROOT = join(import.meta.dir, "__fixtures__");

// The test runner decides the working directory, so a cwd-relative path is built on the spot here.
function relativeFromCwd(path: string): string {
	return relative(process.cwd(), path);
}

function build(index?: StorybookIndex): SourceRegistryResult {
	return buildRegistryFromSource({
		projectRoot: FIXTURE_ROOT,
		sources: ["**/*.tsx"],
		tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
		index,
		storybookBaseUrl: "https://storybook.example.com",
	});
}

describe("buildRegistryFromSource", () => {
	// Writing `--tsconfig ./host/tsconfig.json` from outside the host is a natural thing
	// to do, so this pins down that include's glob resolves correctly even with a relative path (same result as an absolute path).
	it("相対パスの tsconfig でも同じ Registry になる", () => {
		const relative = buildRegistryFromSource({
			projectRoot: FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: relativeFromCwd(join(FIXTURE_ROOT, "tsconfig.json")),
		});
		expect(relative.registry.components.map((c) => c.id)).toEqual(
			build().registry.components.map((c) => c.id),
		);
	});

	it("export 名とモジュールパスから id を組み立てる", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest).toBeDefined();
		// The export name is used even when displayName is "RenamedSampleCard".
		expect(manifest?.name).toBe("SampleCard");
		expect(manifest?.import).toEqual({
			packageName: "./sample-card.tsx",
			exportName: "SampleCard",
		});
		expect(manifest?.description).toBe("サンプルのカード。");
	});

	it("文字列 union を enum の options として取り出す", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.variant).toEqual({
			kind: "enum",
			description: "表示スタイル。",
			options: ["default", "danger", "success"],
		});
	});

	it("数値 union も enum として扱う", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.columns?.kind).toBe("enum");
		expect(manifest?.props.columns?.options).toEqual([1, 2, 3]);
	});

	it("boolean は true | false の union に分解されても boolean に戻す", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.bordered?.kind).toBe("boolean");
		expect(manifest?.props.bordered?.options).toBeUndefined();
	});

	it("必須の props とその説明を型から取る", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.title).toEqual({
			kind: "string",
			description: "カードの見出し。",
			required: true,
		});
	});

	it("関数型は編集対象外として記録する", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.onSelect?.kind).toBe("function");
		expect(manifest?.props.onSelect?.editable).toBe(false);
	});

	// Even for a kind whose value shape isn't validated, the Screen JSON author still
	// needs to know whether null can be written. If the Manifest dropped nullable, that information would survive nowhere.
	it("値を検証しない kind でも nullable を残す", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.props.payload?.kind).toBe("json");
		expect(manifest?.props.payload?.nullable).toBe(true);
		expect(manifest?.props.onDismiss?.kind).toBe("function");
		expect(manifest?.props.onDismiss?.nullable).toBe(true);
	});

	it("ReactNode を受ける props は props ではなく slots に載せる", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.slots.actions).toEqual({
			description: "ヘッダー右端に置く要素。",
		});
		expect(manifest?.props.actions).toBeUndefined();
		expect(manifest?.slots.children).toBeDefined();
	});

	// Back when the Manifest added className / children unconditionally, even a part
	// like `interface Props { date: Date }` ended up with both, and a Story written trusting that failed the host's type check.
	describe("className / children", () => {
		function propsOf(id: string): string[] {
			return Object.keys(indexRegistry(build().registry).get(id)?.props ?? {});
		}
		function slotsOf(id: string): string[] {
			return Object.keys(indexRegistry(build().registry).get(id)?.slots ?? {});
		}

		it("自前で className を宣言していれば載せる", () => {
			expect(propsOf("default-props#ExplicitClassName").sort()).toEqual([
				"className",
				"label",
			]);
			expect(slotsOf("default-props#ExplicitClassName")).toEqual([]);
		});

		it("HTML 属性を丸ごと受ける部品には className と children を載せる", () => {
			expect(propsOf("default-props#SpreadHtmlAttributes")).toEqual([
				"className",
			]);
			expect(slotsOf("default-props#SpreadHtmlAttributes")).toEqual([
				"children",
			]);
		});

		it("PropsWithChildren の children は Slot として載せる", () => {
			expect(propsOf("default-props#WithChildren")).toEqual(["tone"]);
			expect(slotsOf("default-props#WithChildren")).toEqual(["children"]);
		});

		it("children を明示宣言していれば Slot として載せる", () => {
			expect(propsOf("default-props#ExplicitChildren")).toEqual([]);
			expect(slotsOf("default-props#ExplicitChildren")).toEqual(["children"]);
		});

		it("どちらも受け取らない部品には付けない", () => {
			expect(propsOf("default-props#PlainValue")).toEqual(["amount"]);
			expect(slotsOf("default-props#PlainValue")).toEqual([]);
		});

		it("props 型に className が無ければ載せない", () => {
			// SampleCardProps has children but not className.
			expect(propsOf("sample-card#SampleCard")).not.toContain("className");
			expect(slotsOf("sample-card#SampleCard")).toContain("children");
		});
	});

	it("@yosegi-internal が付いた export は台帳から除外する", () => {
		const result = build();
		const manifests = indexRegistry(result.registry);
		expect(manifests.get("internal-widget#InternalWidget")).toBeUndefined();
		expect(manifests.get("internal-widget#PublicWidget")).toBeDefined();
		expect(result.missed).toContainEqual({
			id: "internal-widget#InternalWidget",
			reason: "internal",
		});
		expect(result.stats.skippedInternal).toBe(1);
	});

	// A part whose props type itself can't be obtained can't have className / children
	// determined either. Since there's no way to tell whether it's accepted, this leaves them empty rather than assuming they exist.
	it("props を読めなかったコンポーネントも台帳には載せる", () => {
		const result = build();
		const manifest = indexRegistry(result.registry).get(
			"factory-icon#FactoryIcon",
		);
		expect(manifest?.props).toEqual({});
		expect(manifest?.slots).toEqual({});
		expect(result.missed).toContainEqual({
			id: "factory-icon#FactoryIcon",
			reason: "props-unreadable",
		});
	});

	it("型エイリアスや定数はコンポーネント候補に数えない", () => {
		const result = build();
		const manifests = indexRegistry(result.registry);
		expect(manifests.get("sample-card#SAMPLE_CARD_LIMIT")).toBeUndefined();
		expect(manifests.get("sample-card#SampleCardProps")).toBeUndefined();
		expect(result.missed.map((entry) => entry.id)).not.toContain(
			"sample-card#SAMPLE_CARD_LIMIT",
		);
	});

	it("Story を持たないコンポーネントは recommended=false になる", () => {
		const manifest = indexRegistry(build().registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.curation).toEqual({ recommended: false });
		expect(manifest?.category).toBe("uncategorized");
	});

	it("index.json と突き合わせて category / 表示リンク / 推奨を付ける", () => {
		const index: StorybookIndex = {
			v: 5,
			entries: {
				"components-samplecard--default": {
					type: "story",
					id: "components-samplecard--default",
					name: "Default",
					title: "Components/SampleCard",
					importPath: "./sample-card.stories.tsx",
					componentPath: "./sample-card.tsx",
				},
				"components-samplecard--danger": {
					type: "story",
					id: "components-samplecard--danger",
					name: "Danger",
					title: "Components/SampleCard",
					importPath: "./sample-card.stories.tsx",
					componentPath: "./sample-card.tsx",
				},
			},
		};
		const result = build(index);
		const manifest = indexRegistry(result.registry).get(
			"sample-card#SampleCard",
		);
		expect(manifest?.category).toBe("Components");
		expect(manifest?.curation).toEqual({
			recommended: true,
			storyTitle: "Components/SampleCard",
			storyCount: 2,
			storyFile: "./sample-card.stories.tsx",
			storyNames: ["Default", "Danger"],
		});
		expect(manifest?.references?.storybook).toBe(
			"https://storybook.example.com/?path=/story/components-samplecard--default",
		);
		expect(result.stats.withStory).toBe(1);
	});

	it("合成プリミティブを含めた Registry を返す", () => {
		const manifests = indexRegistry(build().registry);
		expect(manifests.get("Text")).toBeDefined();
		expect(manifests.get("Box")).toBeDefined();
	});

	it("抽出品質の集計を返す", () => {
		const { stats } = build();
		expect(stats.files).toBe(10);
		// The candidates are SampleCard / InternalWidget / PublicWidget / FactoryIcon /
		// UnionTile / CollidingBadge / Heading / Text, plus the 5 in default-props.tsx,
		// plus 3 default exports (DefaultExportPage / AliasedTile / the unnamed one).
		expect(stats.componentCandidates).toBe(16);
		expect(stats.extractedComponents).toBe(13);
		expect(stats.propsUnreadable).toBe(1);
		expect(stats.withEnumProps).toBe(4);
		expect(stats.withNodeSlots).toBe(1);
	});

	// A collision with an inherited HTML attribute (see "variants that collide with HTML attributes" in docs/registry.md).
	describe("HTML 属性と名前が衝突する variant", () => {
		it("ホスト側の宣言を優先して enum のまま台帳に載せる", () => {
			const manifest = indexRegistry(build().registry).get(
				"variant-collision#CollidingBadge",
			);
			expect(manifest?.props.color?.kind).toBe("enum");
			// Not collapsed down to HTMLAttributes.color (string) — the variant's options survive.
			// The options' order follows however TypeScript generates literal types, so order isn't asserted here.
			expect([...(manifest?.props.color?.options ?? [])].sort()).toEqual([
				"danger",
				"primary",
			]);
		});

		it("衝突しない variant はそのまま取れる", () => {
			const manifest = indexRegistry(build().registry).get(
				"variant-collision#CollidingBadge",
			);
			expect(manifest?.props.size?.options).toEqual(["sm", "md"]);
		});

		it("衝突していない HTML 継承属性は落としたままにする", () => {
			const manifest = indexRegistry(build().registry).get(
				"variant-collision#CollidingBadge",
			);
			// No React-originated props have leaked in beyond className / children.
			expect(Object.keys(manifest?.props ?? {}).sort()).toEqual([
				"className",
				"color",
				"size",
			]);
		});
	});

	// A gap in the required judgment (see "required judgment" in docs/registry.md).
	// This isn't compensated for — the tests pin down that the drift only ever goes toward "less required", never the other way.
	describe("union を含む props 型の required", () => {
		it("required を落として必須扱いしない（既知の制限）", () => {
			const manifest = indexRegistry(build().registry).get(
				"union-props#UnionTile",
			);
			// href / onPress are each present in only one branch, so neither is required
			// across the union as a whole. react-docgen-typescript returns required=true
			// for these, and keeping that as-is would reject a valid screen with MISSING_REQUIRED_PROP.
			expect(manifest?.props.href?.required).toBeUndefined();
			expect(manifest?.props.onPress?.required).toBeUndefined();
			// label, which is required in both branches, gets swept up and dropped too (erring toward missing coverage).
			expect(manifest?.props.label?.required).toBeUndefined();
			// required is preserved as before for a component whose props type isn't a union.
			const card = indexRegistry(build().registry).get(
				"sample-card#SampleCard",
			);
			expect(card?.props.title?.required).toBe(true);
		});

		it("required が落ちても検証は偽陽性を出さない", () => {
			const registry = withSyntheticComponents(build().registry);
			const screen = parseScreenDefinition({
				schemaVersion: "1.0",
				id: "union-tile",
				name: "union tile",
				componentRegistryVersion: registry.version,
				revision: 0,
				root: {
					id: "root",
					component: "union-props#UnionTile",
					// Neither href nor onPress is passed. Since either one alone is enough for
					// this type, MISSING_REQUIRED_PROP must not fire even with the Manifest having dropped required.
					props: { label: "詳細" },
					slots: {},
				},
			});
			const { errors } = validateScreen(screen, registry);
			expect(errors).toEqual([]);
		});
	});

	// For a part whose props can't be read from its type, writing a prop into Screen JSON
	// that genuinely exists would otherwise trigger UNKNOWN_PROP, blocking the screen
	// from being assembled at all. --metadata is the only escape hatch for that, so this
	// pins down that it also works via the --source path.
	describe("--metadata による補完", () => {
		function buildWithMetadata(
			metadata: Parameters<typeof buildRegistryFromSource>[0]["metadata"],
		): SourceRegistryResult {
			return buildRegistryFromSource({
				projectRoot: FIXTURE_ROOT,
				sources: ["**/*.tsx"],
				tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
				metadata,
			});
		}

		it("型から読めなかった props を補完する", () => {
			const result = buildWithMetadata({
				"factory-icon#FactoryIcon": {
					props: {
						size: { kind: "enum", options: ["sm", "lg"] },
					},
				},
			});
			const manifest = indexRegistry(result.registry).get(
				"factory-icon#FactoryIcon",
			);
			expect(manifest?.props.size).toEqual({
				kind: "enum",
				options: ["sm", "lg"],
			});
			// A prop that wasn't filled in via metadata doesn't get added.
			expect(Object.keys(manifest?.props ?? {})).toEqual(["size"]);
		});

		it("補完した部品は props-unreadable として数えない", () => {
			const result = buildWithMetadata({
				"factory-icon#FactoryIcon": {
					props: { size: { kind: "string" } },
				},
			});
			expect(result.stats.propsUnreadable).toBe(0);
			expect(result.stats.metadataApplied).toBe(1);
			expect(result.missed.map((entry) => entry.id)).not.toContain(
				"factory-icon#FactoryIcon",
			);
		});

		it("補完した props で Screen の検証が通る", () => {
			const result = buildWithMetadata({
				"factory-icon#FactoryIcon": {
					props: { size: { kind: "enum", options: ["sm", "lg"] } },
				},
			});
			const registry = withSyntheticComponents(result.registry);
			const screen = parseScreenDefinition({
				schemaVersion: "1.0",
				id: "icon",
				name: "icon",
				componentRegistryVersion: registry.version,
				revision: 0,
				root: {
					id: "root",
					component: "factory-icon#FactoryIcon",
					props: { size: "sm" },
					slots: {},
				},
			});
			expect(validateScreen(screen, registry).errors).toEqual([]);
		});

		it("型から読めた props より明示メタデータを優先する", () => {
			const result = buildWithMetadata({
				"sample-card#SampleCard": {
					props: { title: { kind: "enum", options: ["A", "B"] } },
				},
			});
			const manifest = indexRegistry(result.registry).get(
				"sample-card#SampleCard",
			);
			expect(manifest?.props.title).toEqual({
				kind: "enum",
				options: ["A", "B"],
			});
		});

		it("どの id にも当たらなかった指定を返す", () => {
			const result = buildWithMetadata({
				"factory-icon#Typo": { props: { size: { kind: "string" } } },
			});
			expect(result.unusedMetadataIds).toEqual(["factory-icon#Typo"]);
		});

		it("指定が無ければ unusedMetadataIds は空になる", () => {
			expect(build().unusedMetadataIds).toEqual([]);
		});
	});

	// inspect's caveat is based solely on this flag on the Manifest side. A heuristic
	// like "has only className" would incorrectly trigger the caveat even for a part
	// that genuinely accepts nothing but className (e.g. AlertTitle).
	describe("propsFromTypes", () => {
		it("型から読めた部品には true が付く", () => {
			const manifest = indexRegistry(build().registry).get(
				"sample-card#SampleCard",
			);
			expect(manifest?.propsFromTypes).toBe(true);
		});

		it("型から読めなかった部品には false が付く", () => {
			const manifest = indexRegistry(build().registry).get(
				"factory-icon#FactoryIcon",
			);
			expect(manifest?.propsFromTypes).toBe(false);
		});

		it("--metadata で補完した部品は true になる", () => {
			const result = buildRegistryFromSource({
				projectRoot: FIXTURE_ROOT,
				sources: ["**/*.tsx"],
				tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
				metadata: {
					"factory-icon#FactoryIcon": {
						props: { size: { kind: "string" } },
					},
				},
			});
			expect(
				indexRegistry(result.registry).get("factory-icon#FactoryIcon")
					?.propsFromTypes,
			).toBe(true);
		});
	});
});

// A prop's JSDoc is the input that moves the Manifest's quality the most, so it's set up
// to be measurable directly from the extraction result. This only pins down the wiring
// (that it lands in stats, and that synthetic primitives are excluded from the
// denominator) — the classification logic itself belongs to doc-coverage.test.ts.
describe("buildRegistryFromSource の documentation coverage", () => {
	const DOC_FIXTURE_ROOT = join(import.meta.dir, "__doc-fixtures__");

	function buildDocFixtures(): SourceRegistryResult {
		return buildRegistryFromSource({
			projectRoot: DOC_FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(DOC_FIXTURE_ROOT, "tsconfig.json"),
		});
	}

	it("description の有無と不透明な props を stats に載せる", () => {
		const { stats } = buildDocFixtures();
		expect(stats.props).toBe(6);
		expect(stats.documentedProps).toBe(3);
		expect(stats.opaqueProps).toBe(3);
	});

	it("必須かつ不透明で description が無い props を数える", () => {
		const { stats } = buildDocFixtures();
		// Ledger's columns (json) and onRowSelect (function).
		expect(stats.undocumentedRequiredOpaqueProps).toBe(2);
		expect(stats.withUndocumentedRequiredOpaqueProps).toBe(1);
	});

	// Synthetic primitives are mixed into the Registry, but they aren't something the host can write JSDoc for.
	it("合成プリミティブの props は分母に入れない", () => {
		const { registry, stats } = buildDocFixtures();
		expect(registry.components.map((c) => c.id)).toContain("Text");
		const declared = registry.components.flatMap((component) =>
			Object.keys(component.props),
		);
		expect(declared.length).toBeGreaterThan(stats.props);
	});
});

describe("buildRegistryFromSource の import specifier", () => {
	function buildWithAliases(
		overrides: Partial<Parameters<typeof buildRegistryFromSource>[0]> = {},
	) {
		return buildRegistryFromSource({
			projectRoot: FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(FIXTURE_ROOT, "tsconfig.aliases.json"),
			...overrides,
		});
	}

	it("tsconfig の paths を解いた specifier を持つ", () => {
		const manifest = indexRegistry(buildWithAliases().registry).get(
			"sample-card#SampleCard",
		);
		// packageName stays the raw path used when building the Manifest; specifier is how the host would actually write it.
		expect(manifest?.import.packageName).toBe("./sample-card.tsx");
		expect(manifest?.import.specifier).toBe("~/sample-card");
	});

	it("paths を持たない tsconfig では specifier を付けない", () => {
		const manifest = indexRegistry(
			buildRegistryFromSource({
				projectRoot: FIXTURE_ROOT,
				sources: ["**/*.tsx"],
				tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
			}).registry,
		).get("sample-card#SampleCard");
		expect(manifest?.import.specifier).toBeUndefined();
	});

	it("importMap の指定は tsconfig の paths より優先する", () => {
		const manifest = indexRegistry(
			buildWithAliases({
				importMap: buildImportMapResolver("./=@acme/ui/"),
			}).registry,
		).get("sample-card#SampleCard");
		expect(manifest?.import.specifier).toBe("@acme/ui/sample-card.tsx");
	});

	it("生成される Story の import 文はホストの specifier になる", () => {
		const registry = withSyntheticComponents(buildWithAliases().registry);
		const screen = parseScreenDefinition({
			schemaVersion: "1.0",
			id: "s",
			name: "s",
			componentRegistryVersion: registry.version,
			revision: 0,
			root: {
				id: "root",
				component: "sample-card#SampleCard",
				props: {},
				slots: {},
			},
		});
		expect(emitCsf(screen.root, registry, { title: "Screens/S" })).toContain(
			'import { SampleCard } from "~/sample-card";',
		);
	});

	it("--import-map を渡した生成では import map の結果が勝つ", () => {
		const registry = withSyntheticComponents(buildWithAliases().registry);
		const screen = parseScreenDefinition({
			schemaVersion: "1.0",
			id: "s",
			name: "s",
			componentRegistryVersion: registry.version,
			revision: 0,
			root: {
				id: "root",
				component: "sample-card#SampleCard",
				props: {},
				slots: {},
			},
		});
		const source = emitCsf(screen.root, registry, {
			title: "Screens/S",
			resolveImport: buildImportMapResolver("./=@acme/ui/"),
		});
		expect(source).toContain(
			'import { SampleCard } from "@acme/ui/sample-card";',
		);
	});
});

describe("buildRegistryFromSource の default export", () => {
	function manifests() {
		return indexRegistry(
			buildRegistryFromSource({
				projectRoot: FIXTURE_ROOT,
				sources: ["**/*.tsx"],
				tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
			}).registry,
		);
	}

	it("default export を宣言の名前で登録し、props も型から読む", () => {
		const manifest = manifests().get("default-export-page#DefaultExportPage");
		expect(manifest?.import).toMatchObject({
			exportName: "DefaultExportPage",
			kind: "default",
		});
		expect(manifest?.props.heading).toMatchObject({
			kind: "string",
			required: true,
			description: "ページの見出し。",
		});
	});

	it("同じ実体を named と default の両方で export しても 1 件だけ載せる", () => {
		const registry = buildRegistryFromSource({
			projectRoot: FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
		}).registry;
		const tiles = registry.components.filter(
			(component) => component.name === "AliasedTile",
		);
		expect(tiles).toHaveLength(1);
		// The named export is kept, so the import statement stays a named import.
		expect(tiles[0].import.kind).toBeUndefined();
	});

	it("無名の default export は載せず、取りこぼしとして報告する", () => {
		const { registry, missed } = buildRegistryFromSource({
			projectRoot: FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
		});
		expect(
			registry.components.some((component) =>
				component.id.startsWith("anonymous-default"),
			),
		).toBe(false);
		expect(missed).toContainEqual({
			id: "anonymous-default#default",
			reason: "unnamed-default",
		});
	});

	it("default export は default import として生成される", () => {
		const registry = withSyntheticComponents(
			buildRegistryFromSource({
				projectRoot: FIXTURE_ROOT,
				sources: ["**/*.tsx"],
				tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
			}).registry,
		);
		const screen = parseScreenDefinition({
			schemaVersion: "1.0",
			id: "s",
			name: "s",
			componentRegistryVersion: registry.version,
			revision: 0,
			root: {
				id: "root",
				component: "default-export-page#DefaultExportPage",
				props: { heading: "見出し" },
				slots: {},
			},
		});
		const source = emitCsf(screen.root, registry, { title: "Screens/S" });
		expect(source).toContain(
			'import DefaultExportPage from "./default-export-page";',
		);
		expect(source).toContain('<DefaultExportPage heading="見出し" />');
	});
});

describe("buildRegistryFromSource の pass-through 注記", () => {
	const PASSTHROUGH_FIXTURE_ROOT = join(
		import.meta.dir,
		"__passthrough-fixtures__",
	);

	function buildPassthroughFixtures(): SourceRegistryResult {
		return buildRegistryFromSource({
			projectRoot: PASSTHROUGH_FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(PASSTHROUGH_FIXTURE_ROOT, "tsconfig.json"),
		});
	}

	it("ComponentPropsWithoutRef<タグ> を継承する props は要素名付きの注記を持つ", () => {
		const manifest = indexRegistry(buildPassthroughFixtures().registry).get(
			"dom-passthrough#SpreadingButton",
		);
		expect(manifest?.passthrough).toBe(
			"button DOM props (onClick, aria-*, …) pass through",
		);
	});

	it("DOM 属性を継承しない props には注記を付けない", () => {
		const manifest = indexRegistry(buildPassthroughFixtures().registry).get(
			"dom-passthrough#PlainTag",
		);
		expect(manifest?.passthrough).toBeUndefined();
	});

	// react-docgen-typescript's Parser.getPropsInfo memoizes a resolved prop under a cache
	// key of `${declaringFile}_${propName}` alone (no interface name) -- see lib/parser.js.
	// ThHTMLAttributes and TdHTMLAttributes are declared in the same @types/react file and
	// share member names (colSpan, rowSpan, ...), so whichever sibling's prop resolves
	// first in a batched parse "wins" the cache entry for the other. detectPassthrough must
	// resolve the tag independently per component instead of trusting that shared cache.
	it("同一ファイル内で *HTMLAttributes を継承する兄弟コンポーネントは、宣言順によらずそれぞれ正しいタグの注記を持つ", () => {
		const index = indexRegistry(buildPassthroughFixtures().registry);
		expect(
			index.get("dom-passthrough-siblings#TableHeadCell")?.passthrough,
		).toBe("th DOM props (onClick, aria-*, …) pass through");
		expect(
			index.get("dom-passthrough-siblings#TableDataCell")?.passthrough,
		).toBe("td DOM props (onClick, aria-*, …) pass through");
		// Declared in the opposite order in a separate fixture file: still correct, proving
		// the result doesn't depend on which sibling happened to be declared/parsed first.
		expect(
			index.get("dom-passthrough-siblings-reversed#TableDataCell2")
				?.passthrough,
		).toBe("td DOM props (onClick, aria-*, …) pass through");
		expect(
			index.get("dom-passthrough-siblings-reversed#TableHeadCell2")
				?.passthrough,
		).toBe("th DOM props (onClick, aria-*, …) pass through");
	});

	it("InputHTMLAttributes / TextareaHTMLAttributes を継承する兄弟コンポーネントも、それぞれ正しいタグの注記を持つ", () => {
		const index = indexRegistry(buildPassthroughFixtures().registry);
		expect(
			index.get("dom-passthrough-input-textarea#InputField")?.passthrough,
		).toBe("input DOM props (onClick, aria-*, …) pass through");
		expect(
			index.get("dom-passthrough-input-textarea#TextAreaField")?.passthrough,
		).toBe("textarea DOM props (onClick, aria-*, …) pass through");
	});
});

describe("buildRegistryFromSource の --source 外参照", () => {
	const OUTSIDE_SOURCE_FIXTURE_ROOT = join(
		import.meta.dir,
		"__outside-source-fixtures__",
	);

	function buildOutsideSourceFixtures(): SourceRegistryResult {
		return buildRegistryFromSource({
			projectRoot: OUTSIDE_SOURCE_FIXTURE_ROOT,
			// components/ だけを対象にし、icons.ts をあえて外す。
			sources: ["components/**/*.tsx"],
			tsconfigPath: join(OUTSIDE_SOURCE_FIXTURE_ROOT, "tsconfig.json"),
		});
	}

	it("glob が届かないホストのファイルを --report 用に集計する", () => {
		const { outsideSources } = buildOutsideSourceFixtures();
		expect(outsideSources.totalCount).toBe(1);
		expect(outsideSources.files).toEqual([
			{
				file: "icons",
				referencedBy: ["components/tag#Tag"],
				types: ["IconMeta"],
			},
		]);
	});

	// icons.ts 自体は --source の対象外だが、抽出そのものへの影響はない
	// （props の shape は変わらず読める）ことを確認する。
	it("抽出結果そのものには影響しない", () => {
		const manifest = indexRegistry(buildOutsideSourceFixtures().registry).get(
			"components/tag#Tag",
		);
		expect(manifest?.props.icon?.shape?.type).toBe("IconMeta");
	});
});

// DEPRECATED_COMPONENT is documented for both registry routes, but the --source route
// used to read neither the "deprecated" Story tag nor the JSDoc @deprecated.
describe("buildRegistryFromSource の deprecated", () => {
	const DEPRECATED_FIXTURE_ROOT = join(
		import.meta.dir,
		"__deprecated-fixtures__",
	);

	function buildDeprecatedFixtures(
		options: {
			index?: StorybookIndex;
			metadata?: Record<string, ComposerMetadata>;
		} = {},
	): SourceRegistryResult {
		return buildRegistryFromSource({
			projectRoot: DEPRECATED_FIXTURE_ROOT,
			sources: ["**/*.tsx"],
			tsconfigPath: join(DEPRECATED_FIXTURE_ROOT, "tsconfig.json"),
			...options,
		});
	}

	function taggedIndex(tags: string[]): StorybookIndex {
		return {
			v: 5,
			entries: {
				"components-taggedcard--default": {
					type: "story",
					id: "components-taggedcard--default",
					name: "Default",
					title: "Components/TaggedCard",
					importPath: "./tagged-card.stories.tsx",
					componentPath: "./tagged-card.tsx",
					tags,
				},
			},
		};
	}

	it("JSDoc の @deprecated を constraints.deprecated に反映する", () => {
		const manifests = indexRegistry(buildDeprecatedFixtures().registry);
		expect(manifests.get("legacy#LegacyBanner")?.constraints?.deprecated).toBe(
			true,
		);
		expect(
			manifests.get("legacy#FreshBanner")?.constraints?.deprecated,
		).toBeUndefined();
	});

	it("index.json の deprecated タグを constraints.deprecated に反映する", () => {
		const manifests = indexRegistry(
			buildDeprecatedFixtures({ index: taggedIndex(["deprecated"]) }).registry,
		);
		expect(
			manifests.get("tagged-card#TaggedCard")?.constraints?.deprecated,
		).toBe(true);
	});

	it("deprecated タグの無い Story では constraints を付けない", () => {
		const manifests = indexRegistry(
			buildDeprecatedFixtures({ index: taggedIndex(["autodocs"]) }).registry,
		);
		expect(
			manifests.get("tagged-card#TaggedCard")?.constraints,
		).toBeUndefined();
	});

	// The same precedence as buildRegistryFromStorybook: explicit metadata wins.
	it("--metadata の明示指定はホスト側の deprecated より優先する", () => {
		const manifests = indexRegistry(
			buildDeprecatedFixtures({
				metadata: {
					"legacy#LegacyBanner": { constraints: { deprecated: false } },
				},
			}).registry,
		);
		expect(manifests.get("legacy#LegacyBanner")?.constraints?.deprecated).toBe(
			false,
		);
	});

	// index.json tags identify a file, not an export. In a module with several
	// component exports the tag only reaches the export the Story title names.
	it("複数 export のモジュールではタグが displayName の一致する export にだけ付く", () => {
		const manifests = indexRegistry(
			buildDeprecatedFixtures({
				index: {
					v: 5,
					entries: {
						"components-mixedcard--default": {
							type: "story",
							id: "components-mixedcard--default",
							name: "Default",
							title: "Components/MixedCard",
							importPath: "./mixed-cards.stories.tsx",
							componentPath: "./mixed-cards.tsx",
							tags: ["deprecated"],
						},
					},
				},
			}).registry,
		);
		expect(
			manifests.get("mixed-cards#MixedCard")?.constraints?.deprecated,
		).toBe(true);
		expect(
			manifests.get("mixed-cards#MixedCardFooter")?.constraints?.deprecated,
		).toBeUndefined();
	});
});
