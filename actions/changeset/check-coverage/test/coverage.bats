#!/usr/bin/env bats

load helpers.bash

setup_file() {
  _build_base_workspace "${BATS_FILE_TMPDIR}/base"
}

setup() {
  new_workspace
}

# ---------------------------------------------------------------------------
# Direct edits.
# ---------------------------------------------------------------------------

@test "passes when nothing under any package changes" {
  touch_file 'README.md' 'workspace-root readme edit'
  run_check
  [ "${status}" -eq 0 ]
}

@test "passes when only docs/ at workspace root changes" {
  touch_file 'docs/overview.md' 'doc update'
  run_check
  [ "${status}" -eq 0 ]
}

@test "fails when a package is edited without a changeset" {
  touch_file 'packages/pkg-a/index.js'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-a'* ]]
}

@test "passes when a package is edited and a matching changeset is added" {
  touch_file 'packages/pkg-a/index.js'
  add_changeset '"@check-coverage-test/pkg-a": patch' 'edit pkg-a'
  run_check
  [ "${status}" -eq 0 ]
}

@test "edit to a private package never requires a bump" {
  touch_file 'packages/pkg-private/index.js'
  run_check
  [ "${status}" -eq 0 ]
}

@test "reports every missing package, not just the first" {
  touch_file 'packages/pkg-a/index.js'
  touch_file 'packages/pkg-b/index.js'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-a'* ]]
  [[ "${output}" == *'@check-coverage-test/pkg-b'* ]]
}

@test "reports only the still-missing package when one of many is covered" {
  touch_file 'packages/pkg-a/index.js'
  touch_file 'packages/pkg-b/index.js'
  add_changeset '"@check-coverage-test/pkg-a": patch' 'edit pkg-a'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-b'* ]]
  # The covered package should not appear in the missing list.
  [[ "${output}" != *'- @check-coverage-test/pkg-a'* ]]
}

# ---------------------------------------------------------------------------
# Catalog / dependency bumps — intentionally NOT a coverage requirement.
#
# A catalog entry always pins an *external* package: workspace packages are
# referenced via `workspace:*`, never `catalog:`. `pnpm changeset` never adds
# a package to its release plan because an external dependency's version
# changed, and it propagates version bumps through the internal dependency
# chain automatically at `changeset version` time. So a catalog bump on its
# own requires no hand-written changeset — requiring one over-reports relative
# to `pnpm changeset`.
#
# Regression: platforma-open/clonotype-space#95. The `.workflow` package listed
# `@platforma-sdk/workflow-tengo` under `dependencies` as `catalog:`; the
# catalog bumped it (5.25.0 → 6.3.2) while the package's own files were
# untouched. The PR's changeset (model/ui/block) was complete per
# `pnpm changeset`, yet the old check failed the PR on `.workflow`.
# ---------------------------------------------------------------------------

@test "catalog bump alone requires no changeset (consumer files untouched)" {
  # pkg-a and pkg-b both consume is-number via `dependencies: { is-number: catalog: }`
  # — exactly the clonotype-space `.workflow` → workflow-tengo shape. Bumping
  # the catalog without touching either package must pass.
  bump_catalog 'is-number' '^7.0.1'
  run_check
  [ "${status}" -eq 0 ]
}

@test "runtime vs dev catalog dep is irrelevant — neither is flagged" {
  # is-string is a runtime dep of pkg-c and a devDependency of pkg-dev. Bumping
  # it flags neither: a dependency-version bump never requires a changeset.
  bump_catalog 'is-string' '^1.0.8'
  run_check
  [ "${status}" -eq 0 ]
}

@test "catalog bump alongside a direct edit only requires the edited package" {
  # The simultaneous is-number catalog bump adds no requirements: only pkg-c,
  # whose own files changed, must be covered. pkg-a/pkg-b consume is-number but
  # were not edited.
  touch_file 'packages/pkg-c/index.js'
  bump_catalog 'is-number' '^7.0.1'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-c'* ]]
  [[ "${output}" != *'@check-coverage-test/pkg-a'* ]]
  [[ "${output}" != *'@check-coverage-test/pkg-b'* ]]
}

@test "direct edit covered by a changeset passes even with a concurrent catalog bump" {
  touch_file 'packages/pkg-c/index.js'
  bump_catalog 'is-number' '^7.0.1'
  add_changeset '"@check-coverage-test/pkg-c": patch' 'edit pkg-c'
  run_check
  [ "${status}" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Empty-changeset corner case.
# ---------------------------------------------------------------------------

@test "no changesets at all + irrelevant edit passes" {
  touch_file 'README.md' 'no-package change'
  run_check
  [ "${status}" -eq 0 ]
}

@test "no changesets at all + package edit fails" {
  touch_file 'packages/pkg-c/index.js'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-c'* ]]
}

# ---------------------------------------------------------------------------
# Base-branch input.
# ---------------------------------------------------------------------------

# Production callers pass `inputs.changeset-default-branch` (typically `v4`
# in this repo, `master` in others). The script touches `origin/${BASE_BRANCH}`
# in five places — this guards against any of them regressing to a hardcoded
# `main`.
@test "respects BASE_BRANCH input (works against origin/v4, not just main)" {
  git -C "${WORKSPACE}" update-ref refs/remotes/origin/v4 refs/remotes/origin/main
  git -C "${WORKSPACE}" update-ref -d refs/remotes/origin/main
  touch_file 'packages/pkg-a/index.js'
  cd "${WORKSPACE}"
  BASE_BRANCH=v4 run "${SCRIPT_UNDER_TEST}"
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-a'* ]]
}

# ---------------------------------------------------------------------------
# Tooling failures.
# ---------------------------------------------------------------------------

# Exit 2 is the contract for "tooling broken, can't determine coverage" —
# distinct from exit 1 ("gap found"). Without this, a regression that turns
# a missing binary into a silent pass-through wouldn't be caught.
@test "exit 2 when changeset binary is missing" {
  rm -f "${WORKSPACE}/node_modules/.bin/changeset"
  touch_file 'packages/pkg-a/index.js'
  run_check
  [ "${status}" -eq 2 ]
  [[ "${output}" == *'changeset binary not found'* ]]
}
