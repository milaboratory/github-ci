#!/usr/bin/env bash
#
# Verify the PR has a changeset for every published workspace package it
# changes. Exit 1 on a coverage gap; exit 2 on tooling failure; exit 0
# otherwise.
#
# A package is changed by the branch in two ways:
#
#   direct edit   — the branch changes a file inside the package directory. A
#                   file belongs to the deepest package directory containing
#                   it, so root-level paths (`.github/`, `docs/`,
#                   `pnpm-workspace.yaml`, `README.md`) belong to the workspace
#                   root, which is unnamed or private and never needs a bump.
#
#   catalog bump  — the branch changes a catalog entry in pnpm-workspace.yaml
#                   that the package references as `catalog:` or
#                   `catalog:<name>` from `dependencies` or `peerDependencies`.
#                   Those dependencies ship with the package, so a new version
#                   of one is a new version of the package. `devDependencies`
#                   and `optionalDependencies` do not count.
#
# "The branch changes" means the difference between the merge base with the
# base branch and HEAD: commits that landed on the base branch after the
# branch left it are not the branch's changes.
#
# Private packages are skipped — they never appear in a changeset's release
# set.
#
# An empty changeset added in this branch (`pnpm changeset --empty`) waives the
# requirement — see section 4.
#
# Runs from the repo root after `pnpm install`. Needs `git` with the base
# branch's history, `pnpm`, `jq` and `yq` (mikefarah, v4+).

set -o nounset
set -o errexit
set -o pipefail

: "${BASE_BRANCH:?BASE_BRANCH required}"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf '::error::%s\n' "$*" >&2; }

# Associative arrays (`declare -A`) need bash 4+. macOS ships bash 3.2 as
# /bin/bash, where `declare -A` aborts with a cryptic `invalid option`.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  err "check-coverage requires bash 4+ (found ${BASH_VERSION:-unknown})."
  exit 2
fi

for tool in git pnpm jq yq; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    err "${tool} not found on PATH."
    exit 2
  fi
done

# changeset's --output resolves an absolute path against the cwd on macOS, so
# the status file takes a cwd-relative path.
status_json=".changeset-coverage-status-$$.json"
trap 'rm -f "${status_json}"' EXIT

# ---------------------------------------------------------------------------
# 1. Bumped set: the packages the branch's changesets release.
# ---------------------------------------------------------------------------

# `pnpm exec` and `pnpm <script>` drop `node_modules/.bin` from PATH on repeated
# invocations, so the binary is called by its path.
changeset_bin='./node_modules/.bin/changeset'
if [ ! -x "${changeset_bin}" ]; then
  err 'changeset binary not found. Did `pnpm install` run before this step?'
  exit 2
fi

# A branch without changesets makes `changeset status` exit 1 with "no
# changesets were found". That is a coverage question to answer, not a tooling
# failure, so it continues with an empty bumped set.
set +e
cs_output="$(
  "${changeset_bin}" status \
    --output="${status_json}" \
    --since="origin/${BASE_BRANCH}" 2>&1
)"
cs_exit=$?
set -e

if [ ! -s "${status_json}" ]; then
  if [ "${cs_exit}" -ne 0 ] && ! printf '%s' "${cs_output}" | grep -q 'no changesets were found'; then
    err "changeset status failed (exit ${cs_exit}):"
    printf '%s\n' "${cs_output}" | sed 's/^/    /' >&2
    exit 2
  fi
  echo '{"releases":[]}' >"${status_json}"
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
# 2. Required set: the published packages the branch changes.
# ---------------------------------------------------------------------------
declare -A required_set=()
declare -A required_reason=()

require_pkg() {
  local pkg="$1" reason="$2"
  required_set["${pkg}"]=1
  required_reason["${pkg}"]="${required_reason[${pkg}]:-}${reason}; "
}

if ! merge_base="$(git merge-base "origin/${BASE_BRANCH}" HEAD 2>/dev/null)"; then
  err "No merge base between origin/${BASE_BRANCH} and HEAD. Check out with full history (fetch-depth: 0)."
  exit 2
fi

# Workspace packages: directory relative to the repo root ('' for the root
# itself) and the name to require ('' for an unnamed or private package).
if ! packages_json="$(pnpm -r list --depth -1 --json 2>/dev/null)" \
  || ! jq -e 'type == "array" and length > 0' >/dev/null <<<"${packages_json}"; then
  err 'pnpm list did not return the workspace packages.'
  exit 2
fi

