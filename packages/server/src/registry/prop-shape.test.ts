import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { indexRegistry, type PropDefinition } from "@yosegi/core";
import { buildRegistryFromSource } from "./source-registry.ts";

// Rooted in a directory separate from the shared __fixtures__, since we only want to
// exercise shape extraction here. This avoids interfering with existing tests that count entries across the whole Manifest.
const FIXTURE_ROOT = join(import.meta.dir, "__shape-fixtures__");

function props(): Record<string, PropDefinition> {
	const registry = buildRegistryFromSource({
		projectRoot: FIXTURE_ROOT,
		sources: ["**/*.tsx"],
		tsconfigPath: join(FIXTURE_ROOT, "tsconfig.json"),
	}).registry;
	const manifest = indexRegistry(registry).get("opaque-props#OpaqueProps");
	if (!manifest) {
		throw new Error("fixture component not found");
	}
	return manifest.props;
}

describe("json prop の shape 抽出", () => {
	it("オブジェクト型のフィールドを JSDoc ごと 1 段だけ載せる", () => {
		const selectAll = props().selectAll;
		expect(selectAll.kind).toBe("json");
		expect(selectAll.shape?.type).toBe("SelectAllState");
		expect(selectAll.shape?.array).toBeUndefined();
		expect(selectAll.shape?.fields).toEqual([
			{
				name: "canSelectAll",
				type: "boolean",
				description: "全件選択ボタンを出せるか。",
			},
			{
				name: "totalCount",
				type: "number",
				description: "全件選択の対象件数。",
			},
			{
				name: "onSelectAll",
				type: "() => void",
				description: "全件選択へ切り替えるときに呼ばれる。",
			},
			{
				name: "label",
				type: "string",
				optional: true,
				description: "表示ラベル。省略時は既定文言。",
			},
		]);
	});

	// Optionality is expressed via the optional flag. Also leaving `| undefined` in the
	// type text would say the same thing twice and make the column harder to read.
	it("optional なフィールドの型から undefined を落とす", () => {
		const label = props().selectAll.shape?.fields.find(
			(field) => field.name === "label",
		);
		expect(label?.optional).toBe(true);
		expect(label?.type).toBe("string");
	});

	// The "only one level deep" promise. Expanding into nesting would turn the Manifest into a copy of the type definition.
	it("入れ子のオブジェクトは展開せず object で止める", () => {
		const fields = props().config.shape?.fields ?? [];
		const byName = new Map(fields.map((field) => [field.name, field.type]));
		expect(byName.get("spacing")).toBe("object");
		// A named nested type keeps its name (still not expanded).
		expect(byName.get("selection")).toBe("SelectAllState");
		// An array just names its element — the element's own contents aren't opened up.
		expect(byName.get("rows")).toBe("object[]");
	});

	it("配列の prop は要素型の形を載せる", () => {
		const rows = props().rows;
		expect(rows.shape?.type).toBe("Row");
		expect(rows.shape?.array).toBe(true);
		expect(rows.shape?.fields.map((field) => field.name)).toEqual([
			"id",
			"name",
			"selected",
		]);
	});

	// A discriminated union's required fields change depending on which branch is
	// written, but as long as every member is an object type with fields, there's no
	// reason to discard the per-branch fields and JSDoc. kind is present (with real
	// content) on every branch, so it's shared; href / onClick each belong to only one
	// branch, so they're variants — required within that branch, not "optional".
	it("オブジェクトの union は共有フィールドと variant フィールドに分けて JSDoc ごと展開する", () => {
		const actions = props().actions;
		expect(actions.shape?.type).toBe("Action");
		expect(actions.shape?.array).toBe(true);
		expect(actions.shape?.union).toBe(true);
		expect(actions.shape?.fields).toEqual([
			{ name: "kind", type: '"link" | "button"' },
		]);
		expect(actions.shape?.variants).toEqual([
			{ name: "href", type: "string" },
			{ name: "onClick", type: "() => void" },
		]);
	});

	// SelectionAction has the shape (base) & (union). label/variant are declared on both
	// branches of the union with real content, so they're shared; onClick/items each
	// cancel out via `?: never` on the branch they don't belong to, so that placeholder
	// occurrence is excluded and they land in variants instead — required, not optional,
	// since each is non-optional within the one branch it actually appears in.
	it("交差型 + union の組み合わせは共有フィールドと variant フィールドに分けて JSDoc ごと展開する", () => {
		const selectionActions = props().selectionActions;
		expect(selectionActions.shape?.type).toBe("SelectionAction");
		expect(selectionActions.shape?.array).toBe(true);
		expect(selectionActions.shape?.union).toBe(true);
		expect(selectionActions.shape?.fields).toEqual([
			{
				name: "label",
				type: "string",
				description: "アクションに表示するラベル。",
			},
			{
				name: "variant",
				type: '"secondary" | "destructive"',
				optional: true,
				description: "ボタン / トリガーのバリアント種別。",
			},
		]);
		expect(selectionActions.shape?.variants).toEqual([
			{
				name: "onClick",
				type: "() => void",
				description: "アクションが実行されるタイミングで呼ばれる。",
			},
			{
				name: "items",
				type: "SelectionActionItem[]",
				description: "ドロップダウンに表示する項目一覧。",
			},
		]);
	});

	it("上限を超えるフィールドは切って残り件数を示す", () => {
		const options = props().options;
		expect(options.shape?.fields).toHaveLength(12);
		expect(options.shape?.truncated).toBe(2);
	});

	// A third-party type carries no JSDoc the host wrote, and a 12-field cap wouldn't
	// mean anything for it anyway. Only the name is shown, leaving the type definition to be looked up in its own package.
	it("node_modules 由来の型は展開せず名前だけ残す", () => {
		const anchor = props().anchor;
		expect(anchor.shape?.fields).toEqual([]);
		expect(anchor.shape?.type).toBeTruthy();
	});

	// An intersection type is "one shape that satisfies everything at once", with no
	// ambiguity about which branch it is. Without expanding it, all the JSDoc the host wrote on either side of it would be lost entirely.
	it("交差型はフィールドを JSDoc ごと展開する", () => {
		const profile = props().profile;
		expect(profile.shape?.type).toBe("Profile");
		expect(profile.shape?.fields).toEqual([
			{ name: "id", type: "string", description: "利用者の識別子。" },
			{ name: "name", type: "string", description: "画面に出す名前。" },
			{
				name: "email",
				type: "string | null",
				description: "連絡先メールアドレス。",
			},
		]);
	});

	// A type for which neither a name nor a shape can be produced writes nothing, rather than a guess.
	it("名前の無い union には shape を付けない", () => {
		expect(props().fallback.shape).toBeUndefined();
	});

	// An index-only type has no listable fields, but its name can still be given.
	// Knowing the name is enough to determine the shape of a writable value, so it's worth reporting even when fields is empty.
	it("索引だけの型は名前だけ残す", () => {
		expect(props().lookup.shape?.type).toBe("Record<string, number>");
		expect(props().lookup.shape?.fields).toEqual([]);
	});
});

