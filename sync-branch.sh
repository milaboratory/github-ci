#!/bin/bash
#
# sync-branch.sh — bring $TARGET_BRANCH up to date with $SOURCE_BRANCH, then
# point this repo's self-references at $TARGET_BRANCH.
#
# The second half is the reason this is not just `git merge`. A consumer that
# pins `@<branch>` gets whatever that branch's files say, so a branch whose
# self-refs still name another branch runs the OTHER branch's actions — an
# edit made here would appear to do nothing, and a canary would go green for
# the wrong reason.
#
# The defaults sync v4-beta from v4, which is the routine recovery when the two
# diverge:
#   - Someone committed directly to v4, bypassing the v4-beta → promote.sh
#     cycle, and you want v4-beta to incorporate those changes.
#   - Post-promotion: v4 carries the rename-sed commit promote.sh made and
#     v4-beta does not.
#
# Both branches are parameters, so the same script prepares any working branch
# for a canary run:
#
#   TARGET_BRANCH=my-experiment SOURCE_BRANCH=v4 bash sync-branch.sh
#
# leaves my-experiment holding v4's content with every self-ref pointing at
# my-experiment, so a consumer repo can pin @my-experiment and actually
# exercise the change. $TARGET_BRANCH must already exist and track a remote
# branch — step 3 pulls it.
#
# What it does:
#   1. Refuses if the working tree is dirty.
#   2. Re-execs itself from a tmp copy so the script survives the checkout.
#   3. Switches to $TARGET_BRANCH, pulls latest.
#   4. Merges $SOURCE_BRANCH in with --strategy-option theirs (source content
#      wins on conflict).
#   5. Sed-flips @$SOURCE_BRANCH -> @$TARGET_BRANCH across action.yaml +
#      .github/workflows/*.yaml (mirrors promote.sh's file scope, opposite
#      direction).
#   6. Commits the flip on top of the merge commit and pushes.
#
# Inverse of promote.sh.
#
# Sed safety, two concerns:
#   1. Prefix collision. @v4 is a prefix of @v4-beta, so a naive
#      `s|@v4|@v4-beta|g` would produce @v4-beta-beta. We match @v4 only at
#      end-of-line or followed by whitespace.
#   2. Path scope. We must rewrite only milaboratory/github-ci self-refs.
#      Third-party action pins (actions/checkout@v4, aws-actions/...@v4,
#      pnpm/action-setup@v4, etc.) must stay at their upstream tags — those
#      repos do not publish a v4-beta tag, so flipping them produces
#      "Unable to resolve action ...@v4-beta" failures.
# Both patterns therefore anchor the substitution to a leading
# `milaboratory/github-ci...` path.

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

echo "Flipping @${SOURCE_BRANCH} -> @${TARGET_BRANCH} in milaboratory/github-ci self-refs..."
{
    find . -type f -name "action.yaml"
    find .github/workflows -type f -name "*.yaml"
} |
    while read -r file; do
        sed "s|\(milaboratory/github-ci[^[:space:]@]*\)@${SOURCE_BRANCH}\$|\1@${TARGET_BRANCH}|g; s|\(milaboratory/github-ci[^[:space:]@]*\)@${SOURCE_BRANCH}\([[:space:]]\)|\1@${TARGET_BRANCH}\2|g" "${file}" > "${file}.tmp"
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
