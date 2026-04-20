#!/usr/bin/env bash
#
# Unit tests for mirror-directory's input parsing and sync logic.
# Runs locally — no remote push, no docker, no act required.
#
# Tests:
#   1. directory-mappings: single pair
#   2. directory-mappings: multiple pairs
#   3. deprecated source-directory/target-directory (backward compat)
#   4. error: no inputs provided
#   5. error: missing colon in mapping
#   6. error: source directory not found
#   7. directory-mappings takes precedence over deprecated inputs
#   8. whitespace/empty lines in mappings are trimmed
#
# Usage:
#   ./test-parse-mappings.sh
#
set -euo pipefail

PASS=0
FAIL=0
TEST_ROOT=""

# ── Helpers ────────────────────────────────────────────────────

setup() {
  TEST_ROOT=$(mktemp -d)

  # Fake GITHUB_WORKSPACE with source dirs
  export GITHUB_WORKSPACE="${TEST_ROOT}/workspace"
  mkdir -p "${GITHUB_WORKSPACE}/helm/charts/platforma"
  echo "chart" > "${GITHUB_WORKSPACE}/helm/charts/platforma/Chart.yaml"
  mkdir -p "${GITHUB_WORKSPACE}/installation/aws"
  echo "cfn" > "${GITHUB_WORKSPACE}/installation/aws/cloudformation.yaml"

  # Fake target repo (local git)
  mkdir -p /tmp/_mirror-target
  git -C /tmp/_mirror-target init -q
  git -C /tmp/_mirror-target config core.hooksPath /dev/null
  git -C /tmp/_mirror-target commit --allow-empty -m "init" -q

  # Fake git env vars
  export GITHUB_SHA="abc123"
  export GITHUB_REF="refs/heads/main"

  # Init a git repo in workspace so log works
  git -C "${GITHUB_WORKSPACE}" init -q
  git -C "${GITHUB_WORKSPACE}" config core.hooksPath /dev/null
  git -C "${GITHUB_WORKSPACE}" add -A
  git -C "${GITHUB_WORKSPACE}" -c user.name=test -c user.email=test@test commit -m "test commit" -q
}

teardown() {
  rm -rf /tmp/_mirror-target "${TEST_ROOT}" 2>/dev/null || true
}

# Run the sync logic extracted from action.yml.
# Args: MAPPINGS SOURCE_DIR TARGET_DIR
# Returns: exit code, stdout/stderr captured in $OUTPUT
run_sync() {
  local mappings="${1:-}"
  local source_dir="${2:-}"
  local target_dir="${3:-}"

  OUTPUT=$(MAPPINGS="${mappings}" SOURCE_DIR="${source_dir}" TARGET_DIR="${target_dir}" \
    TARGET_BRANCH="main" bash -euo pipefail -c '
    PAIRS=()
    if [[ -n "${MAPPINGS}" ]]; then
      while IFS= read -r line; do
        line=$(echo "${line}" | xargs)
        [[ -n "${line}" ]] && PAIRS+=("${line}")
      done <<< "${MAPPINGS}"
    elif [[ -n "${SOURCE_DIR}" && -n "${TARGET_DIR}" ]]; then
      echo "DEPRECATED_WARNING"
      PAIRS+=("${SOURCE_DIR}:${TARGET_DIR}")
    else
      echo "ERROR: Either directory-mappings or both source-directory and target-directory must be set"
      exit 1
    fi

    for pair in "${PAIRS[@]}"; do
      SRC="${pair%%:*}"
      TGT="${pair#*:}"

      if [[ -z "${SRC}" || -z "${TGT}" || "${SRC}" == "${pair}" ]]; then
        echo "ERROR: Invalid mapping '"'"'${pair}'"'"' — expected format source:target"
        exit 1
      fi

      if [[ ! -d "${GITHUB_WORKSPACE}/${SRC}" ]]; then
        echo "ERROR: source directory '"'"'${SRC}'"'"' not found"
        exit 1
      fi

      DEST="/tmp/_mirror-target/${TGT}"
      mkdir -p "$(dirname "${DEST}")"
      rm -rf "${DEST}"
      cp -a "${GITHUB_WORKSPACE}/${SRC}" "${DEST}"
      git -C /tmp/_mirror-target add -A "${TGT}"
      echo "Synced ${SRC} -> ${TGT}"
    done

    cd /tmp/_mirror-target
    if git diff --cached --quiet; then
      echo "NO_CHANGES"
    else
      git -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null commit -m "sync: test" -q
      echo "COMMITTED"
    fi
  ' 2>&1)
  return $?
}

assert_contains() {
  local label="$1" expected="$2"
  if echo "${OUTPUT}" | grep -qF "${expected}"; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}"
    echo "    expected to contain: ${expected}"
    echo "    got: ${OUTPUT}"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local label="$1" unexpected="$2"
  if echo "${OUTPUT}" | grep -qF "${unexpected}"; then
    echo "  FAIL: ${label}"
    echo "    should not contain: ${unexpected}"
    echo "    got: ${OUTPUT}"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  fi
}