describe("union メンバーの列挙", () => {
	// An unnamed, short union has its list of members double as the type name.
	// Splitting name and contents across two lines would give the reader nothing extra.
	it("プリミティブの union はメンバーを並べる", () => {
		const itemId = props().itemId;
		expect(itemId.shape?.type).toBe("string | number");
		expect(itemId.shape?.members).toEqual(["string", "number"]);
		expect(itemId.shape?.fields).toEqual([]);
	});

	// Even when a name exists, what's actually writable is the members. The name alone doesn't let you pick a value.
	it("リテラルの union は名前とメンバーの両方を残す", () => {
		const features = props().features;
		expect(features.shape?.type).toBe("Feature");
		expect(features.shape?.array).toBe(true);
		expect(features.shape?.members).toEqual([
			'"bold"',
			'"italic"',
			'"underline"',
		]);
	});

	// members and fields are mutually exclusive (a union has no fields), so truncated
	// represents the remaining count of whichever one is populated.
	it("上限を超えるメンバーは切って残り件数を示す", () => {
		const wide = props().wideFeatures;
		expect(wide.shape?.members).toHaveLength(20);
		expect(wide.shape?.truncated).toBe(2);
	});

	// An object union is expanded on the fields side (union: true), so it isn't also
	// reported in members (fields and members are mutually exclusive). An unnamed union
	// (fallback) can produce neither fields nor members, so it has no shape at all.
	it("オブジェクトの union にはメンバーを付けない", () => {
		expect(props().actions.shape?.members).toBeUndefined();
		expect(props().fallback.shape).toBeUndefined();
	});
});

