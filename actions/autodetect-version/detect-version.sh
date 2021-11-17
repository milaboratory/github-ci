#!/usr/bin/env bash

# Generate application version number from current github action context or

set -o errexit
set -o nounset

script_path="$(dirname "${0}")"
version_number=""

source "${script_path}/../lib/ghwa-commands.sh"

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

if [ -z "${CONTEXT_GITHUB:+"not set"}" ]; then
  # We have JSON-encoded github context. Let's use it for version generation
  version_number="$(context_detect_version)"
fi

if [ -z "${version_number}" ]; then
  # We failed to determine version number from action context here.
  # Generate version number from current git repository state
  version_number="$(git_generate_version)"
fi

ghwa_set_output "version" "${version_number}"
