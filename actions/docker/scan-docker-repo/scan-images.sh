#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

#
# Positional parameters
#
registry="${1}" # i.e. containers.pl-open.science
repository="${2}" # i.e. milaboratories/pl-containers
shift 2
tags=("${@}") # scan given tags only (no listing)

#
# Debug options
#
: "${DEBUG:=${ACTIONS_STEP_DEBUG:-${RUNNER_DEBUG:-false}}}"
: "${SCAN_IMAGES_LIMIT:=}" # stop sanning after this amount of images

#
# Special interface for action
#
: "${TAGS:=}" # scan given tags only (for simpler action code)
: "${TAG_FILE:=}" # file with list of tags to scan (parallel scanning feature)
: "${IGNORE_LIST:=${script_dir}/ignore-lists}" # file or directory with list of images to ignore
: "${SKIPPED_LIST_FILE:=$(mktemp)}" # file with list of actually skipped images

ignore_lists=()
if [ -n "${IGNORE_LIST}" ]; then
    mapfile -t ignore_lists < <(
        grep --extended-regexp --invert-match '^#|^ *$' <<<"${IGNORE_LIST}"
    )
fi

#
# Trivy control
#
: "${TRIVY_BIN:=trivy}"

: "${PKG_TYPES:=os,library}"
: "${SCANNERS:=vuln,secret,misconfig}"
: "${SEVERITY:=HIGH,CRITICAL}"
: "${IGNORE_UNFIXED:=false}"

: "${REPORT_FORMAT:=json}"
: "${REPORT_FILE:=}"

logf() {
    printf "$@" >&2
}

log() {
    logf "%s\n" "$*"
}

get_list_page() {
    local _registry="$1"
    local _repository="$2"
    local _last="$3"
    local _n="${4:-100}"

    curl -s "https://${_registry}/v2/${_repository}/tags/list?last=${_last}&n=${_n}" |
        jq -r '.tags[]' | grep -v '^$'
}

list_images() {
    local _registry="${1}"
    local _repository="${2}"
    local _limit="${3:-}"

    local _list=()
    local _last=""
    local _n=100 # this is maximum. Values higher are silently reduced.

    mapfile -t _list <<< "$(get_list_page "${_registry}" "${_repository}" "${_last}" "${_n}")"

    local _items_count=0
    while [ "${#_list[@]}" -gt 0 ]; do
        if [ "${#_list[@]}" -eq 1 ] && [ -z "${_list[0]}" ]; then
            break
        fi

        local _tag
        for _tag in "${_list[@]}"; do
            echo "${_full_tag}" 2>/dev/null
            _items_count=$((_items_count + 1))
        done

        _last="${_list[-1]}"
        _list=()
        mapfile -t _list <<< "$(get_list_page "${_registry}" "${_repository}" "${_last}" "${_n}")"
    done

    log "  items found: ${_items_count}"
}

should_ignore() {
    local __full_tag="${1}"

    if [ -z "${ignore_lists}" ]; then
        return 1 # do not ignore anything when ignore list is empty
    fi

    if grep \
        --recursive \
        --silent \
        --line-regexp "${_full_tag}" \
        "${ignore_lists[@]}"; then
        
        [ "${DEBUG}" == "true" ] && log "  skipping ${_full_tag} (listed in ignore list)"
        echo "${_full_tag}" >> "${SKIPPED_LIST_FILE}"
        return 0
    fi

    return 1 # no matches in ignore lists. Need to scan.
}

read_tags_list() {
    local _t
    while read -r t; do
        tags+=("${t}")
    done < <(grep --extended-regexp --invert-match '^#|^ *$')
}