describe("第三者の型のパッケージ名", () => {
	it("node_modules 由来の型に宣言元のパッケージ名を付ける", () => {
		expect(props().validator.shape?.package).toBe("zod");
		expect(props().anchor.shape?.package).toBe("@types/react");
	});

	// A type re-exported through a host alias points its direct declaration at the host,
	// so the package has to be traced through to the underlying declaration.
	it("ホストの別名越しに再エクスポートされた型にもパッケージ名を付ける", () => {
		expect(props().reexportedValidator.shape?.package).toBe("zod");
	});

	// The alias's own declaration lives in the host, but it resolves to nothing but a
	// third-party type underneath. Expanding it would leak zod's own members (def, _def,
	// check, clone, ...), the exact bloat third-party types are never expanded to avoid.
	it("ホストの別名でも第三者の型そのものならフィールドを展開しない", () => {
		expect(props().reexportedValidator.shape?.fields).toEqual([]);
	});

	// A host alias can mix host-only extras into a third-party type via an intersection
	// (the shape `ComponentProps<typeof X>`-style helpers produce). The package is still
	// resolved through to the third-party constituent, but fields stay unexpanded — one
	// constituent being external is enough to withhold the whole shape.
	it("第三者の型とホスト独自項目を交差させた別名もフィールドを展開しない", () => {
		expect(props().wrappedValidator.shape?.package).toBe("zod");
		expect(props().wrappedValidator.shape?.fields).toEqual([]);
	});

	it("ホストが宣言した型にはパッケージ名を付けない", () => {
		expect(props().selectAll.shape?.package).toBeUndefined();
	});

	// A purely host-declared intersection (no third-party constituent) is unaffected by
	// the external-constituent check above and still expands in full — see also 交差型は
	// フィールドを JSDoc ごと展開する for the JSDoc-preserving assertion on the same prop.
	it("第三者の型を含まない交差型はパッケージ名を付けず展開する", () => {
		expect(props().profile.shape?.package).toBeUndefined();
		expect(props().profile.shape?.fields.length).toBeGreaterThan(0);
	});

	// lib.es5.d.ts lives under node_modules/typescript, but it isn't a package you
	// install and look up. Writing "typescript" here would point to a location that doesn't actually exist as such.
	it("TypeScript 標準ライブラリの型にはパッケージ名を付けない", () => {
		expect(props().lookup.shape?.type).toBe("Record<string, number>");
		expect(props().lookup.shape?.package).toBeUndefined();
	});
});

describe("関数 prop の呼び出しシグネチャ", () => {
	it("引数と戻り値を 1 行で載せる", () => {
		const onSelect = props().onSelect;
		expect(onSelect.kind).toBe("function");
		expect(onSelect.signatures).toEqual(["(file: File) => void"]);
	});

	it("省略できる引数と可変長引数を記号で示す", () => {
		expect(props().onLog.signatures).toEqual([
			"(message: string, level?: number, ...tags: string[]) => Promise<void>",
		]);
	});

	// A type parameter is a value the caller decides, so it's kept as declared rather than being collapsed to whatever it inferred to at any one call site.
	it("型引数を残す", () => {
		expect(props().onPick.signatures).toEqual([
			"<TRow>(row: TRow, index: number) => void",
		]);
	});

	// Which overload gets used is the caller's decision. Narrowing to just the first
	// would hide a call that should have been writable.
	it("オーバーロードを宣言順に全て並べる", () => {
		const format = props().format;
		// A function whose type text never shows `=>` has its kind rounded down to json.
		expect(format.kind).toBe("json");
		expect(format.signatures).toEqual([
			"(value: string) => string",
			"(value: number, digits: number) => string",
		]);
		// A prop for which call signatures could be produced doesn't also get a shape.
		expect(format.shape).toBeUndefined();
	});

	it("関数でない prop には signatures を付けない", () => {
		expect(props().selectAll.signatures).toBeUndefined();
		expect(props().itemId.signatures).toBeUndefined();
	});

	// shape exists only for props rounded down to json. A kind whose value is already writable never gets one.
	it("json 以外の kind には shape を付けない", () => {
		for (const [name, def] of Object.entries(props())) {
			if (def.kind !== "json") {
				expect(def.shape, name).toBeUndefined();
			}
		}
	});
});
