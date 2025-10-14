#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
set -x

# Scan single package in given directory.
# When empty - software packages in current pnpm workspace are automatically
#              detected and scanned.
# When not empty - is expected to keep \n-separatedlist of package directories
#                  to scan. Each package is required to be pl software package.
: "${PATHS_TO_SCAN:=}"

: "${DEBUG:=${ACTIONS_STEP_DEBUG:-${RUNNER_DEBUG:-false}}}"
: "${TRIVY_BIN:=trivy}"
: "${SKIPPED_LIST_FILE:=}" # file with list of actually skipped images

: "${PKG_TYPES:=os,library}"
: "${SCANNERS:=vuln,secret,misconfig}"
: "${SEVERITY:=HIGH,CRITICAL}"
: "${IGNORE_UNFIXED:=false}"

: "${REPORT_FORMAT:=json}"
: "${REPORT_FILE:=}"

failed_to_scan_packages=$(mktemp)

logf() {
    printf "$@" >&2
}

log() {
    logf "%s\n" "$*"
}

debug() {
    if [ "${DEBUG:-}" = "true" ]; then
        log "$*"
    fi
}

# List all packages in current pnpm workspace.
# Output format is:
#  [ { "name": "<npm package name>",
#      "version": "<.version field from package.json>",
#      "path": "<abs path to package root>",
#      "private": <.private field from package.json> },
#    ... ]
list_packages() {
    log "Listing npm packages in current workspace"
    pnpm ls \
        --recursive \
        --depth -1 \
        --json |
        jq \
            --compact-output \
            '.[] | select(.private | not)'
}

# Checks if package in given directory is pl software package.
is_software_package() {
    local _package_path="$1"
    jq --exit-status 'has("block-software")' "${_package_path}/package.json" >/dev/null;
}

is_tengo_package() {
    local _package_path="$1"
    if [ -d "${_package_path}/src" ]; then
        find "${_package_path}/src" -type f -name '*.tengo' |
            grep -q '.'
    else
        return 1
    fi
}

# Gets input from list_packages() and selects only pl software packages.
# Works like grep: does not modify the input, just filters it.
select_software_packages() {
    debug "  selecting software packages..."

    local _items_count=0
    local _package
    while read -r _package; do
        if [ -z "${_package}" ]; then
            continue
        fi

        local _name=$(jq -r '.name' <<< "${_package}")
        local _path=$(jq -r '.path' <<< "${_package}")

        if is_software_package "${_path}"; then
            echo "${_package}" 2>/dev/null
            _items_count=$((_items_count + 1))
            continue
        fi

        if is_tengo_package "${_path}"; then
            echo "${_package}" 2>/dev/null
            _items_count=$((_items_count + 1))
            continue
        fi

        debug "  package '${_name}' is skipped (not software or tengo package)"
        [ -n "${SKIPPED_LIST_FILE}" ] && echo "${_package}" >> "${SKIPPED_LIST_FILE}"
    done

    log "  software packages found: ${_items_count}"
}

# Get list of docker images built in given software package.
# Output format is:
#  <full docker image tag 1>
#  <full docker image tag 2>
#  ...
get_software_package_images() {
    local _package_path="$1"

    debug "  getting docker images for '${_package_path}'..."

    if [ ! -d "${_package_path}/dist/artifacts/" ]; then
        log "  no artifacts found for software package '${_package_path}'. Seems package was not built."
        return
    fi

    find "${_package_path}/dist/artifacts/" \
        -type f \
        -name "*.json" \
        -exec cat {} \; |
        jq --raw-output 'select(.type == "docker") | .remoteArtifactLocation'
}

