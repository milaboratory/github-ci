#!/usr/bin/env bash

TESTS_STATUS='success'

function _status_failed() {
     TESTS_STATUS='failed'
}

function _check_status() {
  [ "${TESTS_STATUS}" = "success" ]
}

function test_equals() {
  local _test_name="${1}"
  local _expected="${2}"
  local _actual="${3}"

  if [ "${_expected}" != "${_actual}" ]; then
    ghwa_error "${_test_name}: actual result is not equal to expected result
      expected result: '${_expected}'
      actual result: '${_actual}'"

    _status_failed
  fi
}

function test_not_empty() {
  local _test_name="${1}"
  local _actual="${2}"

  if [ -z "${_actual}" ]; then
    ghwa_error "${_test_name}: value should not be empty"
    _status_failed
  fi
}

function fail_test() {
  local _message="${1}"

  ghwa_error "${_message}"
  _status_failed
}
