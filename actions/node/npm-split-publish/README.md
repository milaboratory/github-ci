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
`pnpm publish <tarball>` (pnpm 11+ publishes natively, with OIDC and
provenance). Registry lookups use `pnpm config get` and `pnpm view`; only
pnpm 9 and 10 run npm for `pnpm view`, so the upload never needs npm. The two halves share `manifest.jsonl`, typed as `ManifestEntry`
in `src/manifest.ts`.

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
- **Dist-tag.** An upload passes `--tag` only for `publishConfig.tag`; pnpm
  ignores a packed `publishConfig.tag` and defaults to `latest`, also for a
  prerelease or a version below the highest published one, as before. A
  packed top-level `tag` wins over `--tag` in pnpm 12, so it must equal the
  tag the upload uses. Trade-off: if two releases of one
  repository overlap and their uploads finish out of order, `latest` can move
  back to the older version without an error (the old path could too, with a
  shorter window).
- **The upload job does not trust the artifact.** Every manifest value is
  validated; each tarball's manifest is read the way pnpm reads it (the last
  entry named `package/package.json`, `src/tarball.ts`), and archives where tar
  readers can disagree (duplicate manifests, data after the end marker, a
  second gzip member, pax `size`, global pax headers, more than 2 GiB
  unpacked) are refused. This mirrors pnpm 12, so the upload fails before the
  first package with an older pnpm. The manifest must have the entry's name
  and version; a packed `publishConfig` may not set `@<scope>:registry` nor a
  different `registry` (pnpm 12 prefers both to `--registry`; of the packed
  `publishConfig` it also reads `access`, which a flag overrides). Values are
  passed as `--flag=value`, and pnpm runs from an empty temporary directory,
  so it reads no `.npmrc` from the artifact and skips its git checks.
  `GITHUB_TOKEN` is sent only to npm.pkg.github.com.
- **pnpm on the upload runner.** `publish-tarballs` installs pnpm
  `pnpm-version` with `setup-pnpm` (`pnpm/setup`) in `$RUNNER_TEMP`, without the caller's
  `packageManager` or `devEngines`, and puts it first on `PATH` for the rest
  of the job (`PATH`, `PNPM_HOME`). Its own script runs on the runner's
  Node. `pnpm/setup` is a node24 action: a self-hosted runner needs a runner
  version with node24.
- **Registry auth while packing.** The lookups use pnpm's config at
  GITHUB_WORKSPACE, as `pnpm install` does. pnpm 11.5.3+ ignores `${VAR}`
  tokens in a project `.npmrc`; such repositories keep registry auth in a
  user-level `.npmrc`.
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
and fakes only `pnpm view`. CI runs it with pnpm 9.12 (what block repos pin),
the repo's pnpm, and the pnpm of `publish-tarballs`. `test/tarball.test.ts`
and the real-pnpm case in `test/publish.test.ts` compare with
`pnpm publish --dry-run` and skip below pnpm 12 (CI sets
`REQUIRE_REAL_PNPM=1`, which turns the skip into a failure). Other tests replace pnpm with
a fake `Runner`.
