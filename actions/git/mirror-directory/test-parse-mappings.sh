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
# Args: MAPPINGS SOURCE_DIR TARGET_DIR [KEEP_PATHS] [FILE_MAPPINGS]
# Returns: exit code, stdout/stderr captured in $OUTPUT
run_sync() {
  local mappings="${1:-}"
  local source_dir="${2:-}"
  local target_dir="${3:-}"
  local keep_paths="${4:-}"
  local file_mappings="${5:-}"

  OUTPUT=$(MAPPINGS="${mappings}" SOURCE_DIR="${source_dir}" TARGET_DIR="${target_dir}" \
    KEEP_PATHS="${keep_paths}" FILE_MAPPINGS="${file_mappings}" \
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

    # Parse keep-without-changes paths
    KEEP=()
    if [[ -n "${KEEP_PATHS}" ]]; then
      while IFS= read -r kp; do
        kp=$(echo "${kp}" | xargs)
        [[ -n "${kp}" ]] && KEEP+=("${kp}")
      done <<< "${KEEP_PATHS}"
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

      if [[ "${TGT}" == "." ]]; then
        cd /tmp/_mirror-target

        # Move kept paths to temp location
        KEEP_TMP=$(mktemp -d)
        for kp in "${KEEP[@]}"; do
          if [[ -e "${kp}" ]]; then
            mkdir -p "${KEEP_TMP}/$(dirname "${kp}")"
            mv "${kp}" "${KEEP_TMP}/${kp}"
          fi
        done

        # Remove everything except .git
        find . -maxdepth 1 -mindepth 1 ! -name ".git" -exec rm -rf {} +

        # Copy source contents
        cp -a "${GITHUB_WORKSPACE}/${SRC}/." ./

        # Restore kept paths
        for kp in "${KEEP[@]}"; do
          if [[ -e "${KEEP_TMP}/${kp}" ]]; then
            mkdir -p "$(dirname "${kp}")"
            rm -rf "${kp}"
            mv "${KEEP_TMP}/${kp}" "${kp}"
          fi
        done
        rm -rf "${KEEP_TMP}"

        cd - > /dev/null
        git -C /tmp/_mirror-target add -A .
        echo "Synced ${SRC} -> . (root)"
      else
        DEST="/tmp/_mirror-target/${TGT}"
        mkdir -p "$(dirname "${DEST}")"
        rm -rf "${DEST}"
        cp -a "${GITHUB_WORKSPACE}/${SRC}" "${DEST}"
        git -C /tmp/_mirror-target add -A "${TGT}"
        echo "Synced ${SRC} -> ${TGT}"
      fi
    done

    # Process file mappings
    if [[ -n "${FILE_MAPPINGS}" ]]; then
      while IFS= read -r line; do
        line=$(echo "${line}" | xargs)
        [[ -z "${line}" ]] && continue

        SRC="${line%%:*}"
        TGT="${line#*:}"

        if [[ -z "${SRC}" || -z "${TGT}" || "${SRC}" == "${line}" ]]; then
          echo "ERROR: Invalid file mapping '"'"'${line}'"'"'"
          exit 1
        fi

        if [[ ! -f "${GITHUB_WORKSPACE}/${SRC}" ]]; then
          echo "ERROR: source file '"'"'${SRC}'"'"' not found"
          exit 1
        fi

        DEST="/tmp/_mirror-target/${TGT}"
        mkdir -p "$(dirname "${DEST}")"
        cp -a "${GITHUB_WORKSPACE}/${SRC}" "${DEST}"
        git -C /tmp/_mirror-target add "${TGT}"
        echo "Synced file ${SRC} -> ${TGT}"
      done <<< "${FILE_MAPPINGS}"
    fi

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

test_root_mapping() {
  echo "Test 10: directory-mappings — root target (.)"
  setup
  run_sync "helm/charts/platforma:." "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced root" "Synced helm/charts/platforma -> . (root)"
  assert_contains "committed" "COMMITTED"
  assert_file_exists "file at target root" "/tmp/_mirror-target/Chart.yaml"
  teardown
}

test_root_mapping_prunes_old_files() {
  echo "Test 11: root mapping prunes files not in source"
  setup
  # Pre-populate target with a file that doesn't exist in source
  echo "old" > /tmp/_mirror-target/stale-file.txt
  git -C /tmp/_mirror-target add stale-file.txt
  git -C /tmp/_mirror-target -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add stale" -q

  run_sync "helm/charts/platforma:." "" ""
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_file_exists "source file synced" "/tmp/_mirror-target/Chart.yaml"
  if [[ -f "/tmp/_mirror-target/stale-file.txt" ]]; then
    echo "  FAIL: stale-file.txt should have been pruned"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: stale-file.txt pruned"
    PASS=$((PASS + 1))
  fi
  teardown
}

test_keep_without_changes() {
  echo "Test 12: keep-without-changes preserves paths during root sync"
  setup
  # Pre-populate target with a protected directory
  mkdir -p /tmp/_mirror-target/.github/workflows
  echo "publish" > /tmp/_mirror-target/.github/workflows/publish.yaml
  git -C /tmp/_mirror-target add .github/
  git -C /tmp/_mirror-target -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add .github" -q

  run_sync "helm/charts/platforma:." "" "" ".github"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_file_exists "source file synced" "/tmp/_mirror-target/Chart.yaml"
  assert_file_exists "kept .github intact" "/tmp/_mirror-target/.github/workflows/publish.yaml"
  teardown
}

test_keep_without_changes_multiple() {
  echo "Test 13: keep-without-changes with multiple paths"
  setup
  mkdir -p /tmp/_mirror-target/.github/workflows
  echo "ci" > /tmp/_mirror-target/.github/workflows/ci.yaml
  mkdir -p /tmp/_mirror-target/CNAME
  echo "example.com" > /tmp/_mirror-target/CNAME/file
  git -C /tmp/_mirror-target add .github/ CNAME/
  git -C /tmp/_mirror-target -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add protected dirs" -q

  run_sync "helm/charts/platforma:." "" "" ".github
CNAME"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_file_exists "kept .github" "/tmp/_mirror-target/.github/workflows/ci.yaml"
  assert_file_exists "kept CNAME" "/tmp/_mirror-target/CNAME/file"
  assert_file_exists "source synced" "/tmp/_mirror-target/Chart.yaml"
  teardown
}

test_keep_without_changes_nested() {
  echo "Test 14: keep-without-changes with nested subfolder path"
  setup
  # Source has charts/ with platforma only
  mkdir -p "${GITHUB_WORKSPACE}/helm/charts/platforma"
  echo "chart" > "${GITHUB_WORKSPACE}/helm/charts/platforma/Chart.yaml"
  git -C "${GITHUB_WORKSPACE}" add -A
  git -C "${GITHUB_WORKSPACE}" -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit --amend -m "update" -q

  # Target has charts/platforma-local that should be kept
  mkdir -p /tmp/_mirror-target/charts/platforma-local/templates
  echo "local-chart" > /tmp/_mirror-target/charts/platforma-local/Chart.yaml
  echo "local-tpl" > /tmp/_mirror-target/charts/platforma-local/templates/deploy.yaml
  git -C /tmp/_mirror-target add charts/
  git -C /tmp/_mirror-target -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add platforma-local" -q

  run_sync "helm:." "" "" "charts/platforma-local"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_file_exists "source chart synced" "/tmp/_mirror-target/charts/platforma/Chart.yaml"
  assert_file_exists "nested kept: Chart.yaml" "/tmp/_mirror-target/charts/platforma-local/Chart.yaml"
  assert_file_exists "nested kept: template" "/tmp/_mirror-target/charts/platforma-local/templates/deploy.yaml"
  teardown
}

test_file_mappings() {
  echo "Test 15: file-mappings copies individual files"
  setup
  # Create a source file
  echo "readme content" > "${GITHUB_WORKSPACE}/helm/README.md"
  git -C "${GITHUB_WORKSPACE}" add -A
  git -C "${GITHUB_WORKSPACE}" -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add readme" -q

  run_sync "helm/charts/platforma:charts/platforma" "" "" "" "helm/README.md:README.md"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  assert_contains "synced file" "Synced file helm/README.md -> README.md"
  assert_file_exists "file at target" "/tmp/_mirror-target/README.md"
  teardown
}

test_file_mapping_overwrites_dir_mapping() {
  echo "Test 16: file-mappings overwrites file from directory sync"
  setup
  # Create a .gitignore in source dir and a separate override
  echo "pl-specific-ignore" > "${GITHUB_WORKSPACE}/helm/charts/platforma/.gitignore"
  echo "target-specific-ignore" > "${GITHUB_WORKSPACE}/helm/override-gitignore"
  git -C "${GITHUB_WORKSPACE}" add -A
  git -C "${GITHUB_WORKSPACE}" -c user.name=test -c user.email=test@test -c core.hooksPath=/dev/null \
    commit -m "add gitignores" -q

  run_sync "helm/charts/platforma:." "" "" "" "helm/override-gitignore:.gitignore"
  rc=$?
  assert_exit "exit 0" 0 "${rc}"
  # file-mapping should overwrite the .gitignore from dir sync
  CONTENT=$(cat /tmp/_mirror-target/.gitignore)
  if [[ "${CONTENT}" == "target-specific-ignore" ]]; then
    echo "  PASS: file-mapping overwrote dir-synced file"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: expected file-mapping to overwrite, got: ${CONTENT}"
    FAIL=$((FAIL + 1))
  fi
  teardown
}

# ── Run all ────────────────────────────────────────────────────

echo "=== mirror-directory: input parsing tests ==="
echo ""

test_single_mapping;                  echo ""
test_multi_mapping;                   echo ""
test_deprecated_inputs;               echo ""
test_no_inputs;                       echo ""
test_missing_colon;                   echo ""
test_source_not_found;                echo ""
test_mappings_takes_precedence;       echo ""
test_whitespace_trimming;             echo ""
test_noop_no_commit;                  echo ""
test_root_mapping;                    echo ""
test_root_mapping_prunes_old_files;   echo ""
test_keep_without_changes;            echo ""
test_keep_without_changes_multiple;   echo ""
test_keep_without_changes_nested;     echo ""
test_file_mappings;                   echo ""
test_file_mapping_overwrites_dir_mapping; echo ""

echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
