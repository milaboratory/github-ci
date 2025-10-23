#!/usr/bin/env bash

set -o nounset
set -o errexit

: "${PACKAGES_TO_CHECK:=}"

logf() {
  printf "$@" >&2
}

log() {
  logf "%s\n" "$*"
}

latest_version() {
  local _package="${1}"
  npm view "${1}" version 2>/dev/null
}

versions_in_use() {
  local _lockfile="${1}"
  local _package="${2}"

  cat "${_lockfile}" |
    _tst="^${_package}" yq '.packages | keys | .[] | select( test( env(_tst) ) )' |
    awk -F '@' '{print $3}'
}

check_package() {
  local _lockfile="${1}"
  local _package="${2}"

  local _latest_version
  _latest_version=$(latest_version "${_package}")

  for _current_version in $(versions_in_use "${_lockfile}" "${_package}"); do
    if [ -z "${_current_version}" ]; then
      continue
    fi

    if [ "${_latest_version}" != "${_current_version}" ]; then
      log "Latest version of '${_package}' is ${_latest_version}. Update package to make CI work"
      return 1
    fi
  done

  return 0
}

# ------------------------------
#          Script body
# ------------------------------

log "# -------------------------------------------------------------- #"
log "#      Checking infrastructure requirements for publication      #"
log "# -------------------------------------------------------------- #"
log ""

lockfile="./pnpm-lock.yaml"

if ! [ -f "${lockfile}" ]; then
  log "Lock file '${lockfile}' not found"
  log ""
  exit 1
fi

success=true
while read -r package; do
  check_package "${lockfile}" "${package}" || success=false
done <<< "${PACKAGES_TO_CHECK}"

if [ "${success}" != "true" ]; then
  log ""
  log "----------------------------------------------------------------------------"
  log "  Update insfrastructure packages to make CI work"
  log "    pnpm update-sdk; pnpm install; pnpm add pnpm-lock.yaml pnpm-workspace.yaml"
  log ""
  exit 1
fi

log "These packages were checked and are up to date:"
log "${PACKAGES_TO_CHECK}"
log ""
