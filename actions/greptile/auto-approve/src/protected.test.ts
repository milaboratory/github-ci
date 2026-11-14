import { describe, expect, it } from "vitest";

import { findProtectedPaths, InvalidPatternError, isRepoPath, normalizePatterns, splitIntoBatches } from "./protected";

const FILES = [
  "a/b/c.go",
  "a/b/x/y/z.go",
  "a/b/x/README.md",
  "a/b/R.md",
  "a/b/.hidden/k",
  "a/bc/d.go",
  "a/x.go",
  "x.sh",
  "x/y/z.sh",
  ".github/w.yaml",
  "Dockerfile",
  "docker/Dockerfile.x",
];

async function match(...patterns: string[]): Promise<string[]> {
  return findProtectedPaths(patterns.join("\n"), FILES);
}

// These cases are the rules that action.yaml documents. Change both together.
describe("pattern rules", () => {
  it("a directory name protects all of the directory", async () => {
    const all = ["a/b/c.go", "a/b/x/y/z.go", "a/b/x/README.md", "a/b/R.md", "a/b/.hidden/k"];
    expect(await match("a/b")).toEqual(all);
    expect(await match("a/b/")).toEqual(all);
    expect(await match("a/b/*")).toEqual(all);
    expect(await match("a/b/**")).toEqual(all);
  });

  it("'*' does not match '/'", async () => {
    expect(await match("*.sh")).toEqual(["x.sh"]);
    expect(await match("a/b/*.go")).toEqual(["a/b/c.go"]);
    expect(await match("*Dockerfile*")).toEqual(["Dockerfile"]);
  });

  it("'**' matches any number of directories", async () => {
    expect(await match("**/*.sh")).toEqual(["x.sh", "x/y/z.sh"]);
    expect(await match("a/b/**/*.go")).toEqual(["a/b/c.go", "a/b/x/y/z.go"]);
    expect(await match("**/*Dockerfile*")).toEqual(["Dockerfile", "docker/Dockerfile.x"]);
  });

  it("'dir/*/*' does not match the files directly in dir", async () => {
    expect(await match("a/b/*/*")).toEqual(["a/b/x/y/z.go", "a/b/x/README.md", "a/b/.hidden/k"]);
  });

  it("a prefix also matches other directories", async () => {
    expect(await match("a/b*")).toContain("a/bc/d.go");
  });

  it("'?' and '[...]' match one character", async () => {
    expect(await match("a/?.go")).toEqual(["a/x.go"]);
    expect(await match("a/[b]/c.go")).toEqual(["a/b/c.go"]);
  });

  it("'*' matches hidden files", async () => {
    expect(await match(".github/*")).toEqual([".github/w.yaml"]);
  });

  it("matching is case-insensitive", async () => {
    expect(await match("A/B/C.GO")).toEqual(["a/b/c.go"]);
    expect(await match("dockerfile")).toEqual(["Dockerfile"]);
    expect(await findProtectedPaths("a/b", ["A/B/c.go", "a/b/C.go", "a/c.go"])).toEqual(["A/B/c.go", "a/b/C.go"]);
  });

  it("the last matching line wins", async () => {
    expect(await match("a/b", "!a/b/**/*.md")).toEqual(["a/b/c.go", "a/b/x/y/z.go", "a/b/.hidden/k"]);
    expect(await match("!a/b/**/*.md", "a/b")).toContain("a/b/R.md");
    expect(await match("a/b", "!a/b/*.md")).toContain("a/b/x/README.md");
    expect(await match("a/b", "!a/b/*.md")).not.toContain("a/b/R.md");
  });

  it("a comment is a line that starts with '#'", async () => {
    expect(await match("# a/b", "  # x.sh", "", "a/x.go")).toEqual(["a/x.go"]);
    expect(await match("a/x.go # note")).toEqual([]);
  });

  it("braces and extglob are not supported", async () => {
    expect(await match("a/{b,bc}/*")).toEqual([]);
    expect(await match("a/@(b|bc)/*")).toEqual([]);
  });

  it("an empty list protects nothing", async () => {
    expect(await match()).toEqual([]);
    expect(await match("!a/b")).toEqual([]);
  });
});

describe("paths", () => {
  it("checks a file and a directory with the same path", async () => {
    // A rename from 'a/b' to 'a/b/c' gives both paths.
    expect(await findProtectedPaths("a/b", ["a/b", "a/b/c"])).toEqual(["a/b", "a/b/c"]);
    expect(await findProtectedPaths("**/c", ["a/b", "a/b/c"])).toEqual(["a/b/c"]);
  });

  it("protects a path that cannot be a repository path", async () => {
    expect(await findProtectedPaths("x", ["../etc/passwd", "a//b", "a/b"])).toEqual(["../etc/passwd", "a//b"]);
  });

  it("returns each path once, in the order of the input", async () => {
    expect(await findProtectedPaths("a", ["a/2", "b", "a/1", "a/2"])).toEqual(["a/2", "a/1"]);
  });
});

describe("normalizePatterns", () => {
  it("rejects patterns that are not relative to the repository root", () => {
    expect(() => normalizePatterns("ok\n/platform/x")).toThrow(InvalidPatternError);
    expect(() => normalizePatterns("ok\n/platform/x")).toThrow(/line 2/);
    expect(() => normalizePatterns("!/x")).toThrow(InvalidPatternError);
    expect(() => normalizePatterns("~/x")).toThrow(InvalidPatternError);
    expect(() => normalizePatterns("a/../b")).toThrow(InvalidPatternError);
    expect(() => normalizePatterns("!")).toThrow(InvalidPatternError);
  });

  it("removes comments and empty lines and changes to lowercase", () => {
    expect(normalizePatterns("# c\r\n\r\n  Platform/Model  \n!Helm/*.MD")).toBe("platform/model\n!helm/*.md");
  });
});

describe("isRepoPath", () => {
  it.each(["a", "a/b.go", ".github/x", "a b/c"])("accepts %s", (p) => expect(isRepoPath(p)).toBe(true));
  it.each(["", "/a", "a/", "a//b", "./a", "a/../b", "a\\b", "a\0b"])("rejects %j", (p) =>
    expect(isRepoPath(p)).toBe(false),
  );
});

describe("splitIntoBatches", () => {
  it("keeps all paths in one batch when there is no conflict", () => {
    expect(splitIntoBatches(["a/b", "a/c", "d"])).toEqual([["a/b", "a/c", "d"]]);
  });

  it("separates a file from the files below a directory with the same path", () => {
    expect(splitIntoBatches(["a/b/c", "a/b", "a/b/d", "a"])).toEqual([["a/b/c", "a/b/d"], ["a/b"], ["a"]]);
  });
});
