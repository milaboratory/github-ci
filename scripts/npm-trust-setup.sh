#!/usr/bin/env bash
#
# npm-trust-setup.sh — configure npm trusted publishers for repos that publish
# through github-ci's node workflows.
#
#   discover [org ...]   Write a TSV (package, repo, workflow file) to stdout for
#                        every non-private package.json in every repo whose
#                        .github/workflows/build.yaml calls a github-ci node-*
#                        workflow. Default orgs: platforma-open milaboratory.
#                        Review and trim the file; it is the input for `apply`.
#
#   apply <file.tsv>     For each line, create a GitHub Actions trusted publisher
#                        allowing `npm publish`. Skips packages not on the
#                        registry yet and packages already configured for the
#                        same repo + file. Reports, never revokes, a package
#                        configured for something else.
#                        DRY_RUN=1 prints the commands instead.
#
# Run `apply` from your own terminal, logged in with `npm login`: the registry
# requires interactive 2FA for these calls (bypass-2FA tokens are refused).
# Enable "skip 2FA for 5 minutes" on npmjs.com after the first prompt; npm
# documents ~80 packages per window with the 2 s pause used here.
#
# A new trusted publisher expires unless a publish goes through it within
# 2 days. Apply in batches you can release within that window.
#
# Needs: gh (authenticated), jq, npm >= 11.15.0 (for `npm trust`).

set -o nounset
set -o errexit
set -o pipefail

WORKFLOW_FILE="build.yaml"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

