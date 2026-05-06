#!/usr/bin/env bash
#
# End-to-end test for mirror-directory using act with a mocked git remote.
#
# How the mock works:
#   - A bare git repo is initialized at $FAKE_REMOTE on the host and
#     bind-mounted into the act container.
#   - The workflow writes a global git config:
#         url."<FAKE_REMOTE>".insteadOf = "https://x-access-token:fake-token@github.com/test-org/test-repo.git"
#     so the action's clone/fetch/push calls are transparently rewritten
#     to push at the bare repo. No real network access happens.
#   - Verification steps clone the bare repo directly and inspect files.
#
# Requires: act, docker, git. No GitHub access, no real repo, no token.
#
# Usage:
#   ./test-act.sh                  # run all jobs
#   ./test-act.sh --job snapshot   # run a single job
#   ./test-act.sh --dry-run        # validate workflow without running
#   ./test-act.sh --keep           # don't delete fixture/remote on exit
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW="${SCRIPT_DIR}/test-act.yaml"
FIXTURE_SRC="${SCRIPT_DIR}/testdata/fixture"
GITHUB_CI_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Hardcoded /tmp paths (not $TMPDIR) so the host paths line up with the
# paths the workflow uses inside the container. Both the script and the
# workflow must agree on FAKE_REMOTE so insteadOf rewrites resolve to a
# real bind-mounted directory.
FIXTURE_DIR="/tmp/_mirror-test-fixture"
FAKE_REMOTE="/tmp/_mirror-test-remote.git"

KEEP=0
DRY_RUN=0
JOB=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --job|-j)     JOB="$2"; shift 2 ;;
    --dry-run|-n) DRY_RUN=1; shift ;;
    --keep)       KEEP=1; shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cleanup() {
  if [[ ${KEEP} -eq 0 ]]; then
    rm -rf "${FIXTURE_DIR}" "${FAKE_REMOTE}"
  else
    echo "(--keep) Fixture: ${FIXTURE_DIR}"
    echo "(--keep) Fake remote: ${FAKE_REMOTE}"
  fi
}
trap cleanup EXIT

# ── Build source fixture ───────────────────────────────────────
# Copies versioned fixture files from testdata/fixture/ into a temp dir
# that act will treat as GITHUB_WORKSPACE. Edit those files (not heredocs
# in this script) to change the test corpus.
#
# Must end up as a real git repo because action.yml runs
# `git log -1 --format='%s'` on GITHUB_WORKSPACE to build the commit subject.
setup_fixture() {
  if [[ ! -d "${FIXTURE_SRC}" ]]; then
    echo "ERROR: fixture source not found at ${FIXTURE_SRC}" >&2
    exit 1
  fi

  rm -rf "${FIXTURE_DIR}"
  mkdir -p "${FIXTURE_DIR}"
  # Copy contents of testdata/fixture/ (not the dir itself) into FIXTURE_DIR
  cp -a "${FIXTURE_SRC}/." "${FIXTURE_DIR}/"

  git -C "${FIXTURE_DIR}" init -q -b main
  git -C "${FIXTURE_DIR}" -c user.email=test@test -c user.name=test \
    -c commit.gpgsign=false add -A
  git -C "${FIXTURE_DIR}" -c user.email=test@test -c user.name=test \
    -c commit.gpgsign=false commit -q -m "fixture: initial source tree"
}

# ── Initialise fake remote (bare repo) ─────────────────────────
# Seed with one empty commit on `main` so a fresh clone has a base to branch from.
setup_fake_remote() {
  rm -rf "${FAKE_REMOTE}"
  git init --bare -q -b main "${FAKE_REMOTE}"

  local SEED
  SEED=$(mktemp -d)
  git -C "${SEED}" init -q -b main
  git -C "${SEED}" -c user.email=test@test -c user.name=test \
    -c commit.gpgsign=false commit -q --allow-empty -m "seed"
  git -C "${SEED}" remote add origin "${FAKE_REMOTE}"
  git -C "${SEED}" push -q origin main
  rm -rf "${SEED}"
}

run_act() {
  cd "${FIXTURE_DIR}"

  local args=(
    push
    -W "${WORKFLOW}"
    --local-repository "milaboratory/github-ci@v4=${GITHUB_CI_DIR}"
    -P ubuntu-latest=catthehacker/ubuntu:act-latest
    --defaultbranch main
    --container-architecture linux/amd64
    --container-options "-v ${FAKE_REMOTE}:${FAKE_REMOTE}"
    -b
  )
  [[ -n "${JOB}" ]] && args+=(-j "${JOB}")

  act "${args[@]}"
}

# ── Execute ────────────────────────────────────────────────────
echo "Workflow:    ${WORKFLOW}"
echo "Fixture:     ${FIXTURE_DIR}"
echo "Fake remote: ${FAKE_REMOTE}"
echo "github-ci:   ${GITHUB_CI_DIR}"
echo ""

if [[ ${DRY_RUN} -eq 1 ]]; then
  cd "${SCRIPT_DIR}"
  act push -n -W "${WORKFLOW}" \
    --local-repository "milaboratory/github-ci@v4=${GITHUB_CI_DIR}" \
    -P ubuntu-latest=catthehacker/ubuntu:act-latest
  exit 0
fi

setup_fixture
setup_fake_remote
run_act
echo ""
echo "✅ All act tests passed"
