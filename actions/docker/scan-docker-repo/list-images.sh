#!/usr/bin/env bash

set -o nounset
set -o errexit

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

    while [ "${#_list[@]}" -gt 0 ]; do
        if [ "${#_list[@]}" -eq 1 ] && [ -z "${_list[0]}" ]; then
            break
        fi

        local _tag
        for _tag in "${_list[@]}"; do
            echo "${_registry}/${_repository}:${_tag}" 2>/dev/null
        done

        _last="${_list[-1]}"
        _list=()
        mapfile -t _list <<< "$(get_list_page "${_registry}" "${_repository}" "${_last}" "${_n}")"
    done
}

registry="${1}"
repository="${2}"
limit="${3:-}"

list_images "${registry}" "${repository}" "${limit}"
