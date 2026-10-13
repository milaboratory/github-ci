#!/usr/bin/env bash
#
# pack-unpublished.sh — first half of the split npm publish. Does everything
# `pnpm -r publish` does except the registry upload, which publish-tarballs.sh
# performs later on a GitHub-hosted runner (npm trusted publishing rejects
# self-hosted runners).
#
# Usage:
#   pack-unpublished.sh             Pack the workspace in the current directory.
#   pack-unpublished.sh --package   Internal: handle the package in the current
#                                   directory. Invoked per package via pnpm exec.
#
# For every non-private workspace package whose version is not in its registry
# yet, in topological order (`pnpm -r exec` order):
#   1. `pnpm run --if-present prepublishOnly`. pnpm pack does not run it, and
#      blocks rely on it (`block-tools publish`, `pl-pkg prepublish`).
#   2. `pnpm pack` into OUT_DIR. pnpm resolves `workspace:` and `catalog:` here.
#   3. Append the package's line to OUT_DIR/manifest.jsonl.
# A package with a `publish` or `postpublish` script fails the run: under
# `pnpm publish` those run after the upload, which now happens elsewhere.
#
# Environment:
#   OUT_DIR        Output directory, emptied first.
#                  Default: $RUNNER_TEMP/npm-tarballs.
#   NPMRC_DIR      Directory whose .npmrc maps scopes to registries and holds
#                  auth for the "already published?" lookups. npm only reads the
#                  .npmrc of its project root, so lookups run from here.
#                  Default: $GITHUB_WORKSPACE, else the current directory.
#   GITHUB_OUTPUT  When set, receives `dir=` and `count=`.
#
# Output — the contract with publish-tarballs.sh:
#   OUT_DIR/*.tgz
#   OUT_DIR/manifest.jsonl, one JSON object per line, in upload order
#   (dependencies first):
#     {"name": "@scope/pkg", "version": "1.2.3", "file": "scope-pkg-1.2.3.tgz",
#      "registry": "https://registry.npmjs.org/", "tag": "", "access": ""}
#   `tag` and `access` are publishConfig.tag / publishConfig.access, empty when
#   unset. They travel in the manifest because `npm publish <tarball>` ignores
#   publishConfig inside the tarball.
#
# Exit codes: 0 success (also when nothing needs packing); 1 a package cannot
# be published this way or its registry could not be queried.

set -o nounset
set -o errexit
set -o pipefail

# Prints the registry pnpm would publish the current package to:
# publishConfig.registry, then the scope mapping, then the default registry.
resolve_registry() {
    local name="$1" registry
    registry="$(jq -r '.publishConfig.registry // empty' package.json)"
    if [ -z "${registry}" ] && [[ "${name}" == @*/* ]]; then
        registry="$(cd "${NPMRC_DIR}" && npm config get "${name%%/*}:registry")"
        [ "${registry}" = "undefined" ] && registry=""
    fi
    if [ -z "${registry}" ]; then
        registry="$(cd "${NPMRC_DIR}" && npm config get registry)"
    fi
    echo "${registry}"
}

# Exit 0 if name@version is in the registry, 1 if not. Exits the script on any
# lookup failure other than "not found".
is_published() {
    local name="$1" version="$2" registry="$3" out
    # npm view: exit 0 + version on stdout when it exists; exit 0 + empty
    # output when the package exists without that version; E404 when the
    # package does not exist at all.
    if out="$(cd "${NPMRC_DIR}" && npm view "${name}@${version}" version --registry "${registry}" 2>&1)"; then
        [ -n "${out}" ]
        return
    fi
    if grep -q 'E404' <<<"${out}"; then
        return 1
    fi
    echo "${out}" >&2
    echo "::error::${name}@${version}: cannot query ${registry}" >&2
    exit 1
}

pack_package() {
    if [ "$(jq -r '.private // false' package.json)" = "true" ]; then
        return 0
    fi

    local name version registry tarball script
    name="$(jq -r '.name' package.json)"
    version="$(jq -r '.version' package.json)"

    for script in publish postpublish; do
        if jq -e --arg s "${script}" '.scripts[$s] // empty' package.json >/dev/null; then
            echo "::error::${name}: '${script}' script is not supported by the split publish (it would run after the upload, on another runner)" >&2
            exit 1
        fi
    done

    registry="$(resolve_registry "${name}")"
    if is_published "${name}" "${version}" "${registry}"; then
        echo "${name}@${version}: already in ${registry}, skipping"
        return 0
    fi

    echo "::group::${name}@${version} -> ${registry}"
    pnpm run --if-present prepublishOnly
    # pack prints prepack/prepare output first and the tarball path last; tee
    # keeps that output in the log.
    tarball="$(pnpm pack --pack-destination "${OUT_DIR}" | tee /dev/stderr | tail -n 1)"
    echo "::endgroup::"

    if [ ! -f "${tarball}" ]; then
        echo "::error::${name}@${version}: pnpm pack did not report a tarball (got '${tarball}')" >&2
        exit 1
    fi

    jq -nc \
        --arg name "${name}" \
        --arg version "${version}" \
        --arg file "$(basename "${tarball}")" \
        --arg registry "${registry}" \
        --arg tag "$(jq -r '.publishConfig.tag // empty' package.json)" \
        --arg access "$(jq -r '.publishConfig.access // empty' package.json)" \
        '{name: $name, version: $version, file: $file, registry: $registry, tag: $tag, access: $access}' \
        >> "${OUT_DIR}/manifest.jsonl"
}

pack_workspace() {
    export OUT_DIR="${OUT_DIR:-${RUNNER_TEMP:?RUNNER_TEMP or OUT_DIR must be set}/npm-tarballs}"
    export NPMRC_DIR="${NPMRC_DIR:-${GITHUB_WORKSPACE:-$(pwd)}}"

    rm -rf "${OUT_DIR}"
    mkdir -p "${OUT_DIR}"
    : > "${OUT_DIR}/manifest.jsonl"

    local self
    self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
    # exec visits packages in topological order; concurrency 1 keeps the
    # manifest in that order, so dependencies are uploaded first.
    pnpm -r --workspace-concurrency=1 exec "${self}" --package

    local count
    count="$(wc -l < "${OUT_DIR}/manifest.jsonl" | tr -d ' ')"
    echo "Packed ${count} package(s):"
    cat "${OUT_DIR}/manifest.jsonl"

    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "dir=${OUT_DIR}" >> "${GITHUB_OUTPUT}"
        echo "count=${count}" >> "${GITHUB_OUTPUT}"
    fi
}

case "${1:-}" in
    --package) pack_package ;;
    "") pack_workspace ;;
    *) echo "usage: $0 [--package]" >&2; exit 2 ;;
esac
