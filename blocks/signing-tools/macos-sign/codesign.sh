#!/usr/bin/env bash

set -o errexit
set -o nounset

if [ -z "${BINARIES}" ]; then
    echo "::warning::List of binaries to sign for Mac OS X is empty. Nothing matched the globbing patterns from 'binaries' input." >&2
    exit 0
fi

if [ "${CERT_ID}" != "-" ]; then
    echo "Preparing keychain..."

    function cleanup {
        if [ ! -z "${default_keychain:-}" ]; then
            security default-keychain -s "$default_keychain" && security list-keychains -s "$default_keychain"
        fi
        security delete-keychain buildagent || true
    }
    trap cleanup EXIT

    echo "${CERT_BASE64}" | base64 -d >"${GITHUB_WORKSPACE}/${CERT_FILE}"

    security create-keychain -p "${CERT_PWD}" buildagent
    security unlock-keychain -p "${CERT_PWD}" buildagent
    default_keychain=$(security default-keychain | xargs)
    security list-keychains -s buildagent && security default-keychain -s buildagent
    security import ${CERT_FILE} -k buildagent -P "${CERT_PWD}" -T /usr/bin/codesign >/dev/null
    security set-key-partition-list -S apple-tool:,apple: -s -k "${CERT_PWD}" buildagent >/dev/null
fi

codesign_args=(
    --keychain buildagent
    --sign "${CERT_ID}"
    --timestamp
    --options runtime
)

if [ -n "${ENTITLEMENTS}" ]; then
    echo "Generating .plist file with custom entitlements..."

    cat >entitlements.plist <<EndOfEnts
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
        <dict>
            ${ENTITLEMENTS}
        </dict>
    </plist>
EndOfEnts

    codesign_args+=(
        --entitlements "entitlements.plist"
    )
fi

while IFS= read -r BINARY_PATH; do
    if ! file "${BINARY_PATH}" | grep -q 'Mach-O'; then
        echo "File '${BINARY_PATH}' matched the sign pattern but appears to be not a binary file (no 'Mach-O' in file report)"
        continue
    fi

    echo "Signing ${BINARY_PATH}"

    # In case target is already signed, remove existing sig as it causes failure
    (
        set -x
        codesign --remove-signature ${BINARY_PATH} || true
        codesign "${codesign_args[@]}" "${BINARY_PATH}"
        codesign --verify --verbose --display "${BINARY_PATH}"
    )
    if [ -n "${ENTITLEMENTS}" ]; then
        codesign --display --entitlements - "${BINARY_PATH}"
    fi

    echo "Signed '${BINARY_PATH}' with '${CERT_ID}'"
done <<<"${BINARIES}"
