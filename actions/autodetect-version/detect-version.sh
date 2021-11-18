#!/usr/bin/env bash

# Generate application version number from current github action context or

set -o errexit
set -o nounset

script_path="$(dirname "${0}")"
version_number=""

source "${script_path}/../lib/ghwa-commands.sh"

# Fetches all references
function git_fetch_history() {
    local _depth="${1}"
    local _current_sha

    _current_sha="$(git rev-parse HEAD)"

    # Fetch all git tags first. We don't need their history,
    # but we have to know their SHAs.
    # This command breaks the LOCAL history of origin, overwriting
    # it with single commit for each remote ref (grafted commit)
    git fetch --depth=1 --tags origin

    # Fetch current commit's history up to ${_depth} records to restore
    # HEAD's commits chain in hope we'll find at least one tag in there.
    git fetch --depth="${_depth}" origin "${_current_sha}"
}

function git_generate_version() {
  git describe --tags |
    awk '{sub("-", ".", $0); print $0}' | # v1.0-2-g<hash> -> v1.0.2-g<hash>
    sed -E 's/^v//;
            s/-g([a-f0-9]+)$/-\1/' # v1.0.2-g<hash> -> 1.0.2-<hash>
}

function context_detect_version() {
  local _ref_type
  local _ref_name

  _ref_type=$(jq ".ref_type" <<<"${CONTEXT_GITHUB}")
  _ref_name=$(jq ".ref_name" <<<"${CONTEXT_GITHUB}")

  if [ "${_ref_type}" = "tag" ]; then
    echo "${_ref_name}"
  fi
}

if [ "${#}" -lt "1" ]; then
  echo "Please, specify git history fetch depth" >&2
  exit 64
fi

fetch_depth="${1}"

echo "Current directory: ${PWD}"
echo "Git remotes: $(git remote -v)"
echo "Current environment: "
env | awk '{print "                     "$0}'
echo "Current dir contents: "
ls -A | awk '{print "                      "$0}'

if [ -z "${CONTEXT_GITHUB:+"not set"}" ]; then
  # We have JSON-encoded github context. Let's use it for version generation
  version_number="$(context_detect_version)"
fi

if [ -z "${version_number}" ]; then
  # We failed to determine version number from action context here.
  # Generate version number from current git repository state
  git_fetch_history "${fetch_depth}"
  version_number="$(git_generate_version)"
fi

ghwa_set_output "version" "${version_number}"
