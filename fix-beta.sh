#!/bin/bash
#
# fix-beta.sh — re-sync v4-beta with v4 after they diverge.
#
# Use when:
#   - Someone committed directly to v4 (bypassing the v4-beta → merge-beta.sh
#     cycle) and you want v4-beta to incorporate those changes.
#   - Post-promotion: v4 has the rename-sed commit from merge-beta.sh that
#     v4-beta does not have; run this script to bring v4-beta back in sync.
#
# What it does:
#   1. Refuses if the working tree is dirty.
#   2. Re-execs itself from a tmp copy so the script survives the checkout.
#   3. Switches to v4-beta, pulls latest.
#   4. Merges v4 in with --strategy-option theirs (v4 content wins on conflict).
#   5. Sed-flips @v4 -> @v4-beta across action.yaml + .github/workflows/*.yaml
#      (mirrors merge-beta.sh's file scope, opposite direction).
#   6. Commits the flip on top of the merge commit and pushes.
#
# Inverse of merge-beta.sh.
#
# Sed safety: @v4 is a prefix of @v4-beta. Naive `s|@v4|@v4-beta|g` would
# produce @v4-beta-beta. Two scoped patterns are used instead: match @v4 at
# end-of-line, and @v4 followed by whitespace.

set -o nounset
set -o errexit
set -o pipefail

: ${TARGET_BRANCH:="v4-beta"}    # branch being fixed
: ${SOURCE_BRANCH:="v4"}         # branch being merged in

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
    echo "Copying script to temporary file to not lose original code during checkouts..."
    tmp_script="$(mktemp)"
    cat "${0}" > "${tmp_script}"
    chmod +x "${tmp_script}"
    __REAL_RUN="true" "${tmp_script}"
    exit 0
fi

echo "Updating remote repository info..."
git fetch --prune origin

echo "Switching to '${TARGET_BRANCH}'..."
git checkout "${TARGET_BRANCH}"
git pull --ff-only

echo "Merging 'origin/${SOURCE_BRANCH}' into '${TARGET_BRANCH}' (theirs wins on conflict)..."
git merge \
    --no-edit \
    --message "Merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}" \
    "origin/${SOURCE_BRANCH}" \
    --strategy-option theirs

echo "Flipping @${SOURCE_BRANCH} -> @${TARGET_BRANCH} in action.yaml and workflows..."
{
    find . -type f -name "action.yaml"
    find .github/workflows -type f -name "*.yaml"
} |
    while read -r file; do
        sed "s|@${SOURCE_BRANCH}\$|@${TARGET_BRANCH}|g; s|@${SOURCE_BRANCH}\([[:space:]]\)|@${TARGET_BRANCH}\1|g" "${file}" > "${file}.tmp"
        mv "${file}.tmp" "${file}"
    done

if git diff --quiet; then
    echo "No ref flips needed; merge alone was sufficient."
else
    git add -A
    git commit -m "Re-flip @${SOURCE_BRANCH} -> @${TARGET_BRANCH} after merging ${SOURCE_BRANCH}"
fi

echo "Pushing '${TARGET_BRANCH}'..."
git push origin "${TARGET_BRANCH}"

echo "Done. ${TARGET_BRANCH} is now in sync with ${SOURCE_BRANCH}, with internal refs restored to @${TARGET_BRANCH}."
