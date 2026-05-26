#!/usr/bin/env bash
#
# Verify the PR's changesets bump every workspace package the PR modifies.
# Exit 1 on a coverage gap; exit 2 on tooling failure; exit 0 otherwise.
#
# Two sources of "modified":
#
#   1. Direct edits to a workspace package's files (longest-prefix match
#      against the workspace package roots from `pnpm m ls`).
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
# 2. Workspace package map.
# ---------------------------------------------------------------------------
pnpm m ls --depth -1 --json >"${pkg_list_json}"

# pnpm returns canonical paths (e.g. macOS resolves /var → /private/var).
# Raw `pwd` doesn't, so the prefix-strip below would silently drop every
# workspace package. `pwd -P` matches pnpm's view.
workspace_root="$(pwd -P)"
declare -A pkg_dir_to_name=()
declare -A pkg_name_to_dir=()
declare -A pkg_is_private=()

while IFS=$'\t' read -r pkg_name pkg_path pkg_private; do
  [ -z "${pkg_name}" ] && continue            # workspace root has no name
  rel="${pkg_path#${workspace_root}/}"
  [ "${rel}" = "${pkg_path}" ] && continue    # workspace root itself
  pkg_dir_to_name["${rel}"]="${pkg_name}"
  pkg_name_to_dir["${pkg_name}"]="${rel}"
  pkg_is_private["${pkg_name}"]="${pkg_private}"
