#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

script_path="$(cd "$(dirname "${0}")" && dirname "${PWD}")"

# shellcheck source-path=../../lib/sh/ghwa-commands.sh
source "${script_path}/../../lib/sh/ghwa-commands.sh"

function trim_spaces() {
    sed '
      s/^[ \t]*//;
      s/[ \t]*$//
    '
}

function trim_empty_lines() {
    grep --invert-match '^ *$'
}

# Gradle prints headers between '---------------' lines.
# We should ignore them, e.g. when parsing properties
function trim_gradle_headers() {
    awk '
      BEGIN { del=false }

      /^-----------/{ del = !del;
                      next }

      !del { print }'
}

trim_gradle_headers |
  trim_empty_lines |
  while read -r prop_line; do
    prop_name="${prop_line%%:*}"
    prop_value="$(trim_spaces <<<"${prop_line#*:}")"

    ghwa_set_output "${prop_name}" "${prop_value}"
  done
