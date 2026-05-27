# Shared helpers for check-coverage bats tests.
#
# The expensive step is `pnpm install`. setup_file builds one shared install
# under $BATS_FILE_TMPDIR/base and each test rsyncs from it — keeps the suite
# under a few seconds even with many cases.

TEST_DIR="${BATS_TEST_DIRNAME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
SCRIPT_UNDER_TEST="${TEST_DIR}/../check-coverage.sh"
FIXTURE_SRC="${TEST_DIR}/fixtures/minimal-workspace"

# Build the shared, pnpm-installed base workspace with an initial git commit
# on `main` and a synthesized `origin/main` ref. Setting gc.auto=0 BEFORE the
# first commit suppresses git's async auto-gc, which would otherwise repack
# `.git/objects` mid-test and break the per-test tar copy.
_build_base_workspace() {
  local base="$1"
  rm -rf "${base}"
  cp -R "${FIXTURE_SRC}" "${base}"

  (
    cd "${base}"
    pnpm install --silent --ignore-scripts >/dev/null
    git init --quiet --initial-branch=main
    git config gc.auto 0
    git config gc.autoDetach false
    git config user.email 'test@example.com'
    git config user.name  'Test'
    git add -A
    git commit --quiet -m 'initial'
    git update-ref refs/remotes/origin/main main
  ) >/dev/null 2>&1
}

# Per-test: copy the base into a fresh workspace and switch to a feature
# branch. The tar pipe avoids macOS xattr warnings that `cp -R` and
# openrsync emit when cloning `.git/objects`.
new_workspace() {
  WORKSPACE="${BATS_TEST_TMPDIR}/ws"
  rm -rf "${WORKSPACE}"
  mkdir -p "${WORKSPACE}"
  ( cd "${BATS_FILE_TMPDIR}/base" && tar -cf - . ) | ( cd "${WORKSPACE}" && tar -xf - )
  git -C "${WORKSPACE}" checkout --quiet -b feature
}

# Run the script in $WORKSPACE with BASE_BRANCH=main. Sets $status and $output.
run_check() {
  cd "${WORKSPACE}"
  BASE_BRANCH=main run "${SCRIPT_UNDER_TEST}"
}

# Drop a changeset markdown file. Args: bump-spec, then "title".
# bump-spec is the YAML front-matter body, e.g. '@check-coverage-test/pkg-a: patch'.
add_changeset() {
  local body="$1"
  local title="${2:-test changeset}"
  local slug
  slug="$(printf '%s' "${title}" | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g')"
  cat >"${WORKSPACE}/.changeset/${slug}.md" <<EOF
---
${body}
---

${title}
EOF
  git -C "${WORKSPACE}" add ".changeset/${slug}.md"
  git -C "${WORKSPACE}" commit --quiet -m "add changeset: ${title}"
}

# Edit a file under $WORKSPACE, stage and commit. Args: relpath, content (or
# defaults to appending a comment).
touch_file() {
  local rel="$1" content="${2:-// edit}"
  mkdir -p "$(dirname "${WORKSPACE}/${rel}")"
  printf '%s\n' "${content}" >>"${WORKSPACE}/${rel}"
  git -C "${WORKSPACE}" add "${rel}"
  git -C "${WORKSPACE}" commit --quiet -m "edit ${rel}"
}

# Bump a default-catalog entry in pnpm-workspace.yaml. Args: key, new-version.
bump_catalog() {
  local key="$1" version="$2"
  # yq edits in place.
  yq -i ".catalog.\"${key}\" = \"${version}\"" "${WORKSPACE}/pnpm-workspace.yaml"
  git -C "${WORKSPACE}" add pnpm-workspace.yaml
  git -C "${WORKSPACE}" commit --quiet -m "bump catalog ${key} to ${version}"
}