pkg_dirs=()
pkg_names=()
while IFS=$'\t' read -r path name; do
  rel=''
  # pnpm prints absolute paths with symlinks resolved (macOS /tmp is
  # /private/tmp), so either form of the cwd may prefix them.
  for root in "$(pwd -P)" "$(pwd -L)"; do
    case "${path}" in
      "${root}")   rel='.' ;;
      "${root}"/*) rel="${path#"${root}"/}" ;;
    esac
    [ -n "${rel}" ] && break
  done
  [ -z "${rel}" ] && continue
  [ "${rel}" = '.' ] && rel=''
  pkg_dirs+=("${rel}")
  pkg_names+=("${name}")
done < <(
  jq -r '.[] | [
      (.path | rtrimstr("/")),
      (if (.name // "") == "" or .private == true then "" else .name end)
    ] | @tsv' <<<"${packages_json}"
)

# 2a. Direct edits.
#
# `--no-renames` lists both sides of a move, so moving a file out of a package
# is an edit of that package.
if ! changed_files="$(git diff --name-only --no-renames "${merge_base}" HEAD)"; then
  err "git diff against the merge base with origin/${BASE_BRANCH} failed."
  exit 2
fi

while IFS= read -r file; do
  [ -z "${file}" ] && continue
  owner=-1
  owner_len=-1
  for i in "${!pkg_dirs[@]}"; do
    dir="${pkg_dirs[${i}]}"
    if [ -z "${dir}" ] || [[ "${file}" == "${dir}/"* ]]; then
      if [ "${#dir}" -gt "${owner_len}" ]; then
        owner="${i}"
        owner_len="${#dir}"
      fi
    fi
  done
  [ "${owner}" -lt 0 ] && continue
  pkg="${pkg_names[${owner}]}"
  [ -z "${pkg}" ] && continue
  [ -n "${required_set[${pkg}]:-}" ] && continue
  require_pkg "${pkg}" 'direct edit'
done <<<"${changed_files}"

log "Direct-edit packages: ${#required_set[@]}"

# 2b. Catalog bumps.
#
# Both sides of pnpm-workspace.yaml are normalised to
# { "<catalog name>": { "<dependency>": "<version>" } }. The top-level
# `catalog:` is the catalog named `default`, the same one `catalogs.default`
# names.
catalogs_at() {
  local rev="$1"
  if ! git cat-file -e "${rev}:pnpm-workspace.yaml" 2>/dev/null; then
    echo '{}'
    return 0
  fi
  git show "${rev}:pnpm-workspace.yaml" \
    | yq -o=json '.' \
    | jq -c '
        (. // {}) as $ws
        | ($ws.catalogs // {}) + { default: (($ws.catalogs.default // {}) + ($ws.catalog // {})) }
        | map_values(. // {} | map_values(tostring))
      '
}

if ! base_catalogs="$(catalogs_at "${merge_base}")" \
  || ! head_catalogs="$(catalogs_at HEAD)"; then
  err 'Could not read the catalogs in pnpm-workspace.yaml.'
  exit 2
fi

# { "<catalog name>": ["<dependency>", ...] } for every entry added, removed or
# re-versioned.
changed_catalogs="$(
  jq -cn --argjson base "${base_catalogs}" --argjson head "${head_catalogs}" '
    [ ($base | keys[]), ($head | keys[]) ] | unique
    | map(. as $name
        | {
            key: $name,
            value: (
              [ ($base[$name] // {} | keys[]), ($head[$name] // {} | keys[]) ] | unique
              | map(select($base[$name][.] != $head[$name][.]))
            )
          })
    | map(select(.value | length > 0))
    | from_entries
  '
)"

catalog_required=0
if [ "${changed_catalogs}" != '{}' ]; then
  log "Changed catalog entries: $(jq -r 'to_entries | map("\(.key): \(.value | join(", "))") | join("; ")' <<<"${changed_catalogs}")"

  for i in "${!pkg_dirs[@]}"; do
    pkg="${pkg_names[${i}]}"
    [ -z "${pkg}" ] && continue
    manifest="${pkg_dirs[${i}]:-.}/package.json"
    [ -f "${manifest}" ] || continue
    if ! deps="$(
      jq -r --argjson changed "${changed_catalogs}" '
        [ .dependencies, .peerDependencies ]
        | map(select(type == "object") | to_entries[]) | .[]
        | select(.value | type == "string" and startswith("catalog:"))
        | .key as $dep
        | (.value | ltrimstr("catalog:") | if . == "" then "default" else . end) as $name
        | select($changed[$name] // [] | any(. == $dep))
        | $dep
      ' "${manifest}" | sort -u
    )"; then
      err "Could not read ${manifest}."
      exit 2
    fi
    while IFS= read -r dep; do
      [ -z "${dep}" ] && continue
      require_pkg "${pkg}" "catalog bump: ${dep}"
      catalog_required=$((catalog_required + 1))
    done <<<"${deps}"
  done
fi

log "Catalog-bump requirements: ${catalog_required}"

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
  git diff --name-only --diff-filter=A "${merge_base}" HEAD -- .changeset 2>/dev/null || true
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
