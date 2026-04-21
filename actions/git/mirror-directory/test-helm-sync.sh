#!/usr/bin/env bash
#
# Test the mirror-directory action end-to-end using act.
#
# This script:
#   1. Creates a test branch in pl/ with 3 helm commits (source snapshot)
#   2. Runs the test workflow (snapshot, no-op, tag-sync + cleanup)
#   3. Cleans up the local test branch
#
# Usage:
#   ./test-helm-sync.sh                    # full run (all 3 tests)
#   ./test-helm-sync.sh --dry-run          # validate YAML only
#   ./test-helm-sync.sh --job snapshot     # run a single job
#   ./test-helm-sync.sh --setup-only       # create test branch, don't run
#   ./test-helm-sync.sh --cleanup-only     # delete test branch + remote leftovers
#
# Requirements:
#   - act, docker, gh CLI
#   - pl/ repo checked out as a sibling or worktree
#   - github-ci/ repo (this repo) checked out as a sibling
#
set -euo pipefail

# ── Resolve paths ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW="${SCRIPT_DIR}/test-helm-sync.yaml"

# Find pl/ repo: look for common workspace layouts
# task worktree:  <root>/github-ci/actions/git/mirror-directory/ → <root>/pl/
# normal layout:  <root>/github-ci/ and <root>/pl/ side by side
TASK_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PL_DIR="${TASK_ROOT}/pl"
GITHUB_CI_DIR="${TASK_ROOT}/github-ci"

if [[ ! -d "${PL_DIR}" ]]; then
  echo "ERROR: pl/ repo not found at ${PL_DIR}"
  echo "Expected layout: <workspace>/pl/ and <workspace>/github-ci/ side by side"
  exit 1
fi

if [[ ! -f "${WORKFLOW}" ]]; then
  echo "ERROR: test workflow not found at ${WORKFLOW}"
  exit 1
fi