# Scan all docker images in single npm package with Trivy.
scan_npm_package() {
    local _package_path="${1}"
    local _require_docker="${2:-false}"

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
        echo "${TRIVY_BIN}" image "${_opts[@]}" "<image-tag>"
        return 0
    fi

    local _images=()
    if is_software_package "${_package_path}"; then
        debug "  package '${_package_path}' is a software package"

        mapfile -t _images <<< "$(get_software_package_images "${_package_path}")"
        if [ "${#_images[@]}" -eq 0 ] || [ -z "${_images[0]}" ]; then
            # Make error report informative: we did not build package, or it has no rules for docker.
            log "! No docker images found for '${_package_path}'"
            echo "${_package_path}: no images found" >> "${failed_to_scan_packages}"
            if [ "${_require_docker}" == "true" ]; then
                debug "  require_docker = true. Returning 1"
                return 1
            else
                debug "  require_docker = false. Not an error."
                return 0
            fi
        fi

    elif is_tengo_package "${_package_path}"; then
        debug "  package '${_package_path}' is a tengo package"

        local _sw
        while read -r _sw; do
            if [ -z "${_sw}" ]; then
                continue # workflow with zero software dependencies causes _sw to be empty
            fi

            debug "  examining software: ${_sw}"

            if ! jq --exit-status 'select(.docker.tag)' <<< "${_sw}" >/dev/null; then
                log "! No docker images found for '${_package_path}' in software $(jq --raw-output '.name' <<< "${_sw}")"
                echo "${_package_path}: no images found in $(jq --raw-output '.name' <<< "${_sw}")" >> "${failed_to_scan_packages}"
                # We always require docker for all software used by tengo.
                return 1
            fi

            debug "  adding docker image to check list"
            _images+=( "$(jq --raw-output '.docker.tag' <<< "${_sw}")" )
        done <<< "$(
            cd "${_package_path}" &&
                ./node_modules/.bin/pl-tengo dump software --log-level=error
        )"

    else
        # Make error report informative: we tried to scan wrong package.
        # Important for selective scan mode.
        log "! Package '${_package_path}' is not a software or tengo package"
        echo "${_package_path}: not a software or tengo package" >> "${failed_to_scan_packages}"
        return 1
    fi

    for _image in "${_images[@]}"; do
        log "  scanning ${_image}"

        if [ -n "${REPORT_FILE}" ]; then
        (
            [ "${DEBUG}" != "true" ] || set -x
            "${TRIVY_BIN}" image "${_opts[@]}" "${_image}" | jq --compact-output >> "${REPORT_FILE}"
        )
        else
        (
            [ "${DEBUG}" != "true" ] || set -x
            "${TRIVY_BIN}" image "${_opts[@]}" "${_image}" | jq --compact-output
        )
        fi
    done
}

# Scan all npm packages obtained from stdin
# Expects input to contain paths to packages root directories.
scan_npm_packages() {
    local _require_docker="${1:-false}"
    local _package_path

    local _success=true
    while read -r _package_path; do
        log "Checking ${_package_path}:"
        scan_npm_package "${_package_path}" "${_require_docker}" || _success=false
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

if [ -n "${SKIPPED_LIST_FILE}" ]; then
    log "Skipped list file: ${SKIPPED_LIST_FILE}"
    printf "" > "${SKIPPED_LIST_FILE}"
fi

cmd_example=$(DRY_RUN="y" scan_npm_package "<package-path>")
logf "Analysis command:\n  %s\n\n" "${cmd_example}"

success=true
if [ -z "${PATHS_TO_SCAN}" ]; then
    list_packages |
        select_software_packages |
        jq --raw-output '.path' |
        scan_npm_packages "false" || success=false
else
    echo "${PATHS_TO_SCAN}" |
        grep -vE '^ *$' |
        scan_npm_packages "true" || success=false
fi

if [ "${success}" == "true" ]; then
    log "Scan completed successfully, no CVEs found!"
    exit 0
fi

log ""
log "# ===================================================== #"
log "#                      Scan failed                      #"
log "# ===================================================== #"

log ""
log "Failed to scan:"
cat "${failed_to_scan_packages}" | awk '{printf "  %s\n", $0}' >&2

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
