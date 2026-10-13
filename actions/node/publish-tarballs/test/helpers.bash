# Shared helpers for the publish-tarballs bats suite. npm is replaced by
# bin/npm; see that file for how it answers.

TEST_DIR="${BATS_TEST_DIRNAME}"
SCRIPT_UNDER_TEST="${TEST_DIR}/../publish-tarballs.sh"

setup_stub() {
    export PATH="${TEST_DIR}/bin:${PATH}"
    export NPM_STUB_LOG="${BATS_TEST_TMPDIR}/npm.log"
    export NPM_CONFIG_USERCONFIG="${BATS_TEST_TMPDIR}/publish.npmrc"
    : > "${NPM_STUB_LOG}"
    unset NPM_STUB_PUBLISHED NPM_STUB_PUBLISH_FAILING ACCESS_PUBLIC NPM_AUTH_TOKEN NPMJS_FALLBACK_TOKEN
}

# run_publish <fixture dir name> — copies fixtures/<name>/manifest.jsonl and
# creates placeholder tarballs for it (*.tgz is gitignored; the stub never
# reads them).
run_publish() {
    local dir="${BATS_TEST_TMPDIR}/tarballs"
    mkdir -p "${dir}"
    cp "${TEST_DIR}/fixtures/$1/manifest.jsonl" "${dir}/"
    jq -r '.file' "${dir}/manifest.jsonl" | while read -r f; do echo placeholder > "${dir}/${f}"; done
    run "${SCRIPT_UNDER_TEST}" "${dir}"
}

# The npm publish argument lines, with the tarball path reduced to the basename.
publish_calls() {
    sed -E "s#${BATS_TEST_TMPDIR}/tarballs/##" "${NPM_STUB_LOG}"
}
