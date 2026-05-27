#!/usr/bin/env bash
#
# Verify the PR's changesets bump every workspace package the PR modifies.
# Exit 1 on a coverage gap; exit 2 on tooling failure; exit 0 otherwise.
#
# Two sources of "modified":
#
#   1. Direct edits to a workspace package's files, detected via
#      `pnpm --filter '[<base>]' list` — pnpm runs the per-package
#      git-diff check itself.
#
#   2. Catalog version bumps in pnpm-workspace.yaml: for each touched
#      catalog key, find workspace packages that consume it via
#      `"<key>": "catalog:..."` and require those packages to bump.
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

# Use cwd-relative paths for tmp files — changeset's --output mis-handles
# absolute paths on macOS (prepends cwd, causing ENOENT). Cwd-relative is
# safe on every platform.
status_json=".changeset-coverage-status-$$.json"
pkg_list_json=".changeset-coverage-pkgs-$$.json"

# ---------------------------------------------------------------------------
# 1. Bumped set from `changeset status --output=...`.
# ---------------------------------------------------------------------------
trap 'rm -f "${status_json}" "${pkg_list_json}"' EXIT

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

# 2a. Direct workspace-package edits.
#
# `pnpm --filter '[<since>]' list` selects packages whose own files changed
# (pnpm runs the per-package `git diff` itself). Root-level paths like
# `.github/`, `docs/`, `pnpm-workspace.yaml`, or `README.md` are not in any
# package directory and so don't trigger inclusion — no manual ignore list
# needed.
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

# 2b. Catalog version bumps in pnpm-workspace.yaml.
#
# Only runs when the workspace yaml itself changed. Builds a full
# workspace map so we can find every consumer of each touched catalog key.
if git diff --name-only "origin/${BASE_BRANCH}...HEAD" | grep -qx 'pnpm-workspace.yaml'; then
  pnpm -r list --depth -1 --json >"${pkg_list_json}"

  # pnpm returns canonical absolute paths; strip the workspace root via
  # `pwd -P` so the result matches the workspace's view on either platform.
  workspace_root="$(pwd -P)"
  declare -A pkg_name_to_dir=()
  declare -A pkg_is_private=()

  while IFS=$'\t' read -r pkg_name pkg_path pkg_private; do
    [ -z "${pkg_name}" ] && continue           # workspace root has no name
    rel="${pkg_path#${workspace_root}/}"
    [ "${rel}" = "${pkg_path}" ] && continue   # workspace root itself
    pkg_name_to_dir["${pkg_name}"]="${rel}"
    pkg_is_private["${pkg_name}"]="${pkg_private}"
  done < <(jq -r '
      .[]
      | select(.name != null and .name != "")
      | [.name, .path, (.private // false | tostring)]
      | @tsv
    ' "${pkg_list_json}")

  # Extract catalog keys whose value changed (added, removed, or bumped).
  # Parse both the base and head versions structurally with yq, flatten the
  # default catalog and any named catalogs to `key=value` lines, then take
  # entries unique to either side. Avoids the false-positive surface of a
  # line-level regex on the raw diff.
  cat_pairs() {
    yq -e '
      [
        (.catalog // {} | to_entries[]),
        (.catalogs // {} | to_entries[].value // {} | to_entries[])
      ] | .[] | .key + "=" + .value
    ' 2>/dev/null || true
  }
  old_pairs="$(git show "origin/${BASE_BRANCH}:pnpm-workspace.yaml" 2>/dev/null | cat_pairs || true)"
  new_pairs="$(cat_pairs <pnpm-workspace.yaml || true)"
  mapfile -t catalog_keys < <(
    { printf '%s\n' "${old_pairs}"; printf '%s\n' "${new_pairs}"; } \
      | sed '/^$/d' \
      | sort | uniq -u \
      | sed -E 's/=.*//' \
      | sort -u
  )

  if [ "${#catalog_keys[@]}" -gt 0 ]; then
    log "Catalog keys touched: ${catalog_keys[*]}"
    # For each catalog key, find workspace pkgs that depend on it with "catalog:".
    for key in "${catalog_keys[@]}"; do
      for name in "${!pkg_name_to_dir[@]}"; do
        [ "${pkg_is_private[${name}]:-false}" = 'true' ] && continue
        pj="${pkg_name_to_dir[${name}]}/package.json"
        [ -f "${pj}" ] || continue
        if jq -e --arg k "${key}" '
            [.dependencies?, .devDependencies?, .peerDependencies?, .optionalDependencies?]
            | map(select(. != null) | to_entries) | add // []
            | map(select(.key == $k and ((.value // "") | startswith("catalog"))))
            | length > 0
          ' "${pj}" >/dev/null 2>&1; then
          require_pkg "${name}" "catalog dep '${key}' bumped"
        fi
      done
    done
  fi
fi

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
