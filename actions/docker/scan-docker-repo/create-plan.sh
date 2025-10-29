#!/usr/bin/env bash

set -o nounset
set -o errexit

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${#}" -ne 4 ]; then
    echo "Usage: ${0} <registry> <repository> <target-dir> <chunks-count>"
    exit 1
fi

registry="${1}" # registry to scan (i.e. containers.pl-open.science)
repository="${2}" # repository in the registry (i.e. milaboratories/pl-containers)
target_dir="${3}" # target directory for chunk files
chunks_count="${4}" # number of groups to split into

#
# Debug options
#
: "${DEBUG:=${ACTIONS_STEP_DEBUG:-${RUNNER_DEBUG:-false}}}"
: "${SCAN_IMAGES_LIMIT:=}" # stop sanning after this amount of images

#
# Special interface for action
#
: "${IGNORE_LIST:=${script_dir}/ignore-lists}" # file or directory with list of images to ignore
: "${SKIPPED_FILE:=$(mktemp)}" # file with list of actually skipped images

ignore_lists=()
if [ -n "${IGNORE_LIST}" ]; then
    mapfile -t ignore_lists < <(
        grep --extended-regexp --invert-match '^#|^ *$' <<<"${IGNORE_LIST}"
    )
fi

skip_ignored() {
    local _full_tag

    while read -r _full_tag; do
        if [ -n "${ignore_lists}" ]; then
            if grep \
                --recursive \
                --silent \
                --line-regexp "${_full_tag}" \
                "${ignore_lists[@]}"; then

                [ "${DEBUG}" == "true" ] && log "  skipping ${_full_tag} (listed in ignore list)"
                echo "${_full_tag}" >> "${SKIPPED_FILE}"

                return
            fi
        fi

        echo "${_full_tag}"
    done
}

if [ ! -d "${target_dir}" ]; then
    mkdir -p "${target_dir}"
fi

if [ ! -f "${SKIPPED_FILE}" ]; then
    touch "${SKIPPED_FILE}"
fi

# Split list of tags into ${chunks_count} files inside ${target_dir}
# Files are rotated in round-robin manner to avoid large images bias: if some software is large,
# it is sperad across several chunks and is treated by CI in parallel, providing better
# execution time equality for all chunks.
"${script_dir}/list-images.sh" "${registry}" "${repository}" |
    skip_ignored |
    awk \
        -v "chunks_count=${chunks_count}" \
        -v "prefix=${target_dir}/chunk_" \
        '{print > (prefix ((NR-1) % chunks_count + 1))}'
