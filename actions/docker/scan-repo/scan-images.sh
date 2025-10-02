#!/usr/bin/env bash

set -o nounset
set -o errexit

registry="${1}" # i.e. containers.pl-open.science
repository="${2}" # i.e. milaboratories/pl-containers
tag="${3:-}"

: "${TRIVY_BIN:=trivy}"

: "${PKG_TYPES:=os,library}"
: "${SCANNERS:=vuln,secret,misconfig}"
: "${IGNORE_UNFIXED:=false}"

: "${REPORT_FORMAT:=json}"
: "${REPORT_FILE:=}"

log() {
    echo "$@" >&2
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
    local _registry="$1"
    local _repository="$2"

    local _list=()
    local _last=""
    local _n=100 # this is maximum. Values higher are silently reduced.

    log "Listing images for ${_registry}/${_repository}..."

    mapfile -t _list <<< "$(get_list_page "${_registry}" "${_repository}" "${_last}" "${_n}")"

    local _items_count=0
    while [ "${#_list[@]}" -gt 0 ]; do
        if [ "${#_list[@]}" -eq 1 ] && [ -z "${_list[0]}" ]; then
            break
        fi

        local _tag
        for _tag in "${_list[@]}"; do
            echo "${_registry}/${_repository}:${_tag}"
            _items_count=$((_items_count + 1))
        done

        _last="${_list[-1]}"
        _list=()
        mapfile -t _list <<< "$(get_list_page "${_registry}" "${_repository}" "${_last}" "${_n}")"
    done

    log "  items found: ${_items_count}"
}

scan_image() {
    local _image="$1"

    local _opts=(
        --format "${REPORT_FORMAT}"
        --pkg-types "${PKG_TYPES}"
        --scanners "${SCANNERS}"
        --exit-code "1"
    )

    if [ "${IGNORE_UNFIXED}" == "true" ]; then
        _opts+=( --ignore-unfixed )
    fi

    log "  scanning image ${_image}..."
    if [ -n "${REPORT_FILE}" ]; then
        "${TRIVY_BIN}" image "${_opts[@]}" "${_image}" >> "${REPORT_FILE}"
    else
        "${TRIVY_BIN}" image "${_opts[@]}" "${_image}"
    fi
}

scan_images() {
    local _success=true

    while read -r tag; do
        if ! scan_image "${tag}"; then
            _success=false
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
    log "  report file: ${REPORT_FILE}"
    echo "" > "${REPORT_FILE}"
fi

if [ -n "${tag}" ]; then
    scan_image "${registry}/${repository}:${tag}"
else
    list_images "${registry}" "${repository}" |
        scan_images
fi
