#!/usr/bin/env bats
#
# `apply` of ../npm-trust-setup.sh against a stubbed npm (bin/npm).
# `discover` talks to the GitHub API and is not covered here.

setup() {
    export PATH="${BATS_TEST_DIRNAME}/bin:${PATH}"
    export NPM_STUB_LOG="${BATS_TEST_TMPDIR}/npm.log"
    export SLEEP_SECONDS=0
    : > "${NPM_STUB_LOG}"
    unset DRY_RUN NPM_STUB_VERSION NPM_STUB_LIST_FAILING
    export NPM_STUB_EXISTING="@fixture/new @fixture/ready @fixture/staged-only @fixture/elsewhere @fixture/two @fixture/garbled"
    MAPPING="${BATS_TEST_TMPDIR}/mapping.tsv"
}

# mapping_for <pkg>... — one line per package, repo fixture-org/<pkg basename>.
mapping_for() {
    : > "${MAPPING}"
    local pkg
    for pkg in "$@"; do
        printf '%s\tfixture-org/%s\tbuild.yaml\n' "${pkg}" "${pkg#*/}" >> "${MAPPING}"
    done
}

# stdin is /dev/null, standing in for the terminal npm reads 2FA codes from;
# bin/npm drains it on `trust github`.
run_apply() {
    run bash -c '"$1" apply "$2" < /dev/null' _ "${BATS_TEST_DIRNAME}/../npm-trust-setup.sh" "${MAPPING}"
}

@test "creates a configuration allowing npm publish when there is none" {
    mapping_for @fixture/new
    run_apply
    [ "${status}" -eq 0 ]
    grep -qx 'trust github @fixture/new --repo fixture-org/new --file build.yaml --allow-publish --yes' "${NPM_STUB_LOG}"
    [[ "${output}" == *'created=1 skipped=0 conflicts=0'* ]]
}

@test "leaves a matching configuration that allows npm publish" {
    mapping_for @fixture/ready @fixture/two
    run_apply
    [ "${status}" -eq 0 ]
    [ ! -s "${NPM_STUB_LOG}" ]
    [[ "${output}" == *'created=0 skipped=2 conflicts=0'* ]]
}

@test "reports a matching configuration that allows only staged publish" {
    mapping_for @fixture/staged-only
    run_apply
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'CONFLICT @fixture/staged-only'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "reports a configuration for another repository" {
    mapping_for @fixture/elsewhere
    run_apply
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'CONFLICT @fixture/elsewhere'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "skips packages that are not on the registry" {
    mapping_for @fixture/unpublished
    run_apply
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'SKIP     @fixture/unpublished: not on the registry yet'* ]]
}

@test "stops when the configurations cannot be listed" {
    export NPM_STUB_LIST_FAILING="@fixture/new"
    mapping_for @fixture/new @fixture/ready
    run_apply
    [ "${status}" -eq 1 ]
    [[ "${output}" == *'ERROR    @fixture/new: cannot list trust configurations; stopping'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "stops on output that is not trust-list JSON" {
    mapping_for @fixture/garbled
    run_apply
    [ "${status}" -eq 1 ]
    [[ "${output}" == *"unexpected 'npm trust list --json' output"* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "dry run prints the command instead of running it" {
    export DRY_RUN=1
    mapping_for @fixture/new
    run_apply
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'DRY-RUN  npm trust github @fixture/new --repo fixture-org/new --file build.yaml --allow-publish --yes'* ]]
    [ ! -s "${NPM_STUB_LOG}" ]
}

@test "keeps stdin for npm, reading the mapping from its own descriptor" {
    # bin/npm drains stdin on `trust github`, as the 2FA prompt does. Were the
    # mapping on stdin, the first creation would swallow the remaining lines.
    mapping_for @fixture/new @fixture/ready
    run_apply
    [ "${status}" -eq 0 ]
    [[ "${output}" == *'created=1 skipped=1 conflicts=0'* ]]
}

@test "refuses npm older than 11.15.0" {
    export NPM_STUB_VERSION=11.10.0
    mapping_for @fixture/new
    run_apply
    [ "${status}" -eq 1 ]
    [[ "${output}" == *'npm 11.10.0 is too old'* ]]
}
