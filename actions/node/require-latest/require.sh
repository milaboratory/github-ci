#!/usr/bin/env bash

set -o nounset
set -o errexit

: "${PACKAGES_TO_CHECK:=}" # require these packages to be latest
: "${RECURSIVE:=false}" # make sure none of dependencies also use an old version
: "${MAX_AGE_DAYS:=2}" # a newer minor fails the check once it is this many days old

logf() {
  printf "$@" >&2
}

log() {
  logf "%s\n" "$*"
}

registry_metadata() {
  local _package="${1}"
  # Query the npm registry HTTP API directly with curl + jq, bypassing npm/pnpm. Both
  # `npm view` and `pnpm view` honour the runner's global/user .npmrc, which maps the
  # @platforma-sdk scope to an auth-requiring registry -> a broken/absent token 401s even
  # public scoped reads -> empty result. curl has no such config. We send NPMJS_TOKEN as a
  # bearer when present so this also works for private scoped packages (ignored/valid for
  # public ones). node is NOT on PATH in the runner image, so jq (which is) does the parse.
  # The slash in a scoped name must be %2F-encoded.
  local _enc _auth=()
  _enc=$(printf '%s' "${_package}" | sed 's,/,%2F,g')
  if [ -n "${NPMJS_TOKEN:-}" ]; then
    _auth=(-H "Authorization: Bearer ${NPMJS_TOKEN}")
  fi
  curl -fsSL "${_auth[@]}" "https://registry.npmjs.org/${_enc}" 2>/dev/null
}

# Print "<version> <publish time>" of the oldest release in a newer minor line than
# <current> that is more than <days> old. Print nothing when there is none.
# Only stable releases up to the 'latest' dist-tag count.
# Fails when <current> or the 'latest' dist-tag is not a version.
overdue_minor() {
  local _metadata="${1}"
  local _current="${2}"
  local _days="${3}"

  # Publish times are UTC ISO 8601 strings, which sort in time order as text.
  jq -r --arg current "${_current}" --argjson days "${_days}" '
    def minor:
      (capture("^(?<major>[0-9]+)\\.(?<minor>[0-9]+)\\.") // error("not a version: \(.)"))
      | [.major, .minor | tonumber];
    (now - $days * 86400 | todate) as $cutoff
    | ($current | minor) as $used
    | (."dist-tags".latest | minor) as $latest
    | [ .time | to_entries[]
        | select(.key | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
        | select((.key | minor) > $used and (.key | minor) <= $latest)
        | select(.value < $cutoff) ]
    | min_by(.value) // empty
    | "\(.key) \(.value)"' <<< "${_metadata}"
}

# Get all versions of a package used directly or by transitive dependencies.
versions_recursive() {
  local _lockfile="${1}"
  local _package="${2}"

  cat "${_lockfile}" |
    _tst="^${_package}" yq '.packages | keys | .[] | select( test( env(_tst) ) )' |
    awk -F '@' '{print $3}'
}

# Get all versions of a package used directly by pnpm workspace catalog
versions_direct() {
  cat "${_lockfile}" |
    yq ".catalogs[][\"${_package}\"].version"
}

check_package() {
  local _lockfile="${1}"
  local _package="${2}"
  local _recursive="${3:-false}"

  local _metadata
  _metadata=$(registry_metadata "${_package}")

  # Don't fail closed on a fetch error: empty metadata means the registry lookup
  # failed (network/auth), not that the used version is outdated. Warn and skip.
  if [ -z "${_metadata}" ]; then
    log "  WARNING: could not read registry metadata of '${_package}' (registry fetch failed) — skipping, not treating as outdated"
    return 0
  fi

  local _versions
  if [ "${_recursive}" == "true" ]; then
    _versions=(
      $(versions_recursive "${_lockfile}" "${_package}")
    )
  else
    _versions=(
      $(versions_direct "${_lockfile}" "${_package}")
    )
  fi

  for _current_version in "${_versions[@]}"; do
    if [ -z "${_current_version}" ] || [ "${_current_version}" == "null" ]; then
      continue
    fi

    # Patch differences never fail. A newer minor fails once it is MAX_AGE_DAYS old.
    local _overdue
    if ! _overdue=$(overdue_minor "${_metadata}" "${_current_version}" "${MAX_AGE_DAYS}"); then
      log "  ERROR: could not compare '${_package}' version '${_current_version}' with the registry metadata"
      return 1
    fi

    if [ -n "${_overdue}" ]; then
      logf "%s\n%s\n%s\n" \
        "Old package '${_package}' detected:" \
        "  version used: ${_current_version}" \
        "  newer minor released more than ${MAX_AGE_DAYS} days ago: ${_overdue}"

      return 1
    fi
  done

  return 0
}

# ------------------------------
#          Script body
# ------------------------------

log ""
log "  Checking infrastructure pnpm package requirements"
log "----------------------------------------------------------------------------"
log ""

lockfile="./pnpm-lock.yaml"

if ! [ -f "${lockfile}" ]; then
  log "Lock file '${lockfile}' not found"
  log ""
  exit 1
fi

success=true
while read -r pkg; do
  if [ -z "${pkg}" ]; then
    continue
  fi

  check_package "${lockfile}" "${pkg}" || success=false
done <<< "${PACKAGES_TO_CHECK}"

if [ "${success}" != "true" ]; then
  log ""
  log "----------------------------------------------------------------------------"
  log "  Update packages listed above to make CI work"
  log "    don't forget to run: pnpm install; git add pnpm-lock.yaml pnpm-workspace.yaml"
  log ""
  exit 1
fi

log "These packages were checked and are up to date:"
log "${PACKAGES_TO_CHECK}"
log ""
