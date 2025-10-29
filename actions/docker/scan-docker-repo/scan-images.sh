#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

#
# Positional parameters
#
tags=("${@}") # scan given tags only (no listing)

#
# Debug options
#
: "${DEBUG:=${ACTIONS_STEP_DEBUG:-${RUNNER_DEBUG:-false}}}"
: "${SCAN_IMAGES_LIMIT:=}" # stop sanning after this amount of images

#
# Special interface for action
#
: "${TAG_FILE:=}" # file with list of tags to scan (parallel scanning feature)

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

scan_count=0
scan_image() {
    local _image="$1"
    local _limit="${2:-}"

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

    if [ -n "${_limit}" ] && [ "${scan_count}" -ge "${_limit}" ]; then
        log "  reached scan limit of ${_limit} images"
        return 0
    fi

    scan_count=$((scan_count + 1))
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

#
# Script body
#
if [ -n "${REPORT_FILE}" ]; then
    log "Report file: ${REPORT_FILE}"
    printf "" > "${REPORT_FILE}"
fi

if [ -n "${TAG_FILE}" ]; then
    while read -r _tag; do
        tags+=("${_tag}")
    done < <(
        grep \
            --extended-regexp \
            --invert-match \
            '^#|^ *$' \
            "${TAG_FILE}"
    )
fi

cmd_example=$(DRY_RUN="y" scan_image "<image-tag>")
logf "Analysis command:\n  ${cmd_example}\n\n"

success=true
for tag in "${tags[@]}"; do
    scan_image "${tag}" "${SCAN_IMAGES_LIMIT}" || success=false
done

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

exit 1
