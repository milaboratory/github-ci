import * as e from "@actions/core";
import * as n from "@actions/github";
import { git as g } from "@milaboratories/github-ci-actions-milib";
async function f() {
  var o;
  try {
    const r = e.getInput("baseBranch", { required: !0 }), l = e.getInput("ignore").split(`
`).map((t) => t.trim()).filter((t) => t.length > 0), c = new RegExp(`(${l.join(")|(")})`), i = (o = n.context.payload.pull_request) == null ? void 0 : o.number;
    if (!i) {
      e.setFailed("This action must be run in a pull request context");
      return;
    }
    const s = await g.getChangedFiles(`origin/${r}...HEAD`);
    if (e.debug(`Changed files: ${s.join(`
`)}`), s.filter((t) => !c.test(t)).length === 0) {
      e.info("No files to review after applying ignore patterns");
      return;
    }
    const p = n.getOctokit(process.env.GITHUB_TOKEN || ""), { data: u } = await p.rest.pulls.listReviews({
      owner: n.context.repo.owner,
      repo: n.context.repo.repo,
      pull_number: i
    }), a = u.filter((t) => t.state === "APPROVED").length;
    if (a === 0) {
      e.setFailed("PR requires at least one approval");
      return;
    }
    e.info(`PR has ${a} approval(s)`);
  } catch (r) {
    r instanceof Error ? e.setFailed(r.message) : e.setFailed("An unknown error occurred");
  }
}
f();
//# sourceMappingURL=index.mjs.map
