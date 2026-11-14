import { describe, expect, it } from "vitest";

import { changedPaths } from "./changes";

describe("changedPaths", () => {
  it("gives the filename for each status, also for a removed file", () => {
    const statuses = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];
    const files = statuses.map((status) => ({ filename: `dir/${status}.go`, status }));
    expect(changedPaths(files)).toEqual(statuses.map((status) => `dir/${status}.go`));
  });

  it("gives the old path of a renamed or copied file after its new path", () => {
    expect(
      changedPaths([
        { filename: "new/a.go", status: "renamed", previous_filename: "old/a.go" },
        { filename: "copy/b.go", status: "copied", previous_filename: "orig/b.go" },
      ]),
    ).toEqual(["new/a.go", "old/a.go", "copy/b.go", "orig/b.go"]);
  });

  it("reads the same shape as the GitHub API, where previous_filename is null or missing", () => {
    // The shape of "list pull request files" items for a removed and a renamed file.
    const apiItems = [
      { filename: "cmd/flags/old_test.go", previous_filename: null, status: "removed", additions: 0, deletions: 12 },
      { filename: "ctl/fixup.go", previous_filename: "ctl/bootstrap.go", status: "renamed" },
      { filename: "README.md", status: "modified" },
    ];
    expect(changedPaths(apiItems)).toEqual(["cmd/flags/old_test.go", "ctl/fixup.go", "ctl/bootstrap.go", "README.md"]);
  });

  it("gives each path once, in the order of the files", () => {
    expect(
      changedPaths([
        { filename: "b", status: "modified" },
        { filename: "a", status: "renamed", previous_filename: "b" },
        { filename: "b", status: "modified" },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("gives nothing for no files", () => {
    expect(changedPaths([])).toEqual([]);
  });
});
