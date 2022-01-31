#!/usr/bin/env bash

# This is GitHub Workflow Command for Actions library with bash functions
# See https://docs.github.com/en/actions/learn-github-actions/workflow-commands-for-github-actions
#
# Main concepts:
#  * all functions are prefixed with 'ghwa_'
#  * most of commands (all, hopefully) are covered with ghwa_<command_name> functions
#  * for commands not covered by custom function wrappers, use
#      _ghwa_command <command-name> [<value> [<opt1=val1> [<opt2>=<val2> [<optN>=...]]]]

# Joins list of arguments into ${1}-separated line
#
# Usage:
#   _ghwa_join , 1 2 3 4
#   # the line above produces '1,2,3,4' string
#
function _ghwa_join() {
  local _sep="${1}"
  shift 1

  (
    IFS="${_sep}"
    echo "${*}"
  )
}

# Formats command line for github workflow's action
#
# Usage:
#   _ghwa_command notice "Notice text message" "file=filename.txt" "line=123" "col=11"
#
function _ghwa_command() {
  local _act_name="${1}"
  local _act_argument="${2:-}"

  # when _act_argument is omitted 'shift 2' has no effect and does
  # not skip _act_name param at all. That is why we have to call 'shift 1' twice.
  { shift 1; shift 1; } || true

  local _act_options
  _act_options="$(_ghwa_join ',' "${@:-}")"

  if [ -n "${_act_options}" ]; then
    _act_options=" ${_act_options}" # prepend options list with space to not break action line format
  fi

  echo "::${_act_name}${_act_options}::${_act_argument}" >&2
}

# Escape newlines and other symbols that could break commands
function ghwa_escape() {
  local _data="${1}"
  local _escaped
  _escaped="${_data//'%'/'%25'}"
  _escaped="${_escaped//$'\n'/'%0A'}"
  _escaped="${_escaped//$'\r'/'%0D'}"

  printf "%s" "${_escaped}"
}

# GitHub Workflow command 'set-output'
#
# Usage:
#   ghwa_set_output <output_name> <output_value>
#
function ghwa_set_output() {
  local _name="${1}"

  local _value
  _value="$(ghwa_escape "${2}")"

  _ghwa_command "set-output" "${_value}" "name=${_name}"
}

# GitHub Workflow command 'notice'
#
# Usage:
#   ghwa_notice "Some message text" ["file=awesomefile.txt" ["line=123" ["col=12" [...]]]]
#
function ghwa_notice() {
  local _message="${1}"
  shift

  _ghwa_command "notice" "$(ghwa_escape "${_message}")" "${@}"
}

# GitHub Workflow command 'warning'
#
# Usage:
#   ghwa_warning "Some message text" ["file=awesomefile.txt" ["line=123" ["col=12" [...]]]]
#
function ghwa_warning() {
  local _message="${1}"
  shift

  _ghwa_command "warning" "$(ghwa_escape "${_message}")" "${@}"
}

# GitHub Workflow command 'error'
#
# Usage:
#   ghwa_error "Some message text" ["file=awesomefile.txt" ["line=123" ["col=12" [...]]]]
#
function ghwa_error() {
  local _message="${1}"
  shift

  _ghwa_command "error" "$(ghwa_escape "${_message}")" "${@}"
}

# GitHub Workflow command 'debug'
#
# Usage:
#   ghwa_debug "Some message text"
#
function ghwa_debug() {
  local _message="${1}"

  _ghwa_command "debug" "$(ghwa_escape "${_message}")"
}

# GitHub Workflow command 'group' start
#
# Usage:
#   ghwa_group_start "Group title"
#
function ghwa_group() {
  local _title="${1}"

  _ghwa_command "group" "${_title}"
}

# GitHub Workflow command 'group' end
#
# Usage:
#   ghwa_endgroup
#
function ghwa_endgroup() {
    _ghwa_command "endgroup"
}

# GitHub Workflow command 'add-mask'
#
# Usage:
#   ghwa_add_mask "Text to mask"
#
function ghwa_add_mask() {
  local _value="${1}"
  _ghwa_command "add-mask" "${_value}"
}

# Helper for 'stop-commands' workflow command
#
# Usage:
#   token=$(ghwa_uniq_token)
#   ghwa_stop_commands "${_token}"
#   <shell script here>
#   ghwa_resume_commands "${_token}"
#
function ghwa_uniq_token() {
  echo -n "${RANDOM}${RANDOM}${RANDOM}${RANDOM}" | sha256sum | head -c 64
}

# GitHub Workflow command 'stop-commands'
#
# Usage:
#   ghwa_stop_commands "<uniq textual token>"
#
# Use ghwa_uniq_token helper function for token generation
#
function ghwa_stop_commands() {
  local _token="${1}"
  _ghwa_command "stop-commands" "${_token}"
}

# Resume GitHub Workflow Commands interpretation
#
# Usage:
#   ghwa_resume_commands "<uniq textual token>"
#
# Use the same token you gave to 'stop-commands'
#
function ghwa_resume_commands() {
  local _token="${1}"
  _ghwa_command "${_token}" >&2
}


# GitHub Workflow command 'echo'
#
# Usage:
#   ghwa_set_echo "on"
#   ghwa_set_echo "off"
#
function ghwa_set_echo() {
  local _mode="${1:-on}"
  _ghwa_command "echo" "${_mode}"
}

# Set environment variable for all next steps in a job.
# It always uses 'multiline' mode.
# See https://docs.github.com/en/actions/learn-github-actions/workflow-commands-for-github-actions#environment-files
#
# Usage:
#   ghwa_set_env "<var name>" "<var value>"
#   ghwa_set_env "<var name>" "<var value>" "EndOfValue"
#
function ghwa_set_env() {
  local _name="${1}"
  local _value="${2}"
  local _eof_marker="${3:-EndOfValue}"

  {
    echo "${_name}<<${_eof_marker}"
    echo "${_value}"
    echo "${_eof_marker}"
  } >> "${GITHUB_ENV}"
}

# Set environment variable for all next steps in a job.
#
# Usage:
#   ghwa_set_env "<var name>" "<var value>"
#
function ghwa_add_to_path() {
  local _path="${1}"

  echo "${_path}" >> "${GITHUB_PATH}"
}

set -o nounset
set -o errexit

: "${MISH_DEBUG:=false}"
if [ "${MISH_DEBUG}" = "true" ]; then
  set -v
fi
: "${MISH_ECHO_COMMANDS:=off}"
ghwa_set_echo "${MISH_ECHO_COMMANDS}"
