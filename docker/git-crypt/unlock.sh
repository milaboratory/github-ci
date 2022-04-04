#!/usr/bin/env sh

set -o nounset
set -o errexit

gpg_key_file="${HOME}/git-crypt-key.asc"

function cleanup() {
    rm "${gpg_key_file}"
}

function create_keyfile() {
  echo "${GIT_CRYPT_GPG_KEY}" |
    base64 -d > "${gpg_key_file}"

  # schedule keyfile removal on script end by any reason
  trap cleanup exit
}

function load_gpg_key() {
  gpg --batch --import "${gpg_key_file}"

  if [ -z "${GIT_CRYPT_KEY_GRIP:-}" ]; then
    GIT_CRYPT_KEY_GRIP=$(
      gpg --with-colons --with-keygrip --show-keys "${gpg_key_file}" |
        awk -F':' ' $1 == "grp" { grip=$10 }
                    END { print grip } '
    )
  fi

  gpgconf --kill gpg-agent

  gpg-agent --daemon --allow-preset-passphrase --max-cache-ttl 3153600000

  if [ -z "${GIT_CRYPT_KEY_PASSWORD}" ]; then
    echo "Provided passphrase for GPG key is empty."
    return 0
  fi

  /usr/libexec/gpg-preset-passphrase \
    --preset \
    --passphrase "${GIT_CRYPT_KEY_PASSWORD}" \
    "${GIT_CRYPT_KEY_GRIP}"
}

create_keyfile
load_gpg_key
git-crypt unlock
