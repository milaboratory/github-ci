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
# Catalog bumps.
# ---------------------------------------------------------------------------

@test "catalog bump without consumer bumps fails and names every consumer" {
  bump_catalog 'is-number' '^7.0.1'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-a'* ]]
  [[ "${output}" == *'@check-coverage-test/pkg-b'* ]]
  # pkg-c consumes is-string, not is-number — should not be flagged.
  [[ "${output}" != *'@check-coverage-test/pkg-c'* ]]
}

@test "catalog bump with both consumers bumped passes" {
  bump_catalog 'is-number' '^7.0.1'
  add_changeset '"@check-coverage-test/pkg-a": patch
"@check-coverage-test/pkg-b": patch' 'bump is-number'
  run_check
  [ "${status}" -eq 0 ]
}

@test "catalog bump where only one consumer is bumped still fails for the other" {
  bump_catalog 'is-number' '^7.0.1'
  add_changeset '"@check-coverage-test/pkg-a": patch' 'bump is-number partial'
  run_check
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@check-coverage-test/pkg-b'* ]]
  [[ "${output}" != *'- @check-coverage-test/pkg-a'* ]]
}

@test "non-catalog YAML edits in pnpm-workspace.yaml don't trigger requirements" {
  # An `overrides` entry that happens to share a name with a catalog key.
  # Bumping it must NOT be treated as a catalog change — yq's structural
  # parse ignores anything outside .catalog / .catalogs.
  yq -i '.overrides."is-number" = "^7.0.5"' "${WORKSPACE}/pnpm-workspace.yaml"
  git -C "${WORKSPACE}" commit --quiet -am 'bump override (not catalog)'
  run_check
  [ "${status}" -eq 0 ]
}

@test "catalog bump for an unused key does not require any package" {
  # Add then bump a catalog entry no one consumes.
  yq -i '.catalog."unused-pkg" = "^1.0.0"' "${WORKSPACE}/pnpm-workspace.yaml"
  git -C "${WORKSPACE}" commit --quiet -am 'add unused catalog key'
  bump_catalog 'unused-pkg' '^1.0.1'
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
