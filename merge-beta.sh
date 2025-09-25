#!/bin/bash

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

git fetch --prune origin
if git branch | grep -qE " ${MERGE_BRANCH}( |$)"; then
    # Merge branch exists in local repository
    git checkout "${MERGE_BRANCH}"
    git merge --no-edit "${TARGET_BRANCH}"

else if git branch --remotes | grep -qE " origin/${MERGE_BRANCH}( |$)"; then
    # Merge branch exists in remote repository
    git checkout "origin/${MERGE_BRANCH}"
    git checkout -b "${MERGE_BRANCH}"
    git merge --no-edit "${TARGET_BRANCH}"

else
    git checkout "${TARGET_BRANCH}"
    git checkout -b "${MERGE_BRANCH}"
fi

if git branch | grep -qE " ${SOURCE_BRANCH}( |$)"; then
    # Source branch exists in local repository
else 
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
    xargs -L 1 \
    sed -i "s/${SOURCE_BRANCH}/${TARGET_BRANCH}/g"

git add .
git commit --amend --no-edit
git push origin "${MERGE_BRANCH}"

gh pr create \
    --title "Merge ${TARGET_BRANCH}-beta into ${TARGET_BRANCH}" \
    --base "${TARGET_BRANCH}" \
    --head "${MERGE_BRANCH}"
