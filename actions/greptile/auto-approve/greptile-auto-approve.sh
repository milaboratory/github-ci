#!/usr/bin/env bash
# Approves a PR on behalf of github-actions[bot] when the latest Greptile confidence score
# in the PR body is at least MIN_SCORE and the PR, at its current head, touches no protected
# path. The score is trusted even when Greptile reviewed an older commit: Greptile does not
# re-review every push. In every other case it dismisses the approvals the bot gave earlier,
# so a lower score or a push that touches a protected path takes the approval back.
#
# Env:
#   GH_TOKEN         token with pull-requests: write
#   REPO             owner/name
#   PR_NUMBER        pull request number
#   PROTECTED_PATHS  file with one path or bash glob per line; '#' starts a comment. The last
#                    line needs no trailing newline.
#                    A '!' line excludes paths: a path is protected when it matches a
#                    pattern and no '!' pattern. '*' also matches '/'.
#   PROTECTED_PATHS_LABEL  how the approval message names the list (default PROTECTED_PATHS)
#   MIN_SCORE        lowest Greptile confidence score that approves (default 4)
#   DRY_RUN          'true' prints the decision and changes nothing
#
# Every run also posts its decision as a new PR comment. While an open PR touches a protected
# path, the PR body starts with an "AUTOREVIEW: RESTRICTED" banner; the run removes the banner
# when the PR touches no protected path again.
set -euo pipefail

: "${REPO:?}" "${PR_NUMBER:?}" "${PROTECTED_PATHS:?}"
MIN_SCORE="${MIN_SCORE:-4}"
DRY_RUN="${DRY_RUN:-false}"
PROTECTED_PATHS_LABEL="${PROTECTED_PATHS_LABEL:-$PROTECTED_PATHS}"

BOT_LOGIN='github-actions[bot]'
# The edit history names the bot without the [bot] suffix. The score editor is the last editor
# of the PR body other than the bot: a banner edit keeps an untrusted earlier editor visible.
BOT_EDITOR_LOGINS='github-actions github-actions[bot]'
# Edits of the PR body that the run reads to find the last editor other than the bot.
BODY_EDITS_READ=100
# The banner lists at most this many protected paths, so the PR body stays short.
BANNER_PATH_LIMIT=20
BANNER_START='<!-- greptile-auto-approve:restricted -->'
BANNER_END='<!-- /greptile-auto-approve:restricted -->'
# Only the Greptile app may have written the score: anyone else can edit a PR body.
GREPTILE_LOGINS='greptile-apps greptile-apps[bot]'
# The files API lists at most 3000 files of a PR.
FILES_API_LIMIT=3000

owner="${REPO%/*}"
name="${REPO#*/}"

# shellcheck disable=SC2016 # GraphQL variables, not shell ones
pr_json=$(gh api graphql \
  -F owner="$owner" \
  -F name="$name" \
  -F number="$PR_NUMBER" \
  -F edits="$BODY_EDITS_READ" \
  -f query='
query($owner: String!, $name: String!, $number: Int!, $edits: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      isDraft
      headRefOid
      changedFiles
      body
      userContentEdits(last: $edits) { nodes { editedAt editor { login } } }
    }
  }
}' --jq '.data.repository.pullRequest')

