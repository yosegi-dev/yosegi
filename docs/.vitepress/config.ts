import { defineConfig } from "vitepress";

const REPO = "https://github.com/yosegi-dev/yosegi";
const BLOB = `${REPO}/blob/main`;

// Pages serves a project site under the repository name. On a custom domain this
// becomes "/", and the domain needs a CNAME file in docs/public.
const BASE = "/yosegi/";

// Docs link out to files that live above docs/ — AGENTS.md, CONTRIBUTING.md, the skill. Those are
// not pages of this site, so their links are rewritten to the repository instead of 404ing.
function repoUrl(relativePath: string, href: string): string | null {
	if (!href.startsWith(".")) return null;
	const segments = relativePath.split("/").slice(0, -1);
	let escaped = 0;
	for (const part of href.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (segments.length > 0) segments.pop();
			else escaped += 1;
			continue;
		}
		segments.push(part);
	}
	return escaped === 0 ? null : `${BLOB}/${segments.join("/")}`;
}

const en = [
	{
		text: "Guide",
		items: [
			{ text: "Getting started", link: "/getting-started" },
			{ text: "Workflows", link: "/workflows" },
			{ text: "Storybook MCP and Yosegi", link: "/storybook-mcp" },
		],
	},
	{
		text: "Reference",
		items: [
			{ text: "Screen JSON", link: "/screen-json" },
			{ text: "CLI reference", link: "/cli" },
			{ text: "Component registry", link: "/registry" },
		],
	},
	{
		text: "Project",
		items: [
			{ text: "Development", link: "/development" },
			{ text: "Documentation conventions", link: "/conventions" },
			{ text: "Roadmap", link: "/ROADMAP" },
		],
	},
];

const ja = [
	{
		text: "ガイド",
		items: [
			{ text: "はじめに", link: "/ja/getting-started" },
			{ text: "ワークフロー", link: "/ja/workflows" },
			{ text: "Storybook MCP と Yosegi", link: "/ja/storybook-mcp" },
		],
	},
	{
		text: "リファレンス",
		items: [
			{ text: "Screen JSON", link: "/ja/screen-json" },
			{ text: "CLI リファレンス", link: "/ja/cli" },
			{ text: "Component Registry", link: "/ja/registry" },
		],
	},
	{
		text: "プロジェクト",
		items: [
			{ text: "開発", link: "/ja/development" },
			{ text: "ドキュメント規約", link: "/ja/conventions" },
			{ text: "ロードマップ", link: "/ja/ROADMAP" },
		],
	},
];

export default defineConfig({
	title: "Yosegi",
	description:
		"Assemble screen UIs from the components already in your Storybook, emit them as Stories, and turn those Stories into implementations.",
	base: BASE,
	cleanUrls: true,
	lastUpdated: true,
	head: [
		[
			"link",
			// head links are emitted verbatim, so this one carries the base itself.
			{ rel: "icon", href: `${BASE}brand/favicon.svg`, type: "image/svg+xml" },
		],
		["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
		[
			"link",
			{ rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
		],
		[
			"link",
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&display=swap",
			},
		],
	],
	markdown: {
		config(md) {
			const fallback =
				md.renderer.rules.link_open ??
				((tokens, idx, options, _env, self) =>
					self.renderToken(tokens, idx, options));
			md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
				const token = tokens[idx];
				const href = token.attrGet("href");
				const relativePath: unknown = env?.relativePath;
				if (href && typeof relativePath === "string") {
					const external = repoUrl(relativePath, href);
					if (external) {
						token.attrSet("href", external);
						token.attrSet("target", "_blank");
						token.attrSet("rel", "noreferrer");
					}
				}
				return fallback(tokens, idx, options, env, self);
			};
		},
	},
	locales: {
		root: {
			label: "English",
			lang: "en-US",
			themeConfig: {
				nav: [
					{
						text: "Guide",
						link: "/getting-started",
						activeMatch: "/(getting-started|workflows|storybook-mcp)",
					},
					{
						text: "Reference",
						link: "/cli",
						activeMatch: "/(cli|screen-json|registry)",
					},
					{ text: "Roadmap", link: "/ROADMAP" },
				],
				sidebar: en,
				editLink: {
					pattern: `${BLOB}/docs/:path`,
					text: "Edit this page on GitHub",
				},
				footer: {
					message: "Released under the MIT License.",
					copyright: "Yosegi",
				},
			},
		},
		ja: {
			label: "日本語",
			lang: "ja",
			link: "/ja/",
			themeConfig: {
				nav: [
					{
						text: "ガイド",
						link: "/ja/getting-started",
						activeMatch: "/ja/(getting-started|workflows|storybook-mcp)",
					},
					{
						text: "リファレンス",
						link: "/ja/cli",
						activeMatch: "/ja/(cli|screen-json|registry)",
					},
					{ text: "ロードマップ", link: "/ja/ROADMAP" },
				],
				sidebar: ja,
				editLink: {
					pattern: `${BLOB}/docs/:path`,
					text: "GitHub でこのページを編集する",
				},
				footer: {
					message: "MIT License のもとで公開されています。",
					copyright: "Yosegi",
				},
				docFooter: { prev: "前のページ", next: "次のページ" },
				outline: { label: "このページの内容" },
				darkModeSwitchLabel: "外観",
				returnToTopLabel: "トップへ戻る",
				langMenuLabel: "言語",
			},
		},
	},
	themeConfig: {
		logo: {
			light: "/brand/yosegi-symbol.svg",
			dark: "/brand/yosegi-symbol-light.svg",
		},
		siteTitle: "Yosegi",
		search: {
			provider: "local",
			options: {
				locales: {
					ja: {
						translations: {
							button: { buttonText: "検索", buttonAriaLabel: "検索" },
							modal: {
								displayDetails: "詳細を表示",
								resetButtonTitle: "条件をリセット",
								backButtonTitle: "閉じる",
								noResultsText: "見つかりません",
								footer: {
									selectText: "選択",
									navigateText: "移動",
									closeText: "閉じる",
								},
							},
						},
					},
				},
			},
		},
		socialLinks: [{ icon: "github", link: REPO }],
	},
});
