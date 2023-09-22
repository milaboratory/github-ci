#!/usr/bin/env bash

ROCKSDB_STATIC_LIB_ARCHIVE="rocksdb-static-lib-${ROCKSDB_VERSION}-${GH_RUNNER_OS}-${GH_RUNNER_ARCH}.tar.gz"
ROCKSDB_SHARED_LIB_ARCHIVE="rocksdb-shared-lib-${ROCKSDB_VERSION}-${GH_RUNNER_OS}-${GH_RUNNER_ARCH}.tar.gz"

ROCKSDB_LIB_PATH="${GITHUB_WORKSPACE}/rocksdb"

download_url="${CDN_URL}/rocksdb/${ROCKSDB_VERSION}/${ROCKSDB_STATIC_LIB_ARCHIVE}"
echo "Downloading static libs ${GH_RUNNER_OS}-${GH_RUNNER_ARCH}"
echo "  ( ${download_url} )"
curl -LO --no-progress-meter "${download_url}"

download_url="${CDN_URL}/rocksdb/${ROCKSDB_VERSION}/${ROCKSDB_SHARED_LIB_ARCHIVE}"
echo "Downloading shared libs ${GH_RUNNER_OS}-${GH_RUNNER_ARCH}"
echo "  ( ${download_url} )"
curl -LO --no-progress-meter "${download_url}"

mkdir -p "${ROCKSDB_LIB_PATH}"
echo "Unzip shared libs"
tar -zxf "${ROCKSDB_SHARED_LIB_ARCHIVE}" -C "${ROCKSDB_LIB_PATH}"
echo "Unzip static libs"
if [ "${GH_RUNNER_OS}" == "macos" ];then
  TAR_BIN=$(which gtar)
else
  TAR_BIN=$(which tar)
fi
"${TAR_BIN}" -zx \
  --file "${ROCKSDB_STATIC_LIB_ARCHIVE}" \
  --wildcards \
  --wildcards-match-slash \
  --no-anchored \
  --cd "${ROCKSDB_LIB_PATH}/" \
  './lib/*.a'
#  --strip-components=2 \

ghwa_set_env PKG_CONFIG_PATH "${ROCKSDB_LIB_PATH}/lib/pkgconfig"

# additional steps for each os
if [ "${GH_RUNNER_OS}" == "linux" ];then
  # Put shared rocksdb libs near the pl executable on linux
  mkdir -p "${BUILD_PATH}/libs"
  tar -zxf "${ROCKSDB_SHARED_LIB_ARCHIVE}" \
    --strip-components=2 --wildcards --no-anchored -C "${BUILD_PATH}/libs" '*.so*'
  ghwa_set_env LD_LIBRARY_PATH "${ROCKSDB_LIB_PATH}/lib"
elif [ "${GH_RUNNER_OS}" == "macos" ];then
  ghwa_set_env DYLIBBUNDLER_SEARCH_LIB_PATH "${ROCKSDB_LIB_PATH}/lib"
else
  exit 0
fi