discover() {
    local orgs=("$@")
    [ ${#orgs[@]} -gt 0 ] || orgs=(platforma-open milaboratory)

    for org in "${orgs[@]}"; do
        gh repo list "${org}" --no-archived --limit 2000 --json nameWithOwner -q '.[].nameWithOwner' |
            while read -r repo; do
                local wf
                wf="$(gh api "repos/${repo}/contents/.github/workflows/${WORKFLOW_FILE}" \
                    -H 'Accept: application/vnd.github.raw' 2>/dev/null)" || continue
                grep -q 'milaboratory/github-ci/.github/workflows/node-' <<<"${wf}" || continue

                local paths
                paths="$(gh api "repos/${repo}/git/trees/HEAD?recursive=1" -q '.tree[].path')"
                # `pnpm -r publish` never publishes the workspace root.
                local skip_root=""
                grep -qx 'pnpm-workspace.yaml' <<<"${paths}" && skip_root="package.json"

                grep -E '(^|/)package\.json$' <<<"${paths}" | grep -v 'node_modules/' |
                    grep -vx "${skip_root:-^$}" |
                    while read -r pj; do
                        gh api "repos/${repo}/contents/${pj}" -H 'Accept: application/vnd.github.raw' 2>/dev/null |
                            jq -r --arg repo "${repo}" --arg file "${WORKFLOW_FILE}" \
                                'select(.private != true and .name != null) | [.name, $repo, $file] | @tsv'
                    done
            done
    done | awk '!seen[$0]++'
}

# npm asks for 2FA (the browser approval) only when stdin and stdout are both
# a terminal (npm lib/utils/auth.js); a call whose output is captured fails
# with EOTP instead. So on EOTP, run the same call on the terminal once: npm
# prints the approval link, and ticking "skip 2FA for 5 minutes" there lets
# the following captured calls through. Not in a dry run, and only when a
# terminal is attached.
authenticate() {
    local pkg="$1"
    [ "${DRY_RUN:-0}" = "1" ] && return 1
    { : </dev/tty >/dev/tty; } 2>/dev/null || return 1
    echo "npm needs 2FA: approve in the browser and tick \"skip 2FA for 5 minutes\"." >/dev/tty
    npm trust list "${pkg}" </dev/tty >/dev/tty 2>&1
}

# Prints the package's trust configurations as a JSON array ([] when there
# are none). Fails, after printing why, when they cannot be listed or the
# output is not the JSON `npm trust list --json` documents: one object per
# configuration with id, type, repository, file and permissions
# ("createPackage" = npm publish, "createStagedPackage" = npm stage).
list_trust() {
    local pkg="$1" out err rc=0
    err="$(mktemp)"
    out="$(npm trust list "${pkg}" --json 2>"${err}")" || rc=$?
    if [ "${rc}" -ne 0 ] && grep -q 'EOTP' "${err}" && authenticate "${pkg}"; then
        # Approved in the browser; the 2FA skip window covers the retry.
        rc=0
        out="$(npm trust list "${pkg}" --json 2>"${err}")" || rc=$?
    fi
    if [ "${rc}" -ne 0 ]; then
        cat "${err}" >&2
        rm -f "${err}"
        if [ "${DRY_RUN:-0}" = "1" ]; then
            echo "WARN     ${pkg}: cannot list trust configurations (not logged in?), assuming none" >&2
            echo '[]'
            return 0
        fi
        echo "ERROR    ${pkg}: cannot list trust configurations; stopping" >&2
        return 1
    fi
    rm -f "${err}"
    if [ -z "${out//[[:space:]]/}" ]; then
        echo '[]'
        return 0
    fi
    if ! jq -s -c -e 'all(.[]; type == "object")' <<<"${out}" >/dev/null 2>&1; then
        echo "${out}" >&2
        echo "ERROR    ${pkg}: unexpected 'npm trust list --json' output; stopping" >&2
        return 1
    fi
    jq -s -c '.' <<<"${out}"
}

apply() {
    local mapping="$1"
    local created=0 skipped=0 conflicts=0

    local npm_version
    npm_version="$(npm --version)"
    if [ "$(printf '%s\n11.15.0\n' "${npm_version}" | sort -V | head -n 1)" != "11.15.0" ]; then
        echo "npm ${npm_version} is too old for 'npm trust'; need 11.15.0 or later" >&2
        exit 1
    fi

    # The mapping comes in on fd 3 so stdin stays the terminal: npm reads 2FA
    # codes from it.
    while IFS=$'\t' read -r -u 3 pkg repo file; do
        [ -n "${pkg}" ] && [[ "${pkg}" != \#* ]] || continue

        if ! npm view "${pkg}" name >/dev/null 2>&1; then
            echo "SKIP     ${pkg}: not on the registry yet (publish once, then configure)"
            skipped=$((skipped + 1))
            continue
        fi

        local existing
        existing="$(list_trust "${pkg}")" || exit 1

        if jq -e --arg r "${repo}" --arg f "${file}" \
            'any(.[]; .type == "github" and .repository == $r and .file == $f
                      and ((.permissions // []) | index("createPackage")))' <<<"${existing}" >/dev/null; then
            echo "OK       ${pkg}: already trusts ${repo} ${file} with npm publish"
            skipped=$((skipped + 1))
            continue
        fi
        if [ "$(jq 'length' <<<"${existing}")" -gt 0 ]; then
            # Includes a matching repo/file without direct publish (staged
            # only): CI's `npm publish` would be rejected. Fix by hand.
            echo "CONFLICT ${pkg}: existing configuration does not allow npm publish from ${repo} ${file}: ${existing}"
            conflicts=$((conflicts + 1))
            continue
        fi

        local cmd=(npm trust github "${pkg}" --repo "${repo}" --file "${file}" --allow-publish --yes)
        if [ "${DRY_RUN:-0}" = "1" ]; then
            echo "DRY-RUN  ${cmd[*]}"
        else
            "${cmd[@]}"
            echo "CREATED  ${pkg}: ${repo} ${file}"
            sleep "${SLEEP_SECONDS}"
        fi
        created=$((created + 1))
    done 3< "${mapping}"

    echo "created=${created} skipped=${skipped} conflicts=${conflicts}"
}

case "${1:-}" in
    discover) shift; discover "$@" ;;
    apply) [ $# -eq 2 ] || { echo "usage: $0 apply <file.tsv>" >&2; exit 2; }; apply "$2" ;;
    *) sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
