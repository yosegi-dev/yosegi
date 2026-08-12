# Development and release tasks. `make help` lists every target.
#
# The release flow is two steps, because main only takes changes through a PR:
#
#   1. make release-pr VERSION=0.2.0
#      Branches from origin/main, bumps both package versions and the
#      @yosegi/core pin, refreshes bun.lock, runs every check plus a pack
#      verification, then opens a Draft PR.
#   2. Merge that PR, switch to the updated main, then:
#      make release-tag VERSION=0.2.0
#      Tags v0.2.0 and pushes it — the Release workflow publishes to npm.

.PHONY: help install lint test typecheck build pack check verify \
	require-version bump release-pr release-tag

help: ## List the available targets
	@grep -E '^[a-z-]+:.*##' Makefile | awk -F':.*## ' '{printf "%-14s %s\n", $$1, $$2}'

install: ## Install dependencies
	bun install

lint: ## Biome check
	bun lint

test: ## Run every package's tests, then scripts/
	bun test

typecheck: ## Typecheck every package, then scripts/
	bun typecheck

build: ## Build @yosegi/core then @yosegi/yosegi
	bun run build

pack: ## Build and verify the tarballs a release would publish
	bun run pack

check: lint test typecheck ## lint + test + typecheck

verify: check pack ## Everything a release must pass

require-version:
	@test -n "$(VERSION)" || { echo "VERSION is required, e.g. make release-pr VERSION=0.2.0"; exit 1; }

# Rewrites the version fields in place instead of using `npm pkg set`, which
# would reformat the files. The @yosegi/core pin and bun.lock must move in the
# same commit as the versions: `bun pm pack` substitutes the pinned version
# from the lockfile, so a stale lockfile packs a dependency that doesn't exist.
bump: require-version ## Set both package versions and the @yosegi/core pin to VERSION
	bun -e 'const fs=require("node:fs");const v=process.argv[1];for(const p of ["packages/core/package.json","packages/server/package.json"]){let s=fs.readFileSync(p,"utf8");s=s.replace(/("version":\s*")[^"]+/,"$$1"+v);if(p.includes("server"))s=s.replace(/("@yosegi\/core":\s*")[^"]+/,"$$1"+v);fs.writeFileSync(p,s);}' $(VERSION)
	bun install

release-pr: require-version ## Branch from origin/main, bump, verify, open a Draft PR
	git fetch origin
	git switch -c chore/release-v$(VERSION) origin/main
	$(MAKE) bump VERSION=$(VERSION)
	$(MAKE) verify
	git add packages/core/package.json packages/server/package.json bun.lock
	git commit -m "chore: release v$(VERSION)"
	git push -u origin chore/release-v$(VERSION)
	gh pr create --draft --title "chore: release v$(VERSION)" \
		--body "Bumps both packages and the @yosegi/core pin to $(VERSION). After merging, run: make release-tag VERSION=$(VERSION)"

release-tag: require-version ## After the release PR merged: tag v<VERSION> on main and push
	git fetch origin
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "HEAD is not origin/main — switch to the updated main first"; exit 1; }
	@test "$$(node -p "require('./packages/core/package.json').version")" = "$(VERSION)" || { echo "packages/core is not at $(VERSION) — merge the release PR first"; exit 1; }
	git tag v$(VERSION)
	git push origin v$(VERSION)
