#!/usr/bin/env bash
#
# Verify the PR has a changeset for every workspace package whose own files
# it edits. Exit 1 on a coverage gap; exit 2 on tooling failure; exit 0
# otherwise.
#
# An empty changeset added in this branch (`pnpm changeset --empty`) waives the
# requirement — see section 4.
#
# "Modified" means a direct edit to a workspace package's own files, detected
# from `git diff` against the base: a changed file belongs to the deepest
# package directory that contains it. Root-level paths (`.github/`, `docs/`,
# `pnpm-workspace.yaml`, `README.md`) belong to the unnamed or private
# workspace root, so they never trigger inclusion.
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
# Each file the branch changed belongs to the deepest workspace package whose
# directory contains it. The changed files come from `git diff`, not from
# `pnpm --filter '[<since>]'`: pnpm 12 also selects every package whose
# catalog entries changed, which flags the consumers of a dependency bump.
#
# Root-level paths like `.github/`, `docs/`, `pnpm-workspace.yaml`, or
# `README.md` belong to the workspace root, which is unnamed or private in a
# monorepo, so they never trigger inclusion — no manual ignore list needed.
#
# The jq filter blanks the names of private packages (they never appear in a
# changeset's release set), so `require_pkg` doesn't need to re-check.
if ! packages_json="$(pnpm -r list --depth -1 --json 2>/dev/null)"; then
  err 'pnpm list failed.'
  exit 2
fi

# Package directories relative to the workspace root ('' for the root itself),
# and the matching names, '' too for an unnamed or private package.
pkg_dirs=()
pkg_names=()
while IFS=$'\t' read -r path name; do
  path="${path%/}"
  rel=''
  # pnpm prints absolute paths, possibly with symlinks resolved (macOS /tmp →
  # /private/tmp), so strip whichever form of the cwd matches.
  for root in "$(pwd -P)" "$(pwd -L)"; do
    case "${path}" in
      "${root}") rel='.' ;;
      "${root}"/*) rel="${path#"${root}"/}" ;;
    esac
    [ -n "${rel}" ] && break
  done
  # Outside the repo root: not ours to check.
  [ -z "${rel}" ] && continue
  [ "${rel}" = '.' ] && rel=''
  pkg_dirs+=("${rel}")
  pkg_names+=("${name}")
done < <(
  printf '%s' "${packages_json}" \
    | jq -r '.[] | [.path, (if (.name // "") == "" or .private == true then "" else .name end)] | @tsv'
)

# pnpm always lists the workspace root, so an empty list means its output was
# not the expected JSON.
if [ "${#pkg_dirs[@]}" -eq 0 ]; then
  err 'pnpm list returned no workspace packages.'
  exit 2
fi

# Files the branch changed since it left the base. `--no-renames` lists both
# sides of a move, so moving a file out of a package still counts as editing it.
if ! changed_files="$(git diff --name-only --relative --no-renames "origin/${BASE_BRANCH}...HEAD")"; then
  err "git diff against origin/${BASE_BRANCH} failed."
  exit 2
fi

while IFS= read -r file; do
  [ -z "${file}" ] && continue
  # Find the deepest package directory containing the file. The root ('')
  # contains every file, so it wins only when no package directory does.
  best=-1
  best_len=-1
  for i in "${!pkg_dirs[@]}"; do
    dir="${pkg_dirs[${i}]}"
    if [ -z "${dir}" ] || [[ "${file}" == "${dir}/"* ]]; then
      if [ "${#dir}" -gt "${best_len}" ]; then
        best="${i}"
        best_len="${#dir}"
      fi
    fi
  done
  [ "${best}" -lt 0 ] && continue
  # An empty name (root or private package) requires nothing.
  pkg="${pkg_names[${best}]}"
  [ -n "${pkg}" ] && [ -z "${required_set[${pkg}]:-}" ] && require_pkg "${pkg}" 'direct edit'
done <<<"${changed_files}"

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

# ---------------------------------------------------------------------------
# 4. Empty-changeset opt-out.
# ---------------------------------------------------------------------------
# A changeset ADDED in this branch whose front matter names no package
# (`pnpm changeset --empty`) is a deliberate, committed "no release needed"
# statement and waives the requirement for every missing package at once.
#
# Scoped to ADDED files, so a stale empty changeset sitting on the base branch
# cannot silently satisfy a new PR.
#
# require-package-bump.sh applies the same rule to its own half of the gate.
# Both halves must accept the same declaration — an author who states "no
# release" should not be failed by one half and passed by the other. Change one
# and change the other.
is_empty_changeset() {
  awk '
    NR==1 && /^---[[:space:]]*$/ { infm=1; next }
    infm && /^---[[:space:]]*$/  { exit (found ? 1 : 0) }
    infm && /[^[:space:]]/       { found=1 }
    END { if (!infm) exit 2; exit (found ? 1 : 0) }
  ' "$1"
}

while IFS= read -r f; do
  [ -z "${f}" ] && continue
  case "${f}" in
    .changeset/README.md) continue ;;
    .changeset/*.md) ;;
    *) continue ;;
  esac
  [ -f "${f}" ] || continue
  if is_empty_changeset "${f}"; then
    log "✓ Empty changeset added in this branch: ${f} — coverage requirement waived."
    exit 0
  fi
done < <(
  git diff --name-only --diff-filter=A "origin/${BASE_BRANCH}...HEAD" -- .changeset 2>/dev/null || true
)

err 'Changeset coverage gap. The following packages were modified but not bumped:'
for pkg in "${missing[@]}"; do
  reason="${required_reason[${pkg}]%; }"
  err "  - ${pkg}  (${reason})"
done
err ''
err 'Do one of:'
err "  - Bump them: run \`pnpm changeset\` and select the missing packages."
err '  - Deliberately skip a release: `pnpm changeset --empty` (an empty changeset).'
err '  - Bypass this check: add the `skip-changelog` label to the PR.'
exit 1
