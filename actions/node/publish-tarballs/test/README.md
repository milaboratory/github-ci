# `publish-tarballs` tests

Bats suite for `../publish-tarballs.sh`. `fixtures/*/manifest.jsonl` are
manifests in the format `pack-unpublished.sh` writes; placeholder tarballs are
created per test. `bin/npm` records every `npm publish` together with the npm
config in effect, so the suite checks arguments, order and which registry gets
which credential.

```bash
bats actions/node/publish-tarballs/test/publish-tarballs.bats
```

Needs `bats` and `jq`.
