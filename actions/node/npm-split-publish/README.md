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

## Behaviour worth knowing

- **`repository` for provenance.** Under trusted publishing npm turns
  provenance on by itself for a public package from a public repository, and
  the registry rejects the upload (E422) unless `package.json` `repository.url`
  names the repository that built it. `pack` fills in a missing `repository`
  (`git+https://github.com/<owner>/<repo>.git`, plus `directory`) in the packed
  copy only, and fails before any `prepublishOnly` when a package declares a
  different repository (for example after a rename).
- **Dist-tag.** Every upload passes `--tag`: `publishConfig.tag`, else `latest`.
  npm 11 refuses a prerelease or a version below the highest published one
  without an explicit tag; the previous path (npm 10 under pnpm) tagged those
  `latest`, so that stays the behaviour.
- **The upload job does not trust the artifact.** Every manifest value is
  validated, each tarball's `package/package.json` must match its entry, values
  are passed as `--flag=value`, and npm runs from an empty directory so no
  `.npmrc` from the artifact is read. `GITHUB_TOKEN` is sent only to
  npm.pkg.github.com.
- **Partial releases.** `prepublishOnly` (`block-tools publish` to the block
  registry, `pl-pkg prepublish`) runs in the build job, before the upload job
  starts. If the upload fails, those side effects have happened and npm lacks
  the packages. Fix the cause and use "Re-run failed jobs" on the run: the
  upload job reuses the artifact (kept 7 days) and skips versions already
  published.

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
