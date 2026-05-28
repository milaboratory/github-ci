# `check-coverage` tests

Bats suite for `../check-coverage.sh`.

## Run locally

From the action directory:

```bash
cd actions/changeset/check-coverage
bats test/coverage.bats
```

Or from anywhere in the worktree:

```bash
bats actions/changeset/check-coverage/test/coverage.bats
```

The first run takes ~30s (one `pnpm install` into the shared fixture).
Subsequent assertions reuse that install — each test only does a tar copy
and a couple of git ops.

## Dependencies

| Tool   | macOS                 | ubuntu-latest |
| ------ | --------------------- | ------------- |
| `bats` | `brew install bats-core` | `apt-get install -y bats` |
| `yq`   | `brew install yq`     | preinstalled  |
| `jq`   | preinstalled          | preinstalled  |
| `pnpm` | `brew install pnpm`   | `pnpm/action-setup@v4` |
| `node` | any modern version    | `actions/setup-node@v4` |

## How it works

- `helpers.bash` builds a single base workspace under `$BATS_FILE_TMPDIR/base`
  in `setup_file`: copies the fixture, runs `pnpm install`, inits a git repo
  with `gc.auto=0` (suppresses the async repack that would otherwise race
  the tar copy), commits, and synthesizes an `origin/main` ref.
- Each test (`setup`) tars the base into `$BATS_TEST_TMPDIR/ws`, switches
  to a `feature` branch, applies mutations via the helpers
  (`touch_file`, `add_changeset`, `bump_catalog`), and runs the script
  with `BASE_BRANCH=main`. The test asserts on the script's exit code and
  the captured `$output`.

## Fixture

`fixtures/minimal-workspace/` — small pnpm workspace:

- `packages/pkg-a`, `packages/pkg-b` — both consume `is-number` via `catalog:`
- `packages/pkg-c` — consumes `is-string` via `catalog:`
- `packages/pkg-private` — `"private": true`, never requires a bump

## CI

`.github/workflows/0-test-changeset-coverage.yaml` runs the suite on
`pull_request` and `push` (`v4`, `v4-beta`) whenever files under
`actions/changeset/check-coverage/**` or the workflow itself change.

## Adding a test

```bats
@test "describe the contract" {
  touch_file 'packages/pkg-a/index.js'        # mutate
  add_changeset '"@check-coverage-test/pkg-a": patch' 'edit pkg-a'
  run_check                                   # sets $status, $output
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'expected substring'* ]]
}
```

The helpers in `helpers.bash` cover the common mutations. Drop down to
raw `git -C "${WORKSPACE}"` calls or `yq -i` edits when you need
something they don't.