done < <(jq -r '
    .[]
    | select(.name != null and .name != "")
    | [.name, .path, (.private // false | tostring)]
    | @tsv
  ' "${pkg_list_json}")

log "Workspace packages: ${#pkg_dir_to_name[@]}"

# ---------------------------------------------------------------------------
# 3. Modified files vs base branch.
# ---------------------------------------------------------------------------
mapfile -t changed_files < <(git diff --name-only "origin/${BASE_BRANCH}...HEAD")
log "Changed files: ${#changed_files[@]}"

# ---------------------------------------------------------------------------
# 4. Build required-bump set.
# ---------------------------------------------------------------------------
declare -A required_set=()
declare -A required_reason=()
# Track the first (file, line) that triggered each required pkg, so the
# `::error file=…,line=…::` annotation lands on the PR's Files Changed tab
# rather than only in the job log.
declare -A required_file=()
declare -A required_line=()

# Paths that never imply a package bump, regardless of which package directory
# they happen to live under. Bash `case` globs — `*` does not cross `/`.
ignore_patterns=(
  '.changeset/*'
  '.github/*'
  'docs/*'
  'logos/*'
  'README*'
  'CHANGELOG*'
  '.gitignore'
  '.npmrc'
)

is_ignored() {
  local file="$1" pat
  for pat in "${ignore_patterns[@]}"; do
    # shellcheck disable=SC2254
    case "${file}" in ${pat}) return 0 ;; esac
  done
  return 1
}

require_pkg() {
  local pkg="$1" reason="$2" file="${3:-}" line="${4:-1}"
  [ -z "${pkg}" ] && return 0
  [ "${pkg_is_private[${pkg}]:-false}" = 'true' ] && return 0
  required_set["${pkg}"]=1
  required_reason["${pkg}"]="${required_reason[${pkg}]:-}${reason}; "
  # Keep the first (file, line). 4a (direct edits) runs before 4b (catalog),
  # so when both apply the annotation lands on the actual source change.
  if [ -z "${required_file[${pkg}]:-}" ] && [ -n "${file}" ]; then
    required_file["${pkg}"]="${file}"
    required_line["${pkg}"]="${line}"
  fi
}

file_to_pkg() {
  local file="$1" dir longest=''
  for dir in "${!pkg_dir_to_name[@]}"; do
    if [[ "${file}" == "${dir}/"* ]]; then
      if [ "${#dir}" -gt "${#longest}" ]; then longest="${dir}"; fi
    fi
  done
  if [ -n "${longest}" ]; then
    printf '%s' "${pkg_dir_to_name[${longest}]}"
  fi
  return 0
}

# 4a. Direct workspace-package edits.
for file in "${changed_files[@]}"; do
  [ -z "${file}" ] && continue
  is_ignored "${file}" && continue
  [ "${file}" = 'pnpm-workspace.yaml' ] && continue   # handled in 4b
  pkg="$(file_to_pkg "${file}")"
  [ -n "${pkg}" ] && require_pkg "${pkg}" "edit in ${file}" "${file}" 1
done

# 4b. Catalog version bumps in pnpm-workspace.yaml.
if printf '%s\n' "${changed_files[@]}" | grep -qx 'pnpm-workspace.yaml'; then
  # Extract catalog keys touched in the diff. Regex matches `'<scope>/<name>':`
  # and `<name>:`. Structural-yaml false positives (`packages:`, `catalog:`)
  # self-correct: no package.json depends on them via `catalog:`.
  mapfile -t catalog_keys < <(
    git diff "origin/${BASE_BRANCH}...HEAD" -- pnpm-workspace.yaml \
      | grep -E "^[-+][[:space:]]+'?[@A-Za-z0-9._/-]+'?:" \
      | sed -E "s/^[-+][[:space:]]+'?([^':]+)'?:.*/\1/" \
      | sort -u
  )

  if [ "${#catalog_keys[@]}" -gt 0 ]; then
    log "Catalog keys touched: ${catalog_keys[*]}"
    # For each catalog key, find workspace pkgs that depend on it with "catalog:".
    for key in "${catalog_keys[@]}"; do
      # Find this key's line in pnpm-workspace.yaml so the annotation lands
      # there. Three subtleties:
      #   - `grep -F` (fixed string): pkg names contain regex specials (`.`, `/`, `-`).
      #   - Search the bare key, not `key:` — quoted entries (`'foo':`) put the
      #     closing quote between key and colon, so `grep -F 'foo:'` misses.
      #   - `|| true` swallows grep's exit 1 on no-match; pipefail would
      #     otherwise trip errexit. Falls through to line=1 below.
      key_line="$(grep -nF -- "${key}" pnpm-workspace.yaml 2>/dev/null | head -1 | cut -d: -f1 || true)"
      [ -z "${key_line}" ] && key_line=1

      for name in "${!pkg_name_to_dir[@]}"; do
        dir="${pkg_name_to_dir[${name}]}"
        pj="${dir}/package.json"
        [ -f "${pj}" ] || continue
        if jq -e --arg k "${key}" '
            [.dependencies?, .devDependencies?, .peerDependencies?, .optionalDependencies?]
            | map(select(. != null) | to_entries) | add // []
            | map(select(.key == $k and ((.value // "") | startswith("catalog"))))
            | length > 0
          ' "${pj}" >/dev/null 2>&1; then
          require_pkg "${name}" "catalog dep '${key}' bumped" \
            'pnpm-workspace.yaml' "${key_line}"
        fi
      done
    done
  fi
fi

# ---------------------------------------------------------------------------
# 5. Compare required vs bumped.
# ---------------------------------------------------------------------------
missing=()
for pkg in "${!required_set[@]}"; do
  [ -z "${bumped_set[${pkg}]:-}" ] && missing+=("${pkg}")
done

if [ "${#missing[@]}" -eq 0 ]; then
  log '✓ Changeset covers every modified package.'
  exit 0
fi

# Per-file annotations land inline on the PR's Files Changed tab via the
# `::error file=…,line=…::` worker protocol.
for pkg in "${missing[@]}"; do
  file="${required_file[${pkg}]:-}"
  line="${required_line[${pkg}]:-1}"
  [ -z "${file}" ] && continue
  printf "::error file=%s,line=%s::Package '%s' is modified but missing from any changeset. Add a '%s: patch' (or minor/major) entry to a file under .changeset/.\n" \
    "${file}" "${line}" "${pkg}" "${pkg}" >&2
done

# Summary block — appears in the step log for anyone reading job output.
err 'Changeset coverage gap. The following packages were modified but not bumped:'
for pkg in "${missing[@]}"; do
  reason="${required_reason[${pkg}]%; }"
  err "  - ${pkg}  (${reason})"
done
err ''
err "Add a changeset entry — run \`pnpm changeset\` and select the missing packages."
exit 1
