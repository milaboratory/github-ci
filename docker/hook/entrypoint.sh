#!/usr/bin/env bash

# Check if script exists and run it.
# Report script absence otherwise.

if ! [ -e "${1}" ]; then
  echo "Script '${1}' does not exist. Hook was skipped." >&2
  exit 0
fi

if ! [ -x "${1}" ]; then
  echo "Script '${1}' is not executable. Hook was skipped." >&2
  exit 0
fi

"${@}" # execute given script with all arguments. Behave like bash CLI
