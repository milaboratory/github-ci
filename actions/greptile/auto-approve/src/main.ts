// Approves a PR on behalf of github-actions[bot] when the latest Greptile confidence score in the
// PR body is at least min-score and the PR, at its current head, touches no protected path. The
// score is trusted even when Greptile reviewed an older commit: Greptile does not re-review every
// push. In all other cases the action dismisses the approvals that the bot gave before, so a lower
// score or a push that touches a protected path takes the approval back.
//
// The workflow runs the action on every PR event, also before Greptile writes a score. An open PR
// has ALLOW_LABEL when the run approves it, and DECLINED_LABEL in all other cases. A run posts its
// decision as a new PR comment only when the PR body has a Greptile score, so a PR with no Greptile review gets no
// comment on each push. The run never edits the PR body, so the last editor of the body stays the
// author of the score.

import * as core from "@actions/core";
import * as github from "@actions/github";

import { changedPaths } from "./changes";
import { decide, hasScoreMarker, PullRequestState, restrictedReason } from "./decision";
import { findProtectedPaths, InvalidPatternError } from "./protected";

const BOT_LOGIN = "github-actions[bot]";
// GitHub creates the label on first use.
const ALLOW_LABEL = "AUTOAPPROVE: ALLOW";
const DECLINED_LABEL = "AUTOAPPROVE: DECLINED";

type Octokit = ReturnType<typeof github.getOctokit>;

interface PullRequestQuery {
  repository: {
    pullRequest: {
      state: string;
      isDraft: boolean;
      headRefOid: string;
      changedFiles: number;
      body: string | null;
      editor: { login: string } | null;
      labels: { nodes: { name: string }[] };
    };
  };
}

async function run(): Promise<void> {
  const protectedPathsSource = core.getInput("protected-paths", { required: true });
  const minScore = Number(core.getInput("min-score") || "4");
  const dryRun = core.getInput("dry-run") === "true";
  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));

  if (!Number.isInteger(minScore) || minScore < 1 || minScore > 5) {
    throw new Error(`min-score must be an integer from 1 to 5, not '${core.getInput("min-score")}'`);
  }
  const pullRequest = github.context.payload.pull_request;
  if (pullRequest === undefined) {
    throw new Error("the action needs a pull_request or pull_request_target event");
  }
  const { owner, repo } = github.context.repo;
  const prNumber: number = pullRequest.number;
  const baseSha: string = pullRequest.base.sha;

  // act runs a change on GitHub. In a dry run it only prints the change.
  const act = async (description: string, change: () => Promise<unknown>): Promise<void> => {
    if (dryRun) {
      core.info(`dry run: ${description}`);
      return;
    }
    core.info(description);
    await change();
  };

  // setLabel adds or removes one label of the PR, and does nothing when the PR already matches.
  const setLabel = async (labels: string[], name: string, wanted: boolean): Promise<void> => {
    const labeled = labels.includes(name);
    if (wanted && !labeled) {
      await act(`add label ${name}`, () =>
        octokit.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [name] }),
      );
    } else if (!wanted && labeled) {
      await act(`remove label ${name}`, () =>
        octokit.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name }),
      );
    }
  };

  const query = await octokit.graphql<PullRequestQuery>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          state
          isDraft
          headRefOid
          changedFiles
          body
          editor { login }
          labels(first: 100) { nodes { name } }
        }
      }
    }`,
    { owner, name: repo, number: prNumber },
  );
  const data = query.repository.pullRequest;
  const pr: PullRequestState = {
    state: data.state,
    isDraft: data.isDraft,
    editor: data.editor?.login ?? "",
    body: data.body ?? "",
  };
  const headSha = data.headRefOid;
  const labels = data.labels.nodes.map((label) => label.name);

  let restricted = "";
  let listError = "";
  if (pr.state === "OPEN") {
    try {
      restricted = await findRestricted(octokit, owner, repo, prNumber, baseSha, protectedPathsSource, data.changedFiles);
    } catch (error) {
      if (!(error instanceof InvalidPatternError)) {
        throw error;
      }
      // An incorrect list protects all paths: the action must not approve with a broken list.
      listError = `${protectedPathsSource} has an incorrect pattern: ${error.message}`;
      restricted = listError;
    }
  }

  const { reason, score } = decide(pr, minScore, restricted);
  if (pr.state === "OPEN") {
    await setLabel(labels, ALLOW_LABEL, reason === "");
    await setLabel(labels, DECLINED_LABEL, reason !== "");
  }

  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const botApprovals = reviews.filter((r) => r.user?.login === BOT_LOGIN && r.state === "APPROVED");

  const postConclusion = async (conclusion: string): Promise<void> => {
    if (!hasScoreMarker(pr.body)) {
      core.info("no Greptile score in PR body: post no PR comment");
      return;
    }
    await act("post the decision as a PR comment", () =>
      octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `**Greptile auto-approve** at ${headSha}: ${conclusion}`,
      }),
    );
  };

  if (reason === "") {
    core.info(`approve: Greptile confidence ${score}/5, no protected path touched at ${headSha}`);
    // An approval stays valid across pushes: the repositories do not dismiss stale reviews.
    if (botApprovals.length > 0) {
      core.info("already approved");
    } else {
      await act("approve the PR", () =>
        octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: headSha,
          event: "APPROVE",
          body: `Auto-approved: latest Greptile confidence score is ${score}/5, and ${headSha} touches no protected path (\`${protectedPathsSource}\`).`,
        }),
      );
    }
    await postConclusion(
      `approved. Latest Greptile confidence score is ${score}/5, and no protected path (\`${protectedPathsSource}\`) is touched.`,
    );
    return;
  }

  core.info(`no approval: ${reason}`);
  let conclusion = `not approved: ${reason}.`;
  for (const review of botApprovals) {
    await act(`dismiss review ${review.id}`, () =>
      octokit.rest.pulls.dismissReview({
        owner,
        repo,
        pull_number: prNumber,
        review_id: review.id,
        message: `Auto-approval withdrawn: ${reason}.`,
        event: "DISMISS",
      }),
    );
  }
  if (botApprovals.length > 0) {
    conclusion += ` Withdrew ${botApprovals.length} earlier approval(s).`;
  }
  await postConclusion(conclusion);

  if (listError !== "") {
    core.setFailed(listError);
  }
}

// findRestricted reads the protected list from the base commit, so a PR cannot change the list
// that the action uses for it. It returns why the PR needs a human review, or "" when it does not.
async function findRestricted(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  baseSha: string,
  protectedPathsSource: string,
  changedFiles: number,
): Promise<string> {
  const early = restrictedReason(changedFiles, []);
  if (early !== "") {
    return early;
  }

  const list = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: protectedPathsSource,
    ref: baseSha,
    mediaType: { format: "raw" },
  });
  const patterns = String(list.data);

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const protectedPaths = await findProtectedPaths(patterns, changedPaths(files));
  if (protectedPaths.length > 0) {
    core.info(`protected paths:\n  ${protectedPaths.join("\n  ")}`);
  }
  return restrictedReason(changedFiles, protectedPaths);
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