scan_image() {
    local _image="$1"

    local _opts=(
        --format "${REPORT_FORMAT}"
        --pkg-types "${PKG_TYPES}"
        --scanners "${SCANNERS}"
        --severity "${SEVERITY}"
        --exit-code "1"
    )

    if [ "${IGNORE_UNFIXED}" == "true" ]; then
        _opts+=( --ignore-unfixed )
    fi

    if [ "${DEBUG}" != "true" ]; then
        _opts+=( --quiet )
    fi

    if [ "${DRY_RUN:-false}" != "false" ]; then
        echo "${TRIVY_BIN}" image "${_opts[@]}" "${_image}"
        return 0
    fi

    if should_ignore "${_image}"; then
        return 0
    fi

    log "  scanning ${_image}"

    if [ -n "${REPORT_FILE}" ]; then
    (
        [ "${DEBUG}" == "true" ] && set -x
        "${TRIVY_BIN}" image "${_opts[@]}" "${_image}" | jq --compact-output >> "${REPORT_FILE}"
    )
    else
    (
        [ "${DEBUG}" == "true" ] && set -x
        "${TRIVY_BIN}" image "${_opts[@]}" "${_image}" | jq --compact-output
    )
    fi
}

scan_images() {
    local _limit="${1:-}"
    local _success=true

    local _items_count=0
    while read -r tag; do
        scan_image "${tag}" || _success=false

        _items_count=$((_items_count + 1))
        if [ -n "${_limit}" ] && [ "${_items_count}" -ge "${_limit}" ]; then
            log "  reached scan limit of ${_limit} images"
            break
        fi
    done

    if [ "${_success}" != "true" ]; then
        return 1
    fi
}

#
# Script body
#

if [ -n "${REPORT_FILE}" ]; then
    log "Report file: ${REPORT_FILE}"
    printf "" > "${REPORT_FILE}"
fi

# Read tags list from action inputs
if [ -n "${TAGS}" ]; then
    read_tags_list <<< "${TAGS}"
fi

# Read tags list from file
if [ -n "${TAG_FILE}" ]; then
    read_tags_list < <(cat "${TAG_FILE}")
fi

cmd_example=$(DRY_RUN="y" scan_image "<image-tag>")
logf "Analysis command:\n  ${cmd_example}\n\n"

success=true
if [ -n "${tags}" ]; then
    for tag in "${tags[@]}"; do
        scan_image "${registry}/${repository}:${tag}" || success=false
    done
else
    log "Scanning images in ${registry}/${repository}..."
    list_images "${registry}" "${repository}" "${SCAN_IMAGES_LIMIT}" |
        scan_images "${SCAN_IMAGES_LIMIT}" || success=false
fi

if [ "${success}" == "true" ]; then
    log "Scan completed successfully, no CVEs found!"
    exit 0
fi

log ""
log "# ====================================================== #"
log "#             Found issues in scanned images             #"
log "# ====================================================== #"
if [ -n "${REPORT_FILE}" ] && [ "${REPORT_FORMAT}" == "json" ]; then

    log ""
    log "CVEs found:"
    cat "${REPORT_FILE}" |
        jq -r '
            select(.Results[].Vulnerabilities) |
            [
                .ArtifactName,
                (
                    [
                        .Results[] |
                        select(.Vulnerabilities) |
                        .Vulnerabilities[] |
                        .Severity
                    ] |
                        group_by(.) |
                        map({key: .[0], value: length}) |
                        map("\(.key): \(.value)") |
                        join(", ")
                )
            ] |
                .[0] + " (" + .[1] + ")"' >&2

    log ""
    log "Misconfigurations found: "
    cat "${REPORT_FILE}" |
        jq -r '
            select(.Results | any(.Misconfigurations)) |
            [
                .ArtifactName,
                (
                    [
                        .Results[] |
                        select(.Misconfigurations) |
                        .Misconfigurations[] |
                        .Severity
                    ] |
                        group_by(.) |
                        map({key: .[0], value: length}) |
                        map("\(.key): \(.value)") |
                        join(", ")
                )
            ] |
                .[0] + " (" + .[1] + ")"' >&2
fi

logf "Skipped images: %d\n" "$(wc -l "${SKIPPED_LIST_FILE}" | awk '{print $1}')"
[ "${DEBUG}" == "true" ] && cat "${SKIPPED_LIST_FILE}" | awk '{printf "  %s\n", $0}' >&2

exit 1
