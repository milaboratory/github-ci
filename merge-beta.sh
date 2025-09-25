#!/bin/bash

set -o nounset
set -o errexit

DATE=$(date +%Y-%m-%d)

: ${TARGET_BRANCH:="v4"}
: ${SOURCE_BRANCH:="${TARGET_BRANCH}-beta"}
: ${MERGE_BRANCH:="merge-${DATE}"}

if git status --porcelain | grep -q .; then
    echo ""
    echo "# -------------------------------------------------------------- #"
    echo "# Repository has local changes. Automatic merge is not possible. #"
    echo "# -------------------------------------------------------------- #"
    echo ""
    git status --porcelain
    exit 1
fi

if [ "${__REAL_RUN:-}" != "true" ]; then
    echo "Copying script to temporary file to not loose original code during checkouts..."
    tmp_script="$(mktemp)"
    cat "${0}" > "${tmp_script}"
    chmod +x "${tmp_script}"
    __REAL_RUN="true" "${tmp_script}"
    exit 0
fi

echo "Updating remote repository info..."
git fetch --prune origin
if git branch | grep -qE " ${MERGE_BRANCH}( |$)"; then
    echo "Found local merge branch"
    echo "  switching to '${MERGE_BRANCH}'..."
    # Merge branch exists in local repository
    git checkout "${MERGE_BRANCH}"
    echo "  merging '${TARGET_BRANCH}'..."
    git merge --no-edit "${TARGET_BRANCH}"

elif git branch --remotes | grep -qE " origin/${MERGE_BRANCH}( |$)"; then
    echo "Found merge branch in remote repository"
    echo "  switching to 'origin/${MERGE_BRANCH}'..."
    git checkout "origin/${MERGE_BRANCH}"
    echo "  creating local '${MERGE_BRANCH}' branch..."
    git checkout -b "${MERGE_BRANCH}"
    echo "  merging '${TARGET_BRANCH}'..."
    git merge --no-edit "${TARGET_BRANCH}"

else
    echo "No existing merge branch found"
    echo "  switching to '${TARGET_BRANCH}'..."
    git checkout "${TARGET_BRANCH}"
    git pull || true
    echo "  creating '${MERGE_BRANCH}' branch..."
    git checkout -b "${MERGE_BRANCH}"
fi

if git branch | grep -qE " ${SOURCE_BRANCH}( |$)"; then
    echo "Found source branch in local repository, syncing it with remote..."
    git fetch origin "${SOURCE_BRANCH}:${SOURCE_BRANCH}" || true
else
    echo "No source branch found in local repository, using remote..."
    SOURCE_BRANCH="origin/${SOURCE_BRANCH}"
fi

git merge \
    --message "Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}" \
    "${SOURCE_BRANCH}" \
    --strategy-option theirs

# Replace all v4-beta with v4 in all action.yaml and all workflows
{
    find . -type f -name "action.yaml"
    find .github/workflows -type f -name "*.yaml"
} |
    while read -r file; do
        sed "s/${SOURCE_BRANCH}/${TARGET_BRANCH}/g" "${file}" > "${file}.tmp"
        mv "${file}.tmp" "${file}"
    done

git add .
git commit --amend --no-edit
git push origin "${MERGE_BRANCH}"

gh pr create \
    --title "Merge ${TARGET_BRANCH}-beta into ${TARGET_BRANCH}" \
    --base "${TARGET_BRANCH}" \
    --head "${MERGE_BRANCH}" \
    --body ""
