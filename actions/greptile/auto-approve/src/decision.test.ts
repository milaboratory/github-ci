import { describe, expect, it } from "vitest";

import { decide, PullRequestState, restrictedReason } from "./decision";

const scored = (score: number): PullRequestState => ({
  state: "OPEN",
  isDraft: false,
  editor: "greptile-apps",
  body: `Summary\n<!-- greptile_confidence_score:${score} -->\n`,
});

describe("decide", () => {
  it("approves a high score on an open PR with no protected path", () => {
    expect(decide(scored(4), 4, "")).toEqual({ reason: "", score: 4 });
    expect(decide({ ...scored(5), editor: "greptile-apps[bot]" }, 4, "")).toEqual({ reason: "", score: 5 });
  });

  it("does not approve a closed or draft PR", () => {
    expect(decide({ ...scored(5), state: "MERGED" }, 4, "").reason).toBe("PR is MERGED");
    expect(decide({ ...scored(5), isDraft: true }, 4, "").reason).toBe("PR is a draft");
  });

  it("trusts the score only when Greptile edited the body last", () => {
    expect(decide({ ...scored(5), editor: "someone" }, 4, "").reason).toBe(
      "PR body was last edited by 'someone', not by Greptile",
    );
    expect(decide({ ...scored(5), editor: "" }, 4, "").reason).toBe(
      "PR body was last edited by '<nobody>', not by Greptile",
    );
  });

  it("needs exactly one score marker", () => {
    expect(decide({ ...scored(5), body: "no score" }, 4, "").reason).toBe("no Greptile confidence score in PR body");
    expect(decide({ ...scored(5), body: scored(5).body + scored(4).body }, 4, "").reason).toBe(
      "more than one Greptile confidence score in PR body",
    );
  });

  it("does not approve a score below min-score", () => {
    expect(decide(scored(3), 4, "")).toEqual({ reason: "Greptile confidence score 3/5 is below 4", score: 3 });
  });

  it("does not approve a restricted PR", () => {
    expect(decide(scored(5), 4, "PR touches protected path x")).toEqual({
      reason: "PR touches protected path x",
      score: 5,
    });
  });
});

describe("restrictedReason", () => {
  it("names the first protected path and the count of the others", () => {
    expect(restrictedReason(3, [])).toBe("");
    expect(restrictedReason(3, ["a"])).toBe("PR touches protected path a");
    expect(restrictedReason(3, ["a", "b", "c"])).toBe("PR touches protected path a and 2 more");
  });

  it("restricts a PR that is too large for the files API", () => {
    expect(restrictedReason(3000, [])).toBe("PR changes 3000 files, more than the files API lists");
  });
});
