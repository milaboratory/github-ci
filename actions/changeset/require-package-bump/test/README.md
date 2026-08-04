# `require-package-bump` tests

Bats suite for `../require-package-bump.sh`.

## Run locally

From the action directory:

```bash
cd actions/changeset/require-package-bump
bats test/require-package-bump.bats
```

Or from anywhere in the worktree:

```bash
bats actions/changeset/require-package-bump/test/require-package-bump.bats
```

The first run does one `pnpm install` into the shared fixture; subsequent
assertions reuse it (each test only tars a copy and runs a couple of git ops).

## Dependencies

| Tool   | macOS                    | ubuntu-latest             |
| ------ | ------------------------ | ------------------------- |
| `bats` | `brew install bats-core` | `apt-get install -y bats` |
| `jq`   | preinstalled             | preinstalled              |
| `pnpm` | `brew install pnpm`      | `pnpm/action-setup@v4`    |
| `node` | any modern version       | `actions/setup-node@v4`   |

## Fixture

`fixtures/block-workspace` mirrors a block repo: a publishable `block` package
(`@block-bump-test/block`) whose private `model`/`ui`/`workflow` siblings are
reached via `workspace:*` **devDependencies** — the topology where stock
`changeset version` never cascades a sibling bump into the block, so the gate
must require the block to be named directly.

## How it works

- `helpers.bash` builds a single base workspace under `$BATS_FILE_TMPDIR/base`
  in `setup_file`: copies the fixture, runs `pnpm install`, inits a git repo
  with `gc.auto=0`, commits on `main`, and synthesizes an `origin/main` ref.
- Each test (`setup`) tars the base into `$BATS_TEST_TMPDIR/ws` and switches to
  a `feature` branch; `add_changeset` / `touch_file` / `add_changeset_on_base`
  stage the scenario; `run_require` runs the script with `PACKAGE_PATH=block`
  and `BASE_BRANCH=main`.
