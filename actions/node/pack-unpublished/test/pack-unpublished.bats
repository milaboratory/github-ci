#!/usr/bin/env bats

load helpers.bash

setup() {
    setup_workspace
    # @fixture/old is published at its current version; everything else is new.
    export NPM_STUB_PUBLISHED="@fixture/old@3.0.0"
}

@test "packs every unpublished non-private package" {
    run_pack
    [ "${status}" -eq 0 ]
    run manifest_names
    [ "$(sort <<<"${output}" | tr '\n' ' ')" = "@fixture/app @fixture/lib unscoped-custom " ]
}

@test "orders dependencies before their dependents" {
    run_pack
    [ "${status}" -eq 0 ]
    names="$(manifest_names | tr '\n' ' ')"
    [[ "${names}" == *"@fixture/lib "*"@fixture/app "* ]]
}

@test "skips private packages and published versions" {
    run_pack
    [ "${status}" -eq 0 ]
    ! manifest_names | grep -qx '@fixture/internal'
    ! manifest_names | grep -qx '@fixture/old'
    [[ "${output}" == *'@fixture/old@3.0.0: already in https://registry.fixture.test/, skipping'* ]]
}

@test "packs a package that exists in the registry without this version" {
    export NPM_STUB_PUBLISHED=""
    export NPM_STUB_EXISTING="@fixture/old"
    run_pack
    [ "${status}" -eq 0 ]
    manifest_names | grep -qx '@fixture/old'
}

@test "resolves the registry from publishConfig, then the scope, then the default" {
    run_pack
    [ "${status}" -eq 0 ]
    [ "$(manifest_entry '@fixture/lib' | jq -r .registry)" = "https://registry.fixture.test/" ]
    [ "$(manifest_entry 'unscoped-custom' | jq -r .registry)" = "https://custom.fixture.test/" ]
    grep -q '@fixture/lib@1.0.0 version --registry https://registry.fixture.test/' "${NPM_STUB_LOG}"
}

@test "carries publishConfig tag and access into the manifest" {
    run_pack
    [ "${status}" -eq 0 ]
    [ "$(manifest_entry '@fixture/app' | jq -c '[.tag, .access]')" = '["next",""]' ]
    [ "$(manifest_entry '@fixture/lib' | jq -c '[.tag, .access]')" = '["","public"]' ]
}

@test "runs prepublishOnly before packing" {
    run_pack
    [ "${status}" -eq 0 ]
    [ "$(tarball_file '@fixture/lib' prepublished.txt)" = "ran" ]
}

@test "resolves workspace: dependencies in the tarball" {
    run_pack
    [ "${status}" -eq 0 ]
    [ "$(tarball_file '@fixture/app' package.json | jq -r '.dependencies["@fixture/lib"]')" = "1.0.0" ]
}

@test "writes dir and count to GITHUB_OUTPUT" {
    run_pack
    [ "${status}" -eq 0 ]
    grep -qx "dir=${OUT_DIR}" "${GITHUB_OUTPUT}"
    grep -qx "count=3" "${GITHUB_OUTPUT}"
}

@test "succeeds with an empty manifest when everything is published" {
    export NPM_STUB_PUBLISHED="@fixture/old@3.0.0 @fixture/lib@1.0.0 @fixture/app@2.0.0 unscoped-custom@1.0.0"
    run_pack
    [ "${status}" -eq 0 ]
    [ ! -s "${OUT_DIR}/manifest.jsonl" ]
    grep -qx "count=0" "${GITHUB_OUTPUT}"
}

@test "empties a non-empty output directory first" {
    mkdir -p "${OUT_DIR}"
    echo stale > "${OUT_DIR}/stale.tgz"
    run_pack
    [ "${status}" -eq 0 ]
    [ ! -e "${OUT_DIR}/stale.tgz" ]
}

@test "fails on a package with a postpublish script" {
    cp -R "${TEST_DIR}/fixtures/extra/hooks" "${WS}/packages/hooks"
    (cd "${WS}" && pnpm install --silent) >&2
    run_pack
    [ "${status}" -ne 0 ]
    [[ "${output}" == *"@fixture/hooks: 'postpublish' script is not supported"* ]]
}

@test "fails when a registry lookup errors with anything but 404" {
    export NPM_STUB_FAILING="@fixture/lib"
    run_pack
    [ "${status}" -ne 0 ]
    [[ "${output}" == *'@fixture/lib@1.0.0: cannot query https://registry.fixture.test/'* ]]
}
