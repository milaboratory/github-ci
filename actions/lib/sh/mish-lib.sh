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

  echo "${_path}" |
    (
      IFS=/
      read -ra _path_parts
      declare -a _result

      for i in "${_path_parts[@]}"; do
        case "$i" in
        ''|.) continue ;;
        ..)
          if [ "${#_result[@]}" -eq 0 ];then
            continue
          else
            unset "_result[-1]"
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

set -o nounset
set -o errexit

: "${MISH_DEBUG:=false}"
if [ "${MISH_DEBUG}" = "true" ]; then
  set -v
fi
