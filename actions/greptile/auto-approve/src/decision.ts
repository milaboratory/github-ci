// Pure decision rules of the action. main.ts does all calls to GitHub.

// Only the Greptile app may write the score: anyone can edit a PR body.
export const GREPTILE_LOGINS = ["greptile-apps", "greptile-apps[bot]"];

// The files API lists at most 3000 files of a PR.
export const FILES_API_LIMIT = 3000;

const SCORE_MARKER = /<!-- greptile_confidence_score:([0-9]+) -->/g;

export interface PullRequestState {
  state: string;
  isDraft: boolean;
  // The login of the last editor of the PR body, or "" when nobody edited it.
  editor: string;
  body: string;
}

export interface Decision {
  // Why the PR is not approved. "" means: approve.
  reason: string;
  score?: number;
}

// restrictedReason tells why the PR needs a human review, or returns "" when it does not.
export function restrictedReason(changedFiles: number, protectedPaths: string[]): string {
  if (changedFiles >= FILES_API_LIMIT) {
    return `PR changes ${changedFiles} files, more than the files API lists`;
  }
  if (protectedPaths.length === 0) {
    return "";
  }
  const more = protectedPaths.length > 1 ? ` and ${protectedPaths.length - 1} more` : "";
  return `PR touches protected path ${protectedPaths[0]}${more}`;
}

// decide applies the rules in their order: PR state, score author, score, protected paths.
export function decide(pr: PullRequestState, minScore: number, restricted: string): Decision {
  if (pr.state !== "OPEN") {
    return { reason: `PR is ${pr.state}` };
  }
  if (pr.isDraft) {
    return { reason: "PR is a draft" };
  }
  if (!GREPTILE_LOGINS.includes(pr.editor)) {
    return { reason: `PR body was last edited by '${pr.editor || "<nobody>"}', not by Greptile` };
  }

  const markers = [...pr.body.matchAll(SCORE_MARKER)];
  if (markers.length === 0) {
    return { reason: "no Greptile confidence score in PR body" };
  }
  if (markers.length > 1) {
    return { reason: "more than one Greptile confidence score in PR body" };
  }
  const score = Number(markers[0][1]);

  if (score < minScore) {
    return { reason: `Greptile confidence score ${score}/5 is below ${minScore}`, score };
  }
  return { reason: restricted, score };
}
