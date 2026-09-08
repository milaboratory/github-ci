#!/usr/bin/env bats

load helpers.bash

setup_file() {
  _build_base_workspace "${BATS_FILE_TMPDIR}/base"
}

setup() {
  new_workspace
}

# ---------------------------------------------------------------------------
# Direct bump — the happy path.
# ---------------------------------------------------------------------------

@test "passes when the block package is bumped directly" {
  touch_file 'block/src/index.js'
  add_changeset '"@block-bump-test/block": patch' 'bump block'
  run_require
  [ "${status}" -eq 0 ]
}

@test "passes when block is bumped alongside a sibling changeset" {
  add_changeset '"@block-bump-test/model": patch' 'bump model'
  add_changeset '"@block-bump-test/block": minor' 'bump block'
  run_require
  [ "${status}" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Sibling-only / no changeset — must fail (not devDep-aware).
# ---------------------------------------------------------------------------

@test "fails when only a sibling changeset is present (no direct block bump)" {
  touch_file 'model/src/index.js'
  add_changeset '"@block-bump-test/model": patch' 'bump model only'
  run_require
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@block-bump-test/block'* ]]
}

@test "fails when every sibling is bumped but the block is not" {
  add_changeset '"@block-bump-test/model": patch' 'bump model'
  add_changeset '"@block-bump-test/ui": patch' 'bump ui'
  add_changeset '"@block-bump-test/workflow": patch' 'bump workflow'
  run_require
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'@block-bump-test/block'* ]]
}

# Anti-drift guard for the fixture, not for the script. A sibling-only
# changeset must leave the block in the release plan at type `none` — the
# shape the gate has to reject. `.changeset/config.json` must keep changesets'
# `privatePackages` default (versioning the private siblings), as every block
# repo does; setting it to `false` drops the siblings from the plan, removes
# this entry, and makes the sibling-only cases above pass for the wrong reason.
@test "fixture reproduces the cascade: sibling-only leaves block at type none" {
  add_changeset '"@block-bump-test/model": patch' 'bump model only'
  cd "${WORKSPACE}"
  ./node_modules/.bin/changeset status \
    --since=origin/main --output=cascade.json >/dev/null 2>&1 || true
  run jq -r '.releases[] | select(.name == "@block-bump-test/block") | .type' \
    cascade.json
  [ "${status}" -eq 0 ]
  [ "${output}" = 'none' ]
}

@test "fails when the block is edited without any changeset" {
  touch_file 'block/src/index.js'
  run_require
  [ "${status}" -eq 1 ]
  [[ "${output}" == *'not bumped'* ]]
}

@test "fails when there are no changesets at all" {
  run_require
  [ "${status}" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Empty-changeset opt-out.
# ---------------------------------------------------------------------------

@test "passes when an empty changeset is added in the branch" {
  touch_file 'block/src/index.js'
  add_changeset '' 'deliberately no release'
  run_require
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'Empty changeset'* ]]
}

@test "passes with an empty changeset even when a sibling also changed" {
  touch_file 'model/src/index.js'
  add_changeset '' 'no release needed'
  run_require
  [ "${status}" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Scoping — stale changesets on the base must not satisfy the branch.
# ---------------------------------------------------------------------------

@test "fails when the only empty changeset predates the branch (on base)" {
  add_changeset_on_base '' 'stale empty changeset'
  touch_file 'block/src/index.js'
  run_require
  [ "${status}" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Package-path resolution.
# ---------------------------------------------------------------------------

@test "tooling failure (exit 2) when package-path has no package.json" {
  run_require 'does-not-exist'
  [ "${status}" -eq 2 ]
}