assert_exit() {
  local label="$1" expected="$2" actual="$3"
  if [[ "${actual}" -eq "${expected}" ]]; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label} (expected exit ${expected}, got ${actual})"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_exists() {
  local label="$1" path="$2"
  if [[ -f "${path}" ]]; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label} — file not found: ${path}"
    FAIL=$((FAIL + 1))
  fi
}

# ── Tests ──────────────────────────────────────────────────────

test_single_mapping() {
  echo "Test 1: directory-mappings — single pair"
  setup
  run_sync "helm/charts/platforma:charts/platforma" "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced output" "Synced helm/charts/platforma -> charts/platforma"
  assert_contains "committed" "COMMITTED"
  assert_file_exists "target file" "/tmp/_mirror-target/charts/platforma/Chart.yaml"
  teardown
}

test_multi_mapping() {
  echo "Test 2: directory-mappings — multiple pairs"
  setup
  run_sync "helm/charts/platforma:charts/platforma
installation/aws:infrastructure/aws" "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced helm" "Synced helm/charts/platforma -> charts/platforma"
  assert_contains "synced aws" "Synced installation/aws -> infrastructure/aws"
  assert_contains "committed" "COMMITTED"
  assert_file_exists "helm target" "/tmp/_mirror-target/charts/platforma/Chart.yaml"
  assert_file_exists "aws target" "/tmp/_mirror-target/infrastructure/aws/cloudformation.yaml"
  teardown
}

test_deprecated_inputs() {
  echo "Test 3: deprecated source-directory/target-directory"
  setup
  run_sync "" "helm/charts/platforma" "charts/platforma"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "deprecation warning" "DEPRECATED_WARNING"
  assert_contains "synced output" "Synced helm/charts/platforma -> charts/platforma"
  assert_file_exists "target file" "/tmp/_mirror-target/charts/platforma/Chart.yaml"
  teardown
}

test_no_inputs() {
  echo "Test 4: error — no inputs"
  setup
  rc=0; run_sync "" "" "" || rc=$?
  assert_exit "exit 1" 1 "${rc}"
  assert_contains "error message" "Either directory-mappings or both source-directory and target-directory must be set"
  teardown
}

test_missing_colon() {
  echo "Test 5: error — missing colon in mapping"
  setup
  rc=0; run_sync "helm/charts/platforma" "" "" || rc=$?
  assert_exit "exit 1" 1 "${rc}"
  assert_contains "error message" "Invalid mapping"
  teardown
}

test_source_not_found() {
  echo "Test 6: error — source directory not found"
  setup
  rc=0; run_sync "nonexistent/dir:target/dir" "" "" || rc=$?
  assert_exit "exit 1" 1 "${rc}"
  assert_contains "error message" "source directory 'nonexistent/dir' not found"
  teardown
}

test_mappings_takes_precedence() {
  echo "Test 7: directory-mappings takes precedence over deprecated inputs"
  setup
  run_sync "installation/aws:infra/aws" "helm/charts/platforma" "charts/platforma"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced aws" "Synced installation/aws -> infra/aws"
  assert_not_contains "no helm sync" "Synced helm/charts/platforma"
  assert_not_contains "no deprecation" "DEPRECATED_WARNING"
  teardown
}

test_whitespace_trimming() {
  echo "Test 8: whitespace and empty lines in mappings are trimmed"
  setup
  run_sync "
  helm/charts/platforma:charts/platforma

  installation/aws:infrastructure/aws
  " "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced helm" "Synced helm/charts/platforma -> charts/platforma"
  assert_contains "synced aws" "Synced installation/aws -> infrastructure/aws"
  teardown
}

test_noop_no_commit() {
  echo "Test 9: no-op — identical content produces no commit"
  setup
  # First sync
  run_sync "helm/charts/platforma:charts/platforma" "" ""
  # Second sync (same content)
  run_sync "helm/charts/platforma:charts/platforma" "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "no changes" "NO_CHANGES"
  teardown
}

# ── Run all ────────────────────────────────────────────────────

echo "=== mirror-directory: input parsing tests ==="
echo ""

test_single_mapping;       echo ""
test_multi_mapping;        echo ""
test_deprecated_inputs;    echo ""
test_no_inputs;            echo ""
test_missing_colon;        echo ""
test_source_not_found;     echo ""
test_mappings_takes_precedence; echo ""
test_whitespace_trimming;  echo ""
test_noop_no_commit;       echo ""

echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
