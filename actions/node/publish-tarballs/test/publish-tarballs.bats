#!/usr/bin/env bats

load helpers.bash

setup() {
    setup_stub
}

@test "publishes in manifest order without lifecycle scripts" {
    run_publish npmjs
    [ "${status}" -eq 0 ]
    [ "$(publish_calls | awk '{print $2}' | tr '\n' ' ')" = "fixture-lib-1.0.0.tgz fixture-app-2.0.0.tgz " ]
    [ "$(grep -c -- '--ignore-scripts --registry https://registry.npmjs.org/' "${NPM_STUB_LOG}")" -eq 2 ]
}

@test "passes the manifest dist-tag and access" {
    run_publish npmjs
    [ "${status}" -eq 0 ]
    publish_calls | grep -qx 'publish fixture-lib-1.0.0.tgz --ignore-scripts --registry https://registry.npmjs.org/ --access restricted'
    publish_calls | grep -qx 'publish fixture-app-2.0.0.tgz --ignore-scripts --registry https://registry.npmjs.org/ --tag next'
}

@test "ACCESS_PUBLIC overrides the manifest access" {
    export ACCESS_PUBLIC=true
    run_publish npmjs
    [ "${status}" -eq 0 ]
    publish_calls | grep -qx 'publish fixture-lib-1.0.0.tgz --ignore-scripts --registry https://registry.npmjs.org/ --access public'
    publish_calls | grep -qx 'publish fixture-app-2.0.0.tgz --ignore-scripts --registry https://registry.npmjs.org/ --tag next --access public'
}

@test "skips versions that are already published" {
    export NPM_STUB_PUBLISHED="@fixture/lib@1.0.0"
    run_publish npmjs
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'@fixture/lib@1.0.0: already in https://registry.npmjs.org/, skipping'* ]]
    [ "$(publish_calls | awk '{print $2}')" = "fixture-app-2.0.0.tgz" ]
}

@test "configures no npmjs token without a fallback, so only OIDC can authenticate" {
    run_publish npmjs
    [ "${status}" -eq 0 ]
    ! grep -q '_authToken' "${NPM_CONFIG_USERCONFIG}"
}

@test "configures the npmjs fallback token as an env reference" {
    export NPMJS_FALLBACK_TOKEN=secret-value
    run_publish npmjs
    [ "${status}" -eq 0 ]
    grep -qxF '//registry.npmjs.org/:_authToken=${NPMJS_FALLBACK_TOKEN}' "${NPM_CONFIG_USERCONFIG}"
    ! grep -q 'secret-value' "${NPM_CONFIG_USERCONFIG}"
}

@test "sends the GitHub token to GitHub Packages and nowhere else" {
    export NPM_AUTH_TOKEN=github-token
    run_publish github
    [ "${status}" -eq 0 ]
    [ "$(grep -c '_authToken' "${NPM_CONFIG_USERCONFIG}")" -eq 1 ]
    grep -qxF '//npm.pkg.github.com/:_authToken=${NPM_AUTH_TOKEN}' "${NPM_CONFIG_USERCONFIG}"
}

@test "fails before uploading when GitHub Packages has no token" {
    run_publish github
    [ "${status}" -eq 1 ]
    [[ "${output}" == *'https://npm.pkg.github.com/: NPM_AUTH_TOKEN is empty'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "fails before uploading on a registry without credentials" {
    export NPM_AUTH_TOKEN=github-token
    run_publish other
    [ "${status}" -eq 1 ]
    [[ "${output}" == *'https://npm.example.test/: no credentials for this registry'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "stops at the first failed upload" {
    export NPM_STUB_PUBLISH_FAILING="fixture-lib-1.0.0.tgz"
    run_publish npmjs
    [ "${status}" -ne 0 ]
    [ "$(publish_calls | awk '{print $2}')" = "fixture-lib-1.0.0.tgz" ]
}

@test "succeeds with nothing to do on an empty manifest" {
    mkdir -p "${BATS_TEST_TMPDIR}/empty"
    : > "${BATS_TEST_TMPDIR}/empty/manifest.jsonl"
    run "${SCRIPT_UNDER_TEST}" "${BATS_TEST_TMPDIR}/empty"
    [ "${status}" -eq 0 ]
    [ "${output}" = "Nothing to publish." ]
}

@test "rejects a call without a directory" {
    run "${SCRIPT_UNDER_TEST}"
    [ "${status}" -eq 2 ]
}

@test "refuses a plain-http registry before sending any token" {
    export NPM_AUTH_TOKEN=github-token
    run_publish http
    [ "${status}" -eq 1 ]
    [[ "${output}" == *'http://npm.pkg.github.com/: only https registries are supported'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
    ! grep -q '_authToken' "${NPM_CONFIG_USERCONFIG}"
}
