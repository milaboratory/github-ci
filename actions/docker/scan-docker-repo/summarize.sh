#!/usr/bin/env bash

set -o nounset
set -o errexit

report_file="${1}"

echo ""
echo "CVEs found:"
cat "${report_file}" |
    jq -r '
        select(.Results[].Vulnerabilities) |
        [
            .ArtifactName,
            (
                [
                    .Results[] |
                    select(.Vulnerabilities) |
                    .Vulnerabilities[] |
                    .Severity
                ] |
                    group_by(.) |
                    map({key: .[0], value: length}) |
                    map("\(.key): \(.value)") |
                    join(", ")
            )
        ] |
            .[0] + " (" + .[1] + ")"'

echo ""
echo "Misconfigurations found: "
cat "${report_file}" |
    jq -r '
        select(.Results | any(.Misconfigurations)) |
        [
            .ArtifactName,
            (
                [
                    .Results[] |
                    select(.Misconfigurations) |
                    .Misconfigurations[] |
                    .Severity
                ] |
                    group_by(.) |
                    map({key: .[0], value: length}) |
                    map("\(.key): \(.value)") |
                    join(", ")
            )
        ] |
            .[0] + " (" + .[1] + ")"'
