# npm-split-publish

Implementation of the split npm publish behind two composite actions:

| Action | Entry | Runs on |
|---|---|---|
| `actions/node/pack-unpublished` | `lib/pack` (`src/bin/pack.ts` → `src/pack.ts`) | the build runner, often self-hosted |
| `actions/node/publish-tarballs` | `lib/publish` (`src/bin/publish.ts` → `src/publish.ts`) | GitHub-hosted, `id-token: write` |
| `actions/node/prepare-trusted-publishing` | `lib/prepare` (`src/bin/prepare.ts` → `src/repository.ts`) | GitHub-hosted jobs that run `npm publish` themselves |

npm trusted publishing (OIDC) does not accept self-hosted runners, so
`pack` does everything `pnpm -r publish` does except the upload: for every
unpublished non-private package, in dependency order, it runs
`prepublishOnly`, `prepublish` and `pnpm pack`. Packages with `publish` or
`postpublish` scripts are refused: those would run after the upload. `publish` uploads the tarballs with
`npm publish <tarball> --ignore-scripts`. The two halves share
`manifest.jsonl`, typed as `ManifestEntry` in `src/manifest.ts`.

## Manifest Format (Public)

`publish-tarballs` reads `<dir>/manifest.jsonl` plus the tarballs next to it.
`pack-unpublished` writes it, and repositories that pack themselves (e.g.
milaboratory/pframes-rs) write it by hand, so this format is a contract:
change it only compatibly. One JSON object per line, uploaded in file order:

```json
{"name": "@scope/pkg", "version": "1.2.3", "file": "scope-pkg-1.2.3.tgz",
 "registry": "https://registry.npmjs.org/", "tag": "", "access": "public"}
```

| Field | Rule |
|---|---|
| `name` | npm package name, lowercase |
| `version` | semver |
| `file` | tarball basename in the same directory, `.tgz` |
| `registry` | https URL; registry.npmjs.org (OIDC) or npm.pkg.github.com |
| `tag` | dist-tag, or `""` for `latest` |
| `access` | `""`, `public` or `restricted` |

Validation: `src/manifest.ts` (`validateEntry`).

## Behaviour worth knowing

- **`repository` for provenance.** Under trusted publishing npm turns
  provenance on by itself for a public npmjs package from a public repository,
  and the registry rejects the upload (E422) unless `package.json`
  `repository.url` names the repository that built it. For exactly those
  uploads `pack` fills in a missing `repository`
  (`git+https://github.com/<owner>/<repo>.git`, plus `directory`) in the packed
  copy only, checks the field reached the tarball, and fails before any script
  runs when a package declares a different repository (for example after a
  rename). Private repositories and GitHub Packages targets are left alone, so
  no private repository URL gets published.
- **Dist-tag.** Every upload passes `--tag`: `publishConfig.tag`, else `latest`.
  npm 11 refuses a prerelease or a version below the highest published one
  without an explicit tag; the previous path (npm 10 under pnpm) tagged those
  `latest`, so that stays the behaviour. Trade-off: if two releases of one
  repository overlap and their uploads finish out of order, `latest` can move
  back to the older version without an error (the old path could too, with a
  shorter window).
- **The upload job does not trust the artifact.** Every manifest value is
  validated; each tarball's manifest is read the way npm reads it (extracted
  with node-tar and pacote's options, `src/tarball.ts`) and must have the
  entry's name and version; a packed `publishConfig`
  may not set auth, proxy or scope-registry keys, nor a different `registry`
  (npm applies those packed keys that are not given on the command line).
  Values are passed as `--flag=value`, and npm runs from an empty directory so
  no `.npmrc` from the artifact is read. `GITHUB_TOKEN` is sent only to
  npm.pkg.github.com.
- **Fallback token.** With `npm-token-fallback`, the upload job takes
  `NPMJS_TOKEN` out of the caller's `env` secret and masks it before any step
  receives it; no other caller secret reaches that runner.
- **New packages.** npm accepts a trusted publisher only for a package that
  exists, and no token can publish any more, so `pack` refuses a package that
  registry.npmjs.org does not have yet, before any script runs: publish its
  first version by hand, add its trusted publisher, re-run the job.
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
