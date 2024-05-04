#!/usr/bin/env bash

#
# This is MiLaboratories Shell Functions library
#
# Main concepts:
#  * all functions are prefixed with 'mish_'
#

# Convert path to absolute without touching any file.
# This is pure bash implementation of 'realpath' that
# does NOT NEED any part of path to exist on filesystem.
#
# It resolves all intermediate relative parts of path by
# dropping previous part for each '/../' and cutting all '/./'.
mish_abspath(){
  local _path

  if [[ "${1}" =~ ^/ ]]; then
    _path="${1}"
  elif [[ "${1}" =~ ^~ ]]; then
    _path="${HOME}/${1}"
  else
    _path="${PWD}/${1}"
  fi

  local _path_parts
  local _result
  local _result_len

  echo "${_path}" |
    (
      IFS=/
      read -ra _path_parts
      declare -a _result

      for i in "${_path_parts[@]}"; do
        case "$i" in
        ''|.) continue ;;
        ..)
          _result_len="${#_result[@]}"
          if [ "${_result_len}" -eq 0 ];then
            continue
          else
            unset "_result[${_result_len}-1]"
          fi
          ;;
        *)
          _result+=("${i}")
          ;;
        esac
      done
      echo /"${_result[*]}"
    )
}

# Trim spaces from the beginning and the end of the string
mish_trim() {
  local _text="${1}"
  xargs <<<"${_text}"
}

# Sanitize path by
# Removing any '..' patterns
# Removing any command injection patterns
# Only allow alphanumeric, dash, underscore, and directory separators
mish_sanitized() {
   local _path="${1}"

   local _sanitized_path=$(echo "${_path}" | sed 's|\.\./||g')
   _sanitized_path=$(echo "${_sanitized_path}" | sed 's|[;&|]||g')
   _sanitized_path=$(echo "${_sanitized_path}" | sed 's|[^a-zA-Z0-9/_\\-]||g')

   echo "${_sanitized_path}"
}

mish_urlencode() {
  local _text="${1}"

  curl \
      --get \
      --silent \
      --output /dev/null \
      --write-out '%{url_effective}' \
      --data-urlencode "to_encode=${_text}" \
      "localhost" |
    awk -F'=' '{print $2}' # drop 'http://localhost/?to_encode=' prefix
}

set -o nounset
set -o errexit

: "${MISH_DEBUG:=false}"
if [ "${MISH_DEBUG}" = "true" ]; then
  set -v
fi
