# Shared helpers for require-package-bump bats tests.
#
# The expensive step is `pnpm install`. setup_file builds one shared install
# under $BATS_FILE_TMPDIR/base and each test copies from it — keeps the suite
# fast even with many cases.

TEST_DIR="${BATS_TEST_DIRNAME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
SCRIPT_UNDER_TEST="${TEST_DIR}/../require-package-bump.sh"
FIXTURE_SRC="${TEST_DIR}/fixtures/block-workspace"

# Build the shared, pnpm-installed base workspace with an initial commit on
# `main` and a synthesized `origin/main` ref. gc.auto=0 BEFORE the first commit
# suppresses git's async auto-gc, which would otherwise repack .git/objects
# mid-test and break the per-test copy.
_build_base_workspace() {
  local base="$1"
  rm -rf "${base}"
  cp -R "${FIXTURE_SRC}" "${base}"

  local log="${BATS_FILE_TMPDIR}/base-setup.log"
  if ! (
    set -e
    cd "${base}"
    pnpm install --silent --ignore-scripts
    git init --quiet --initial-branch=main
    git config gc.auto 0
    git config gc.autoDetach false
    git config user.email 'test@example.com'
    git config user.name  'Test'
    git add -A
    git commit --quiet -m 'initial'
    git update-ref refs/remotes/origin/main main
  ) >"${log}" 2>&1; then
    echo "base workspace setup failed; full log:" >&2
    cat "${log}" >&2
    return 1
  fi
}

# Per-test: copy the base into a fresh workspace and switch to a feature
# branch. The tar pipe avoids macOS xattr warnings that `cp -R`/rsync emit
# when cloning .git/objects.
new_workspace() {
  WORKSPACE="${BATS_TEST_TMPDIR}/ws"
  rm -rf "${WORKSPACE}"
  mkdir -p "${WORKSPACE}"
  ( cd "${BATS_FILE_TMPDIR}/base" && tar -cf - . ) | ( cd "${WORKSPACE}" && tar -xf - )
  git -C "${WORKSPACE}" checkout --quiet -b feature
}

# Run the action script in $WORKSPACE against package-path=block, base=main.
# Sets $status and $output. First arg optionally overrides the package path.
run_require() {
  local pkg_path="${1:-block}"
  cd "${WORKSPACE}"
  PACKAGE_PATH="${pkg_path}" BASE_BRANCH=main run "${SCRIPT_UNDER_TEST}"
}

# Drop a changeset markdown file and commit it. Args: front-matter body, title.
# For an empty changeset pass an empty body ('').
add_changeset() {
  local body="$1"
  local title="${2:-test changeset}"
  local slug
  slug="$(printf '%s' "${title}" | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g')"
  if [ -n "${body}" ]; then
    cat >"${WORKSPACE}/.changeset/${slug}.md" <<EOF
---
${body}
---

${title}
EOF
  else
    cat >"${WORKSPACE}/.changeset/${slug}.md" <<EOF
---
---

${title}
EOF
  fi
  git -C "${WORKSPACE}" add ".changeset/${slug}.md"
  git -C "${WORKSPACE}" commit --quiet -m "add changeset: ${title}"
}

# Add a changeset on `main` (the base), refresh origin/main, and return to the
# feature branch — models a stale changeset that predates the PR.
add_changeset_on_base() {
  local body="$1" title="${2:-base changeset}"
  git -C "${WORKSPACE}" checkout --quiet main
  add_changeset "${body}" "${title}"
  git -C "${WORKSPACE}" update-ref refs/remotes/origin/main main
  git -C "${WORKSPACE}" checkout --quiet feature
}

# Edit a file under $WORKSPACE, stage and commit.
touch_file() {
  local rel="$1" content="${2:-// edit}"
  mkdir -p "$(dirname "${WORKSPACE}/${rel}")"
  printf '%s\n' "${content}" >>"${WORKSPACE}/${rel}"
  git -C "${WORKSPACE}" add "${rel}"
  git -C "${WORKSPACE}" commit --quiet -m "edit ${rel}"
}
