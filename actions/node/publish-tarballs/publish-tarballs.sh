#!/usr/bin/env bash
#
# publish-tarballs.sh — second half of the split npm publish. Uploads what
# pack-unpublished.sh produced, in manifest order. Run it on a GitHub-hosted
# runner in a job with `id-token: write`: npm trusted publishing (OIDC) does
# not accept self-hosted runners.
#
# Usage: publish-tarballs.sh <dir>
#
# <dir> holds the tarballs and manifest.jsonl; the manifest format is defined
# in actions/node/pack-unpublished/pack-unpublished.sh. Per entry this runs
#   npm publish <dir>/<file> --ignore-scripts --registry <registry>
#               [--tag <tag>] [--access public|<access>]
# Lifecycle scripts are skipped: they already ran next to the build.
# Versions already in their registry are skipped, so a failed run can be
# re-run.
#
# Auth, by registry host. Every registry in the manifest is checked before the
# first upload; a non-https registry or a host without credentials fails the
# run.
#   registry.npmjs.org   OIDC trusted publishing. NPMJS_FALLBACK_TOKEN, when
#                        set, is configured too: npm tries OIDC first and uses
#                        the token only if the exchange fails.
#   npm.pkg.github.com   NPM_AUTH_TOKEN (the job's GITHUB_TOKEN). Never sent to
#                        any other host.
#
# Environment:
#   ACCESS_PUBLIC          'true' adds `--access public` to every upload, as
#                          `pnpm -r publish --access public` did. Otherwise the
#                          manifest's access, if any.
#   NPM_AUTH_TOKEN         Token for npm.pkg.github.com.
#   NPMJS_FALLBACK_TOKEN   Optional legacy token for registry.npmjs.org.
#   NPM_CONFIG_USERCONFIG  Where to write the npm config used for the uploads.
#                          Default: a new temp file. Nothing else is read.
#
# Exit codes: 0 success (also when there is nothing to publish); 1 missing
# credentials or a failed upload; 2 usage error.

set -o nounset
set -o errexit
set -o pipefail

if [ $# -ne 1 ]; then
    echo "usage: $0 <dir>" >&2
    exit 2
fi

TARBALL_DIR="$1"
MANIFEST="${TARBALL_DIR}/manifest.jsonl"

if [ ! -s "${MANIFEST}" ]; then
    echo "Nothing to publish."
    exit 0
fi

registry_host() {
    sed -E 's#^https?://##; s#/.*$##' <<<"$1"
}

# Own userconfig: nothing inherited from the runner or the repo. Tokens stay
# env references; npm expands them when it reads the file.
export NPM_CONFIG_USERCONFIG="${NPM_CONFIG_USERCONFIG:-$(mktemp)}"
: > "${NPM_CONFIG_USERCONFIG}"

while read -r registry; do
    # npm attaches a token by host whatever the scheme, so plain http would
    # send it in clear text.
    if [[ "${registry}" != https://* ]]; then
        echo "::error::${registry}: only https registries are supported" >&2
        exit 1
    fi
    host="$(registry_host "${registry}")"
    case "${host}" in
        registry.npmjs.org)
            if [ -n "${NPMJS_FALLBACK_TOKEN:-}" ]; then
                echo "//${host}/:_authToken=\${NPMJS_FALLBACK_TOKEN}" >> "${NPM_CONFIG_USERCONFIG}"
            fi
            ;;
        npm.pkg.github.com)
            if [ -z "${NPM_AUTH_TOKEN:-}" ]; then
                echo "::error::${registry}: NPM_AUTH_TOKEN is empty" >&2
                exit 1
            fi
            echo "//${host}/:_authToken=\${NPM_AUTH_TOKEN}" >> "${NPM_CONFIG_USERCONFIG}"
            ;;
        *)
            echo "::error::${registry}: no credentials for this registry (supported: registry.npmjs.org, npm.pkg.github.com)" >&2
            exit 1
            ;;
    esac
done < <(jq -r '.registry' "${MANIFEST}" | sort -u)

while read -r entry; do
    name="$(jq -r '.name' <<<"${entry}")"
    version="$(jq -r '.version' <<<"${entry}")"
    file="$(jq -r '.file' <<<"${entry}")"
    registry="$(jq -r '.registry' <<<"${entry}")"
    tag="$(jq -r '.tag' <<<"${entry}")"
    access="$(jq -r '.access' <<<"${entry}")"

    if [ -n "$(npm view "${name}@${version}" version --registry "${registry}" 2>/dev/null || true)" ]; then
        echo "${name}@${version}: already in ${registry}, skipping"
        continue
    fi

    args=(publish "${TARBALL_DIR}/${file}" --ignore-scripts --registry "${registry}")
    if [ -n "${tag}" ]; then
        args+=(--tag "${tag}")
    fi
    if [ "${ACCESS_PUBLIC:-false}" = "true" ]; then
        args+=(--access public)
    elif [ -n "${access}" ]; then
        args+=(--access "${access}")
    fi

    echo "::group::${name}@${version} -> ${registry}"
    npm "${args[@]}"
    echo "::endgroup::"
done < "${MANIFEST}"
