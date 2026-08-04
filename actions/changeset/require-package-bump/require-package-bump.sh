#!/usr/bin/env bash
#
# Require the package at $PACKAGE_PATH to be DIRECTLY bumped by a changeset
# added in the current branch, OR the branch to add an empty changeset.
# Exit 0 if satisfied; exit 1 on a missing bump; exit 2 on tooling failure.
#
# "Directly bumped" is read from `changeset status --since=origin/$BASE_BRANCH`:
# for a block, the package has no `workspace:` *dependencies* (its private
# siblings live in devDependencies, which `pnpm changeset` never cascades, and
# its runtime deps are external `catalog:` pins), so a `changeset status`
# release for the package is equivalent to a changeset that names it directly.
# A sibling-only changeset therefore does NOT satisfy this check — matching the
# "did you bump ./block?" intent.
#
# The empty-changeset opt-out is scoped to changesets ADDED in this branch
# (`git diff --diff-filter=A origin/$BASE_BRANCH...HEAD`), so a stale empty
# changeset already on the base branch does not silently satisfy a new PR.
#
# Label bypass (`skip-changelog`) is NOT handled here — the caller workflow
# skips the whole job via a job-level `if`. This action stays label-agnostic.
#
# Runs from the repo root after `pnpm install`.

set -o nounset
set -o errexit
set -o pipefail

: "${PACKAGE_PATH:?PACKAGE_PATH required}"
: "${BASE_BRANCH:?BASE_BRANCH required}"

log() { printf '%s\n' "$*" >&2; }
err() { printf '::error::%s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 0. Resolve the required package name from its package.json.
# ---------------------------------------------------------------------------
pkg_json="${PACKAGE_PATH%/}/package.json"
if [ ! -f "${pkg_json}" ]; then
  err "package.json not found at '${pkg_json}' (package-path='${PACKAGE_PATH}')."
  exit 2
fi

pkg_name="$(jq -r '.name // empty' "${pkg_json}")"
if [ -z "${pkg_name}" ]; then
  err "No 'name' field in '${pkg_json}'."
  exit 2
fi
log "Required package: ${pkg_name} (from ${pkg_json})"

# ---------------------------------------------------------------------------
# 1. Is the package directly bumped? — from `changeset status --output`.
# ---------------------------------------------------------------------------
# cwd-relative tmp path: changeset's --output mishandles absolute paths on
# macOS (prepends cwd → ENOENT). Cwd-relative is safe everywhere.
status_json=".require-package-bump-status-$$.json"
trap 'rm -f "${status_json}"' EXIT

# Invoke the binary directly — `pnpm exec`/`pnpm <script>` can drop
# node_modules/.bin from PATH across repeated invocations. The action runs from
# the repo root after `pnpm install`, so the binary is at this fixed location.
changeset_bin='./node_modules/.bin/changeset'
if [ ! -x "${changeset_bin}" ]; then
  err 'changeset binary not found. Did `pnpm install` run before this step?'
  exit 2
fi

# Distinguish the legitimate "no changesets yet" state (exit 1 + "no changesets
# were found") from a real tooling failure (exit 2).
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
    echo '{"releases":[]}' >"${status_json}"
  elif [ "${cs_exit}" -ne 0 ]; then
    err "changeset status failed (exit ${cs_exit}):"
    printf '%s\n' "${cs_stdouterr}" | sed 's/^/    /' >&2
    exit 2
  else
    echo '{"releases":[]}' >"${status_json}"
  fi
fi

if jq -e --arg n "${pkg_name}" '.releases[]? | select(.name == $n)' \
     "${status_json}" >/dev/null; then
  log "✓ ${pkg_name} is bumped by a changeset."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Empty-changeset opt-out — a changeset ADDED in this branch with no
#    package releases (`pnpm changeset --empty`).
# ---------------------------------------------------------------------------
# Exit codes: 0 = empty changeset, 1 = has releases, 2 = not a changeset.
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
    log "✓ Empty changeset added in this branch: ${f} — bump requirement waived."
    exit 0
  fi
done < <(
  git diff --name-only --diff-filter=A "origin/${BASE_BRANCH}...HEAD" -- .changeset 2>/dev/null || true
)

# ---------------------------------------------------------------------------
# 3. Neither — fail with an actionable message.
# ---------------------------------------------------------------------------
err "${pkg_name} is not bumped by any changeset in this branch."
err ''
err 'Do one of:'
err "  - Bump it: run \`pnpm changeset\` and select ${pkg_name}."
err '  - Deliberately skip a release: `pnpm changeset --empty` (an empty changeset).'
err '  - Bypass this check: add the `skip-changelog` label to the PR.'
exit 1