# ── Resolve git dir for worktree mount ─────────────────────────
# pl/ might be a worktree (`.git` is a file, not a directory).
# We need to mount the real .git dir into the container.
resolve_git_dir() {
  local dir="$1"
  if [[ -f "${dir}/.git" ]]; then
    # Worktree: .git is a file like "gitdir: /path/to/.git/worktrees/name"
    local gitdir
    gitdir=$(sed 's/^gitdir: //' "${dir}/.git")
    # Resolve to absolute path
    if [[ "${gitdir}" != /* ]]; then
      gitdir="$(cd "${dir}" && cd "$(dirname "${gitdir}")" && pwd)/$(basename "${gitdir}")"
    fi
    # The worktree's commondir points to the main .git
    local commondir
    commondir=$(cat "${gitdir}/commondir" 2>/dev/null || echo "../..")
    if [[ "${commondir}" != /* ]]; then
      commondir="$(cd "${gitdir}" && cd "${commondir}" && pwd)"
    fi
    echo "${commondir}"
  else
    echo "${dir}/.git"
  fi
}

MAIN_GIT_DIR="$(resolve_git_dir "${PL_DIR}")"
echo "pl/ repo:       ${PL_DIR}"
echo "Main .git dir:  ${MAIN_GIT_DIR}"
echo "Workflow:       ${WORKFLOW}"
echo ""

# ── Constants ──────────────────────────────────────────────────
TEST_BRANCH="test-helm-sync-verify"
ORIGINAL_BRANCH=""
TARGET_REPO="milaboratory/platforma-helm"

# ── Helpers ────────────────────────────────────────────────────
cleanup_remote() {
  echo "Cleaning up remote leftovers..."
  for b in _test-sync-snapshot _test-sync-no-op _test-sync-tag _test-sync-multi _test-sync-root; do
    gh api -X DELETE "repos/${TARGET_REPO}/git/refs/heads/${b}" 2>/dev/null && \
      echo "  ✓ deleted branch ${b}" || true
  done
  gh api -X DELETE "repos/${TARGET_REPO}/git/refs/tags/v99.0.0-sync-test" 2>/dev/null && \
    echo "  ✓ deleted tag v99.0.0-sync-test" || true
}

cleanup_local() {
  cd "${PL_DIR}"
  if [[ -n "${ORIGINAL_BRANCH}" ]]; then
    git checkout "${ORIGINAL_BRANCH}" 2>/dev/null || true
  fi
  git branch -D "${TEST_BRANCH}" 2>/dev/null && \
    echo "  ✓ deleted local branch ${TEST_BRANCH}" || true
  git tag -d v99.0.0-sync-test 2>/dev/null || true
}

setup_test_branch() {
  cd "${PL_DIR}"
  ORIGINAL_BRANCH=$(git branch --show-current || git rev-parse HEAD)

  if git show-ref --verify --quiet "refs/heads/${TEST_BRANCH}" 2>/dev/null; then
    echo "Test branch ${TEST_BRANCH} already exists, reusing it."
    git checkout "${TEST_BRANCH}"
    return
  fi

  echo "Creating test branch with 3 helm commits..."
  git checkout -b "${TEST_BRANCH}"

  # Commit 1: new template
  cat > helm/charts/platforma/templates/test-configmap.yaml << 'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "platforma.fullname" . }}-test
  labels:
    {{- include "platforma.labels" . | nindent 4 }}
data:
  test-key: "sync-commit-1"
YAML
  git add helm/charts/platforma/templates/test-configmap.yaml
  git commit -m "test: add test configmap (commit 1/3)"

  # Commit 2: modify Chart.yaml
  sed -i.bak 's/description: Platforma.*/description: Platforma - Bioinformatics platform for Kubernetes (sync test)/' \
    helm/charts/platforma/Chart.yaml
  rm -f helm/charts/platforma/Chart.yaml.bak
  git add helm/charts/platforma/Chart.yaml
  git commit -m "test: update chart description (commit 2/3)"

  # Commit 3: another template
  cat > helm/charts/platforma/templates/test-secret.yaml << 'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "platforma.fullname" . }}-test-secret
  labels:
    {{- include "platforma.labels" . | nindent 4 }}
type: Opaque
data:
  sync-marker: {{ "commit-3" | b64enc | quote }}
YAML
  git add helm/charts/platforma/templates/test-secret.yaml
  git commit -m "test: add test secret template (commit 3/3)"

  # Commit 4: add installation/aws test data for multi-directory test
  mkdir -p installation/aws
  echo "cfn-test-content" > installation/aws/cloudformation-test.yaml
  git add installation/aws/cloudformation-test.yaml
  git commit -m "test: add installation/aws test data (commit 4/4)"

  COMMIT_COUNT=$(git log --oneline "origin/main..HEAD" | wc -l | tr -d ' ')
  echo "  ✓ Created ${TEST_BRANCH} with ${COMMIT_COUNT} test commits"
}

run_act() {
  local extra_args=("$@")

  cd "${PL_DIR}"

  act push \
    -W "${WORKFLOW}" \
    --local-repository "milaboratory/github-ci@v4=${GITHUB_CI_DIR}" \
    -P dev-ci-pl=catthehacker/ubuntu:act-latest \
    --defaultbranch "${TEST_BRANCH}" \
    --container-architecture linux/amd64 \
    --container-options "-v ${MAIN_GIT_DIR}:${MAIN_GIT_DIR}" \
    -s HELM_SYNC_TOKEN="$(gh auth token)" \
    -b \
    "${extra_args[@]}"
}

# ── Parse args ─────────────────────────────────────────────────
MODE="full"
JOB=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)
      MODE="dry-run"
      shift
      ;;
    --job|-j)
      JOB="$2"
      shift 2
      ;;
    --setup-only)
      MODE="setup-only"
      shift
      ;;
    --cleanup-only)
      MODE="cleanup-only"
      shift
      ;;
    --help|-h)
      head -16 "$0" | tail -14
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ── Execute ────────────────────────────────────────────────────
trap 'echo ""; echo "Interrupted. Run $0 --cleanup-only to clean up."' INT

case "${MODE}" in
  dry-run)
    echo "=== Dry run ==="
    cd "${PL_DIR}"
    act push -n \
      -W "${WORKFLOW}" \
      --local-repository "milaboratory/github-ci@v4=${GITHUB_CI_DIR}" \
      -P dev-ci-pl=catthehacker/ubuntu:act-latest
    ;;

  setup-only)
    setup_test_branch
    echo ""
    echo "Test branch ready. Run the tests manually or re-run without --setup-only."
    ;;

  cleanup-only)
    cleanup_local
    cleanup_remote
    echo "Done."
    ;;

  full)
    setup_test_branch
    echo ""

    if [[ -n "${JOB}" ]]; then
      echo "=== Running job: ${JOB} ==="
      run_act -j "${JOB}"
    else
      echo "=== Running all tests ==="
      run_act
    fi

    EXIT_CODE=$?
    echo ""
    echo "=== Cleaning up ==="
    cleanup_local
    echo ""

    if [[ ${EXIT_CODE} -eq 0 ]]; then
      echo "✅ All tests passed"
    else
      echo "❌ Tests failed (exit code ${EXIT_CODE})"
      echo "Remote cleanup was handled by the workflow's cleanup job."
      echo "If interrupted, run: $0 --cleanup-only"
    fi
    exit ${EXIT_CODE}
    ;;
esac
