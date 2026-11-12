#!/usr/bin/env bash

set -o nounset
set -o errexit

: "${PACKAGES_TO_CHECK:=}" # require these packages to be on the latest major version
: "${RECURSIVE:=false}" # make sure none of dependencies also use an old version

logf() {
  printf "$@" >&2
}

log() {
  logf "%s\n" "$*"
}

latest_version() {
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
  curl -fsSL "${_auth[@]}" "https://registry.npmjs.org/${_enc}" 2>/dev/null |
    jq -r '."dist-tags".latest // empty' 2>/dev/null
}

# Print the major number of a version. Print nothing when it does not start with "<number>.".
major_of() {
  [[ "${1}" =~ ^([0-9]+)\. ]] && printf '%s' "${BASH_REMATCH[1]}" || true
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

  local _latest _latest_major
  _latest=$(latest_version "${_package}")
  _latest_major=$(major_of "${_latest}")

  # Don't fail closed on a fetch error: no latest major means the registry lookup
  # failed (network/auth), not that the used version is outdated. Warn and skip.
  if [ -z "${_latest_major}" ]; then
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

    # Only an older major version fails. Minor and patch differences never do.
    local _major
    _major=$(major_of "${_current_version}")
    if [ -z "${_major}" ]; then
      log "  WARNING: could not read the major version of '${_package}' version '${_current_version}' — skipping, not treating as outdated"
      continue
    fi

    if [ "${_major}" -lt "${_latest_major}" ]; then
      logf "%s\n%s\n%s\n" \
        "Old package '${_package}' detected:" \
        "  version used: ${_current_version}" \
        "  latest version: ${_latest}"

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
