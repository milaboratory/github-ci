# `pack-unpublished` tests

Bats suite for `../pack-unpublished.sh`. Each test copies `fixtures/workspace`
to a temp dir, runs `pnpm install` there (no external dependencies, offline)
and packs it. `bin/npm` answers `npm view` from env-configured fake registry
state; pnpm and other npm commands are real.

```bash
bats actions/node/pack-unpublished/test/pack-unpublished.bats
```

Needs `bats` (`brew install bats-core` / `apt-get install -y bats`), `jq`,
`npm` and `pnpm`. CI (`0-test-npm-publish-split.yaml`) runs it with pnpm 9.12
(what block repos pin) and with the repo's packageManager.
