# npm-split-publish

Implementation of the split npm publish behind two composite actions:

| Action | Entry | Runs on |
|---|---|---|
| `actions/node/pack-unpublished` | `lib/pack` (`src/bin/pack.ts` → `src/pack.ts`) | the build runner, often self-hosted |
| `actions/node/publish-tarballs` | `lib/publish` (`src/bin/publish.ts` → `src/publish.ts`) | GitHub-hosted, `id-token: write` |

npm trusted publishing (OIDC) does not accept self-hosted runners, so
`pack` does everything `pnpm -r publish` does except the upload: for every
unpublished non-private package, in dependency order, it runs
`prepublishOnly` and `pnpm pack`. `publish` uploads the tarballs with
`npm publish <tarball> --ignore-scripts`. The two halves share
`manifest.jsonl`, typed as `ManifestEntry` in `src/manifest.ts`.

## Develop

```bash
pnpm install                 # at the repo root
cd actions/node/npm-split-publish
pnpm exec vitest run         # unit + integration tests
pnpm run build               # rebuilds lib/; commit it
```

The actions run the committed `lib/`; CI (`0-test-npm-publish-split.yaml`)
fails when it does not match a fresh build.

`test/pack.test.ts` runs the real `pnpm` from PATH on `test/fixtures/workspace`
and fakes only `npm view`. CI runs it with pnpm 9.12 (what block repos pin) and
with the repo's pnpm. Other tests replace pnpm/npm with a fake `Runner`.