state=$(jq -r '.state' <<<"$pr_json")
is_draft=$(jq -r '.isDraft' <<<"$pr_json")
head_sha=$(jq -r '.headRefOid' <<<"$pr_json")
changed_files=$(jq -r '.changedFiles' <<<"$pr_json")
body=$(jq -r '.body // ""' <<<"$pr_json")
editor=$(jq -r \
  --arg bots "$BOT_EDITOR_LOGINS" \
  '[.userContentEdits.nodes[]
    | select((.editor.login // "") as $login | ($bots | split(" ") | index($login)) | not)]
   | sort_by(.editedAt) | last | .editor.login // ""' \
  <<<"$pr_json")

# is_protected_path succeeds when the path matches a pattern of PROTECTED_PATHS
# and no '!' pattern.
is_protected_path() {
  local path="$1" pattern matched=false
  while IFS= read -r pattern || [[ -n "$pattern" ]]; do
    pattern="${pattern%%#*}"
    pattern="${pattern//[[:space:]]/}"
    [[ -z "$pattern" ]] && continue
    if [[ "$pattern" == '!'* ]]; then
      # shellcheck disable=SC2053 # the pattern is a glob on purpose
      [[ "$path" == ${pattern#!} ]] && return 1
    else
      # shellcheck disable=SC2053 # the pattern is a glob on purpose
      [[ "$path" == $pattern ]] && matched=true
    fi
  done <"$PROTECTED_PATHS"
  [[ "$matched" == "true" ]]
}

# check_pr sets reason to why the PR is not approved, and leaves it empty when it is.
check_pr() {
  if [[ "$state" != "OPEN" ]]; then
    reason="PR is $state"
    return
  fi
  if [[ "$is_draft" == "true" ]]; then
    reason="PR is a draft"
    return
  fi

  local greptile_edited=false login
  for login in $GREPTILE_LOGINS; do
    [[ "$editor" == "$login" ]] && greptile_edited=true
  done
  if [[ "$greptile_edited" != "true" ]]; then
    reason="PR body was last edited by '${editor:-<nobody>}', not by Greptile"
    return
  fi

  local markers
  markers=$(grep -oE '<!-- greptile_confidence_score:[0-9]+ -->' <<<"$body" || true)
  if [[ -z "$markers" ]]; then
    reason="no Greptile confidence score in PR body"
    return
  fi
  if [[ $(wc -l <<<"$markers") -ne 1 ]]; then
    reason="more than one Greptile confidence score in PR body"
    return
  fi
  score=$(grep -oE '[0-9]+' <<<"$markers")

  if (( score < MIN_SCORE )); then
    reason="Greptile confidence score $score/5 is below $MIN_SCORE"
    return
  fi

  reason="$restricted_reason"
}

# find_restricted sets restricted_reason and protected_touched when the PR touches a protected
# path or lists too many files to check.
find_restricted() {
  if (( changed_files >= FILES_API_LIMIT )); then
    restricted_reason="PR changes $changed_files files, more than the files API lists"
    return
  fi

  local path
  while IFS= read -r path; do
    is_protected_path "$path" && protected_touched+=("$path")
  done < <(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files" \
    --jq '.[] | .filename, (.previous_filename // empty)')
  if (( ${#protected_touched[@]} > 0 )); then
    restricted_reason="PR touches protected path ${protected_touched[0]}"
  fi
}

# restricted_banner prints the banner that starts the body of a restricted PR.
restricted_banner() {
  echo "$BANNER_START"
  echo "# AUTOREVIEW: RESTRICTED"
  echo
  echo "This PR needs a human review. Greptile auto-approve does not approve it: $restricted_reason (\`$PROTECTED_PATHS_LABEL\`)."
  if (( ${#protected_touched[@]} > 0 )); then
    echo
    printf -- "- \`%s\`\n" "${protected_touched[@]:0:BANNER_PATH_LIMIT}"
    if (( ${#protected_touched[@]} > BANNER_PATH_LIMIT )); then
      echo "- and $(( ${#protected_touched[@]} - BANNER_PATH_LIMIT )) more"
    fi
  fi
  echo "$BANNER_END"
}

# sync_restricted_banner puts the banner at the start of the PR body while the PR is restricted,
# and removes it when the PR is not.
sync_restricted_banner() {
  local unbannered new_body
  unbannered=$(BANNER_START="$BANNER_START" BANNER_END="$BANNER_END" \
    perl -0777 -pe 's/\Q$ENV{BANNER_START}\E.*?\Q$ENV{BANNER_END}\E\s*//s' <<<"$body")
  new_body="$unbannered"
  if [[ -n "$restricted_reason" ]]; then
    new_body="$(restricted_banner)${unbannered:+$'\n\n'$unbannered}"
  fi
  [[ "$new_body" == "$body" ]] && return
  echo "update the restricted banner in the PR body"
  run gh api -X PATCH "repos/$REPO/pulls/$PR_NUMBER" -f body="$new_body"
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "dry run: $*"
  else
    "$@" >/dev/null
  fi
}

score=""
reason=""
restricted_reason=""
protected_touched=()
if [[ "$state" == "OPEN" ]]; then
  find_restricted
  sync_restricted_banner
fi
check_pr

bot_approvals=$(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/reviews" \
  --jq ".[] | select(.user.login == \"$BOT_LOGIN\" and .state == \"APPROVED\") | \"\(.id) \(.commit_id)\"")

# post_conclusion posts the decision as a PR comment.
post_conclusion() {
  run gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" \
    -f body="**Greptile auto-approve** at $head_sha: $1"
}

if [[ -z "$reason" ]]; then
  echo "approve: Greptile confidence $score/5, no protected path touched at $head_sha"
  conclusion="approved. Latest Greptile confidence score is $score/5, and no protected path (\`$PROTECTED_PATHS_LABEL\`) is touched."
  # An approval stays valid across pushes: the repos do not dismiss stale reviews.
  if [[ -n "$bot_approvals" ]]; then
    echo "already approved"
  else
    run gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/reviews" \
      -f commit_id="$head_sha" \
      -f event=APPROVE \
      -f body="Auto-approved: latest Greptile confidence score is $score/5, and $head_sha touches no protected path (\`$PROTECTED_PATHS_LABEL\`)."
  fi
  post_conclusion "$conclusion"
  exit 0
fi

echo "no approval: $reason"
conclusion="not approved: $reason."
dismissed=0
while read -r review_id _; do
  [[ -z "$review_id" ]] && continue
  echo "dismiss review $review_id"
  run gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/reviews/$review_id/dismissals" \
    -f message="Auto-approval withdrawn: $reason." \
    -f event=DISMISS
  dismissed=$((dismissed + 1))
done <<<"$bot_approvals"
if (( dismissed > 0 )); then
  conclusion+=" Withdrew $dismissed earlier approval(s)."
fi
post_conclusion "$conclusion"
