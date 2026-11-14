// Tests the placeholder tree that the globber sees. The mock of @actions/glob records the files and
// directories in the current directory each time the action calls glob.create, and then calls the
// real globber.

import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changedPaths, ChangedFile } from "./changes";
import { createPlaceholders, findProtectedPaths } from "./protected";

// FAIL_MARKER in the patterns makes the mocked glob.create fail, to test the clean-up after an error.
const FAIL_MARKER = "fail-glob-create";

const state = vi.hoisted(() => ({ trees: [] as string[][] }));

vi.mock("@actions/glob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@actions/glob")>();
  const nodeFs = await import("fs");
  const nodePath = await import("path");

  // listTree returns 'dir/' for a directory and 'file' for an empty file, sorted.
  // A file that is not empty is 'file (N bytes)'.
  const listTree = async (root: string): Promise<string[]> => {
    const entries: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await nodeFs.promises.readdir(dir, { withFileTypes: true })) {
        const full = nodePath.join(dir, entry.name);
        const relative = nodePath.relative(root, full).split(nodePath.sep).join("/");
        if (entry.isDirectory()) {
          entries.push(`${relative}/`);
          await walk(full);
        } else {
          const size = (await nodeFs.promises.stat(full)).size;
          entries.push(size === 0 ? relative : `${relative} (${size} bytes)`);
        }
      }
    };
    await walk(root);
    return entries.sort();
  };

  return {
    ...actual,
    create: async (patterns: string, options?: import("@actions/glob").GlobOptions) => {
      state.trees.push(await listTree(process.cwd()));
      if (patterns.includes("fail-glob-create")) {
        throw new Error("glob.create failed");
      }
      return actual.create(patterns, options);
    },
  };
});

let runnerTemp = "";
const savedRunnerTemp = process.env.RUNNER_TEMP;

beforeEach(async () => {
  state.trees = [];
  runnerTemp = await fs.mkdtemp(path.join(os.tmpdir(), "placeholders-test-"));
  process.env.RUNNER_TEMP = runnerTemp;
});

afterEach(async () => {
  process.env.RUNNER_TEMP = savedRunnerTemp;
  await fs.rm(runnerTemp, { recursive: true, force: true });
});

// trees runs the action matching for the PR files and returns the placeholder trees that the
// globber saw, one for each batch.
async function trees(files: ChangedFile[], patterns = "**"): Promise<string[][]> {
  await findProtectedPaths(patterns, changedPaths(files));
  return state.trees;
}

describe("placeholders from the PR files", () => {
  it("has one empty file for each changed path, also for removed files and old names", async () => {
    expect(
      await trees([
        { filename: "cmd/main.go", status: "modified" },
        { filename: "cmd/flags/new.go", status: "added" },
        { filename: "cmd/flags/old.go", status: "removed" },
        { filename: "pkg/b.go", status: "renamed", previous_filename: "cmd/cfg/a.go" },
        { filename: ".github/workflows/ci.yaml", status: "modified" },
        { filename: "Dockerfile", status: "removed" },
      ]),
    ).toEqual([
      [
        ".github/",
        ".github/workflows/",
        ".github/workflows/ci.yaml",
        "cmd/",
        "cmd/cfg/",
        "cmd/cfg/a.go",
        "cmd/flags/",
        "cmd/flags/new.go",
        "cmd/flags/old.go",
        "cmd/main.go",
        "dockerfile",
        "pkg/",
        "pkg/b.go",
      ],
    ]);
  });

  it("keeps glob characters and spaces in file names as literal names", async () => {
    expect(
      await trees([
        { filename: "a/x[1].go", status: "added" },
        { filename: "a/x*.go", status: "added" },
        { filename: "a/x?.go", status: "added" },
        { filename: "a b/c d.go", status: "added" },
      ]),
    ).toEqual([["a b/", "a b/c d.go", "a/", "a/x*.go", "a/x?.go", "a/x[1].go"]]);
  });

  it("has one placeholder for paths that differ only in case", async () => {
    expect(
      await trees([
        { filename: "Docs/README.md", status: "modified" },
        { filename: "docs/readme.md", status: "added" },
      ]),
    ).toEqual([["docs/", "docs/readme.md"]]);
  });

  it("puts a file and the files below a directory with the same path into separate trees", async () => {
    expect(await trees([{ filename: "a/b/c", status: "renamed", previous_filename: "a/b" }])).toEqual([
      ["a/", "a/b/", "a/b/c"],
      ["a/", "a/b"],
    ]);
  });

  it("has no placeholder for a path that cannot be a repository path", async () => {
    expect(
      await trees([
        { filename: "../outside", status: "added" },
        { filename: "a//b", status: "added" },
        { filename: "/abs", status: "added" },
        { filename: "ok.go", status: "added" },
      ]),
    ).toEqual([["ok.go"]]);
  });

  it("does not run the globber for an empty list of patterns", async () => {
    expect(await trees([{ filename: "a.go", status: "added" }], "# only a comment")).toEqual([]);
  });
});

describe("protection of removed and renamed files", () => {
  it("protects the removal of a protected file", async () => {
    const files = [{ filename: "cmd/flags/old.go", status: "removed" }];
    expect(await findProtectedPaths("cmd/flags", changedPaths(files))).toEqual(["cmd/flags/old.go"]);
  });

  it("protects a rename that moves a file out of a protected directory", async () => {
    const files = [{ filename: "pkg/a.go", status: "renamed", previous_filename: "cmd/flags/a.go" }];
    expect(await findProtectedPaths("cmd/flags", changedPaths(files))).toEqual(["cmd/flags/a.go"]);
  });
});

describe("clean-up", () => {
  it("removes the temporary directories after the match", async () => {
    await trees([
      { filename: "a/b/c", status: "renamed", previous_filename: "a/b" },
      { filename: "x.go", status: "removed" },
    ]);
    expect(state.trees).toHaveLength(2);
    expect(await fs.readdir(runnerTemp)).toEqual([]);
  });

  it("removes the temporary directory and restores the current directory when the globber fails", async () => {
    const cwd = process.cwd();
    await expect(trees([{ filename: "a.go", status: "added" }], FAIL_MARKER)).rejects.toThrow("glob.create failed");
    expect(await fs.readdir(runnerTemp)).toEqual([]);
    expect(process.cwd()).toBe(cwd);
  });
});

describe("createPlaceholders", () => {
  it("creates empty files and their parent directories under root", async () => {
    const root = await fs.mkdtemp(path.join(runnerTemp, "root-"));
    await createPlaceholders(root, ["a/b/c.go", "a/d.go", ".hidden/x", "top"]);
    const read = async (p: string) => (await fs.stat(path.join(root, p))).size;
    expect(await Promise.all(["a/b/c.go", "a/d.go", ".hidden/x", "top"].map(read))).toEqual([0, 0, 0, 0]);
    expect((await fs.readdir(root)).sort()).toEqual([".hidden", "a", "top"]);
    expect((await fs.readdir(path.join(root, "a"))).sort()).toEqual(["b", "d.go"]);
  });
});
