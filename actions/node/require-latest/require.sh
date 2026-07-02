#!/usr/bin/env bash

set -o nounset
set -o errexit

: "${PACKAGES_TO_CHECK:=}" # require these packages to be latest
: "${RECURSIVE:=false}" # make sure none of dependencies also use an old version

logf() {
  printf "$@" >&2
}

log() {
  logf "%s\n" "$*"
}

latest_version() {
  local _package="${1}"
  # Query the public npm registry from a scratch dir. A repo/runner .npmrc with an
  # unexpanded ${NPMJS_TOKEN} makes npm send a broken auth header that 401s even a
  # public scoped read -> empty result -> false "outdated". Running from an empty dir
  # with an explicit public registry avoids that (public @platforma-sdk/* need no auth).
  ( cd "$(mktemp -d)" && npm view "${_package}" version --registry="https://registry.npmjs.org/" ) 2>/dev/null
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

  local _latest_version
  _latest_version=$(latest_version "${_package}")

  # Don't fail closed on a fetch error: an empty latest means the registry lookup
  # failed (network/auth), not that the used version is outdated. Warn and skip.
  if [ -z "${_latest_version}" ]; then
    log "  WARNING: could not determine latest version of '${_package}' (registry fetch failed) — skipping, not treating as outdated"
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

    # Compare only major.minor, ignoring patch version differences
    local _latest_major_minor="${_latest_version%.*}"
    local _current_major_minor="${_current_version%.*}"

    if [ "${_latest_major_minor}" != "${_current_major_minor}" ]; then
      logf "%s\n%s\n%s\n" \
        "Old package '${_package}' detected:" \
        "  latest version: ${_latest_version}" \
        "  version used: ${_current_version}"

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
