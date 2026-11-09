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
# Branch scope: only what the branch changed since it left the base.
# ---------------------------------------------------------------------------

@test "an edit that landed on the base after the branch left it is not the branch's" {
  git -C "${WORKSPACE}" checkout --quiet main
  touch_file 'packages/pkg-a/index.js'
  bump_catalog 'is-number' '^7.0.1'
  git -C "${WORKSPACE}" update-ref refs/remotes/origin/main main
  git -C "${WORKSPACE}" checkout --quiet feature
  touch_file 'README.md' 'feature-branch readme edit'
  run_check
  [ "${status}" -eq 0 ]
}

@test "moving a file out of a package is an edit of that package" {
  git -C "${WORKSPACE}" mv packages/pkg-a/index.js lib-index.js
  git -C "${WORKSPACE}" commit --quiet -m 'move pkg-a index out'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'- @check-coverage-test/pkg-a  (direct edit)'* ]]
}

# ---------------------------------------------------------------------------
# Catalog bumps.
#
# A package that takes a dependency from the catalog in `dependencies` or
# `peerDependencies` ships that dependency, so a changed catalog entry is a
# change of the package even when its own files are untouched.
# `devDependencies` and `optionalDependencies` do not count.
# ---------------------------------------------------------------------------

@test "catalog bump requires every runtime consumer" {
  bump_catalog 'is-number' '^7.0.1'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'- @check-coverage-test/pkg-a  (catalog bump: is-number)'* ]]
  [[ "${output}" == *'- @check-coverage-test/pkg-b  (catalog bump: is-number)'* ]]
  [[ "${output}" == *'- @check-coverage-test/pkg-peer  (catalog bump: is-number)'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-private'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-legacy'* ]]
}

@test "catalog bump does not require a devDependency consumer" {
  # is-string is a runtime dependency of pkg-c and a devDependency of pkg-dev.
  bump_catalog 'is-string' '^1.0.8'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'- @check-coverage-test/pkg-c  (catalog bump: is-string)'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-dev'* ]]
}

@test "catalog bump covered by a changeset passes" {
  bump_catalog 'is-string' '^1.0.8'
  add_changeset '"@check-coverage-test/pkg-c": patch' 'bump is-string'
  run_check
  [ "${status}" -eq 0 ]
}

@test "named catalog bump requires only that catalog's consumers" {
  edit_workspace_yaml '.catalogs.legacy."is-number" = "^6.0.1"' 'bump legacy is-number'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'- @check-coverage-test/pkg-legacy  (catalog bump: is-number)'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-a'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-peer'* ]]
}

@test "a new catalog entry nobody consumes requires nothing" {
  edit_workspace_yaml '.catalog."is-odd" = "^3.0.1"' 'add is-odd to the catalog'
  run_check
  [ "${status}" -eq 0 ]
}

@test "a pnpm-workspace.yaml change outside the catalogs requires nothing" {
  edit_workspace_yaml '.minimumReleaseAgeExclude = ["@check-coverage-test/*"]' 'add a workspace setting'
  run_check
  [ "${status}" -eq 0 ]
}

@test "catalog bump and direct edit are both reported" {
  touch_file 'packages/pkg-c/index.js'
  bump_catalog 'is-number' '^7.0.1'
  add_changeset '"@check-coverage-test/pkg-c": patch' 'edit pkg-c'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'- @check-coverage-test/pkg-a  (catalog bump: is-number)'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-c'* ]]
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
# Empty-changeset opt-out.
#
# `pnpm changeset --empty` is the committed "no release needed" statement. It
# waives coverage the same way it waives require-package-bump's half of the
# gate — an author who declares "no release" must not be failed by one half and
# passed by the other.
# ---------------------------------------------------------------------------

@test "an empty changeset added in this branch waives a coverage gap" {
  touch_file 'packages/pkg-a/index.js'
  add_empty_changeset
  run_check
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'coverage requirement waived'* ]]
}

@test "an empty changeset waives every missing package at once" {
  touch_file 'packages/pkg-a/index.js'
  touch_file 'packages/pkg-b/index.js'
  add_empty_changeset
  run_check
  [ "${status}" -eq 0 ]
}

@test "an empty changeset alongside a partial real changeset waives the rest" {
  touch_file 'packages/pkg-a/index.js'
  touch_file 'packages/pkg-b/index.js'
  add_changeset '"@check-coverage-test/pkg-a": patch' 'edit pkg-a'
  add_empty_changeset
  run_check
  [ "${status}" -eq 0 ]
}

# The opt-out is scoped to changesets ADDED in the branch. An empty changeset
# inherited from the base branch is present in the tree but was not added here,
# so it must not satisfy a new PR — otherwise one forgotten empty changeset on
# main would disable the gate for every branch cut afterwards.
@test "an empty changeset inherited from the base branch does not waive" {
  git -C "${WORKSPACE}" checkout --quiet main
  add_empty_changeset 'stale opt-out'
  git -C "${WORKSPACE}" update-ref refs/remotes/origin/main main
  git -C "${WORKSPACE}" checkout --quiet -B feature main
  touch_file 'packages/pkg-a/index.js'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-a'* ]]
}

# A real changeset added in the branch is not empty and must not be read as the
# opt-out, or naming one package would waive the requirement for all the others.
@test "a non-empty changeset is not treated as the opt-out" {
  touch_file 'packages/pkg-a/index.js'
  touch_file 'packages/pkg-b/index.js'
  add_changeset '"@check-coverage-test/pkg-a": patch' 'edit pkg-a'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-b'* ]]
}

# Exit 2 (tooling broken) must win over the waiver: with no changeset binary the
# coverage question is unanswerable, and an empty changeset must not convert
# that into a pass.
@test "an empty changeset does not mask a tooling failure" {
  rm -f "${WORKSPACE}/node_modules/.bin/changeset"
  touch_file 'packages/pkg-a/index.js'
  add_empty_changeset
  run_check
  [ "${status}" -eq 2 ]
  [[ "${output}" == *'changeset binary not found'* ]]
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
