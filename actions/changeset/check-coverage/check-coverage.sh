#!/usr/bin/env bash
#
# Verify the PR has a changeset for every workspace package whose own files
# it edits. Exit 1 on a coverage gap; exit 2 on tooling failure; exit 0
# otherwise.
#
# "Modified" means a direct edit to a workspace package's own files, detected
# via `pnpm --filter '[<base>]' list` — pnpm runs the per-package git-diff
# check itself. Root-level paths (`.github/`, `docs/`, `pnpm-workspace.yaml`,
# `README.md`) live in no package directory, so they never trigger inclusion.
#
# Dependency-version bumps never require a changeset — including catalog
# bumps in pnpm-workspace.yaml. A catalog entry always pins an *external*
# package (workspace packages are referenced via `workspace:*`, never
# `catalog:`). `pnpm changeset` ignores such a bump twice over: it never
# releases a package because an external dependency's version changed, and it
# propagates internal bumps through the dependency chain automatically at
# `changeset version` time. So requiring a hand-written changeset for a
# package that only "changed" via a dependency bump over-reports relative to
# `pnpm changeset` — see platforma-open/clonotype-space#95, where a
# `@platforma-sdk/workflow-tengo` catalog bump spuriously failed the
# untouched `.workflow` package.
#
# Skips private (unpublished) workspace packages — they never appear in
# the changeset's release set.
#
# Runs from the repo root after `pnpm install`.

set -o nounset
set -o errexit
set -o pipefail

: "${BASE_BRANCH:?BASE_BRANCH required}"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf '::error::%s\n' "$*" >&2; }

# Associative arrays (`declare -A`) require bash 4+. The GitHub-hosted
# ubuntu-latest runners ship bash 5+, so this guard is a no-op in CI today.
# It matters when running locally on macOS: /bin/bash is still 3.2, and
# without homebrew's bash earlier on PATH the script would otherwise abort
# at the first `declare -A` with a cryptic `invalid option`. Fail fast with
# a useful message instead.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  err "check-coverage requires bash 4+ (found ${BASH_VERSION:-unknown})."
  exit 2
fi

# Use cwd-relative paths for tmp files — changeset's --output mis-handles
# absolute paths on macOS (prepends cwd, causing ENOENT). Cwd-relative is
# safe on every platform.
status_json=".changeset-coverage-status-$$.json"

# ---------------------------------------------------------------------------
# 1. Bumped set from `changeset status --output=...`.
# ---------------------------------------------------------------------------
trap 'rm -f "${status_json}"' EXIT

# Invoke the binary directly. `pnpm exec` and `pnpm <script>` spawn subshells
# that lose `node_modules/.bin` from PATH on repeated invocations. The action
# runs from the repo root after `pnpm install`, so the binary is at this
# fixed location in CI.
changeset_bin='./node_modules/.bin/changeset'
if [ ! -x "${changeset_bin}" ]; then
  err 'changeset binary not found. Did `pnpm install` run before this step?'
  exit 2
fi

# Capture stderr to distinguish the legitimate "no changesets yet" state
# (exit 1 + "no changesets were found" message) from a real tooling failure.
# The former is a coverage gap to report; the latter aborts with exit 2.
cs_stdouterr=''
set +e
cs_stdouterr="$(
  "${changeset_bin}" status \
    --output="${status_json}" \
    --since="origin/${BASE_BRANCH}" 2>&1
)"
cs_exit=$?
set -e

if [ ! -s "${status_json}" ]; then
  if printf '%s' "${cs_stdouterr}" | grep -q 'no changesets were found'; then
    # Legitimate empty-changeset case — keep going so the coverage check
    # surfaces every modified package as missing.
    echo '{"releases":[]}' >"${status_json}"
  elif [ "${cs_exit}" -ne 0 ]; then
    err "changeset status failed (exit ${cs_exit}):"
    printf '%s\n' "${cs_stdouterr}" | sed 's/^/    /' >&2
    exit 2
  else
    echo '{"releases":[]}' >"${status_json}"
  fi
fi

declare -A bumped_set=()
while IFS= read -r pkg; do
  [ -n "${pkg}" ] && bumped_set["${pkg}"]=1
done < <(jq -r '.releases[]?.name // empty' "${status_json}")

if [ "${#bumped_set[@]}" -eq 0 ]; then
  log 'Changeset bumps: <none>'
else
  log "Changeset bumps: ${!bumped_set[*]}"
fi

# ---------------------------------------------------------------------------
# 2. Required-bump set.
# ---------------------------------------------------------------------------
declare -A required_set=()
declare -A required_reason=()

require_pkg() {
  local pkg="$1" reason="$2"
  [ -z "${pkg}" ] && return 0
  required_set["${pkg}"]=1
  required_reason["${pkg}"]="${required_reason[${pkg}]:-}${reason}; "
}

# Direct workspace-package edits.
#
# `pnpm --filter '[<since>]' list` selects packages whose own files changed
# (pnpm runs the per-package `git diff` itself). Root-level paths like
# `.github/`, `docs/`, `pnpm-workspace.yaml`, or `README.md` are not in any
# package directory and so don't trigger inclusion — no manual ignore list
# needed, and a catalog bump in pnpm-workspace.yaml never reaches this filter.
#
# The jq filter drops private packages here (they never appear in a
# changeset's release set), so `require_pkg` doesn't need to re-check.
while IFS= read -r pkg; do
  [ -n "${pkg}" ] && require_pkg "${pkg}" 'direct edit'
done < <(
  pnpm -r --filter "[origin/${BASE_BRANCH}]" list --depth -1 --json 2>/dev/null \
    | jq -r '.[] | select(.name != null and .name != "" and .private != true) | .name'
)

log "Direct-edit packages: ${#required_set[@]}"

# ---------------------------------------------------------------------------
# 3. Compare required vs bumped.
# ---------------------------------------------------------------------------
missing=()
for pkg in "${!required_set[@]}"; do
  [ -z "${bumped_set[${pkg}]:-}" ] && missing+=("${pkg}")
done

if [ "${#missing[@]}" -eq 0 ]; then
  log '✓ Changeset covers every modified package.'
  exit 0
fi

err 'Changeset coverage gap. The following packages were modified but not bumped:'
for pkg in "${missing[@]}"; do
  reason="${required_reason[${pkg}]%; }"
  err "  - ${pkg}  (${reason})"
done
err ''
err "Add a changeset entry — run \`pnpm changeset\` and select the missing packages."
exit 1
