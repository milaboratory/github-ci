# Shared helpers for the pack-unpublished bats suite.
#
# Each test packs a fresh copy of fixtures/workspace. `npm view` is answered
# by bin/npm (see that file); pnpm and every other npm command are real.

TEST_DIR="${BATS_TEST_DIRNAME}"
SCRIPT_UNDER_TEST="${TEST_DIR}/../pack-unpublished.sh"

setup_workspace() {
    WS="${BATS_TEST_TMPDIR}/ws"
    cp -R "${TEST_DIR}/fixtures/workspace" "${WS}"
    # pnpm 9 resolves `workspace:` at pack time only after an install, as CI
    # does before packing. No external dependencies, so this stays offline.
    (cd "${WS}" && pnpm install --silent) >&2

    REAL_NPM="$(command -v npm)"
    export REAL_NPM
    export PATH="${TEST_DIR}/bin:${PATH}"

    export OUT_DIR="${BATS_TEST_TMPDIR}/out"
    export NPMRC_DIR="${WS}"
    export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/github-output"
    export NPM_STUB_LOG="${BATS_TEST_TMPDIR}/npm.log"
    : > "${GITHUB_OUTPUT}"
    unset NPM_STUB_PUBLISHED NPM_STUB_EXISTING NPM_STUB_FAILING
}

run_pack() {
    run bash -c 'cd "$1" && "$2"' _ "${WS}" "${SCRIPT_UNDER_TEST}"
}

# Manifest names, one per line, in file order.
manifest_names() {
    jq -r '.name' "${OUT_DIR}/manifest.jsonl"
}

# One manifest entry as compact JSON.
manifest_entry() {
    jq -c --arg n "$1" 'select(.name == $n)' "${OUT_DIR}/manifest.jsonl"
}

# A file from inside a packed tarball.
tarball_file() {
    local name="$1" path="$2" file
    file="$(jq -r --arg n "${name}" 'select(.name == $n) | .file' "${OUT_DIR}/manifest.jsonl")"
    tar -xOzf "${OUT_DIR}/${file}" "package/${path}"
}
