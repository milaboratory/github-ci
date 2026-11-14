// Finds the PR paths that match the protected list.
//
// The @actions/glob globber finds files on disk only. The action has no checkout, and a PR can
// delete files or rename them. Thus the action creates an empty placeholder file for each path in a
// temporary directory and runs the globber there.
//
// Matching is case-insensitive: the action changes the patterns and the paths to lowercase before
// it creates the placeholders, and then maps the results back to the paths of the PR.

import * as glob from "@actions/glob";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

export class InvalidPatternError extends Error {}

// The same options for each run, so that the rules in action.yaml stay true.
const GLOB_OPTIONS: glob.GlobOptions = {
  followSymbolicLinks: false,
  implicitDescendants: true,
  matchDirectories: false,
  excludeHiddenFiles: false,
};

// normalizePatterns validates the protected list and returns it in lowercase,
// in the format that glob.create reads.
export function normalizePatterns(text: string): string {
  const lines: string[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      return;
    }
    const pattern = line.replace(/^!+/, "");
    const problem = patternProblem(pattern);
    if (problem !== "") {
      throw new InvalidPatternError(`line ${index + 1} '${line}': ${problem}`);
    }
    lines.push(line.toLowerCase());
  });
  return lines.join("\n");
}

function patternProblem(pattern: string): string {
  if (pattern === "") {
    return "the pattern is empty";
  }
  if (pattern.startsWith("/")) {
    return "the pattern must be relative to the repository root, remove the first '/'";
  }
  if (pattern.startsWith("~")) {
    return "'~' is the home directory of the runner, not a repository path";
  }
  if (pattern.split("/").includes("..")) {
    return "'..' is not permitted";
  }
  return "";
}

// isRepoPath is true for a path that the action can put into the temporary directory.
export function isRepoPath(p: string): boolean {
  if (p === "" || p.startsWith("/") || p.includes("\0") || p.includes("\\")) {
    return false;
  }
  return p.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parentDirs(p: string): string[] {
  const dirs: string[] = [];
  for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) {
    dirs.push(p.slice(0, i));
  }
  return dirs;
}

// splitIntoBatches puts the paths into groups where no path is a parent directory of another path.
// A file and a directory with the same path cannot be on disk at the same time, but a PR can have
// both: for example, it renames 'a/b' to 'a/b/c'.
export function splitIntoBatches(paths: string[]): string[][] {
  const batches: { files: Set<string>; dirs: Set<string>; paths: string[] }[] = [];
  for (const p of paths) {
    const parents = parentDirs(p);
    let batch = batches.find((b) => !b.dirs.has(p) && !parents.some((d) => b.files.has(d)));
    if (batch === undefined) {
      batch = { files: new Set(), dirs: new Set(), paths: [] };
      batches.push(batch);
    }
    batch.files.add(p);
    parents.forEach((d) => batch.dirs.add(d));
    batch.paths.push(p);
  }
  return batches.map((b) => b.paths);
}

// createPlaceholders creates an empty file under root for each path. The paths must be repository
// paths (see isRepoPath), and no path can be a parent directory of another path (see
// splitIntoBatches).
export async function createPlaceholders(root: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    const file = path.join(root, p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "");
  }
}

// matchBatch returns the paths of the batch that the patterns match.
async function matchBatch(patterns: string, paths: string[]): Promise<Set<string>> {
  const tempBase = process.env.RUNNER_TEMP || os.tmpdir();
  const root = await fs.realpath(await fs.mkdtemp(path.join(tempBase, "greptile-auto-approve-")));
  try {
    await createPlaceholders(root, paths);

    // glob.create resolves relative patterns from the current directory.
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const globber = await glob.create(patterns, GLOB_OPTIONS);
      const found = await globber.glob();
      const matched = new Set<string>();
      for (const file of found) {
        const relative = path.relative(root, file);
        if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
          matched.add(relative.split(path.sep).join("/"));
        }
      }
      return matched;
    } finally {
      process.chdir(cwd);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// findProtectedPaths returns the paths that the protected list matches, in the order of paths.
// A path that cannot be a repository path is always protected.
// It throws InvalidPatternError when the protected list has an incorrect pattern.
export async function findProtectedPaths(patternsText: string, paths: string[]): Promise<string[]> {
  const patterns = normalizePatterns(patternsText);

  const protectedPaths = new Set<string>();
  const byKey = new Map<string, string[]>();
  for (const p of paths) {
    if (!isRepoPath(p)) {
      protectedPaths.add(p);
      continue;
    }
    const key = p.toLowerCase();
    const same = byKey.get(key);
    if (same === undefined) {
      byKey.set(key, [p]);
    } else {
      same.push(p);
    }
  }

  if (patterns !== "") {
    for (const batch of splitIntoBatches([...byKey.keys()])) {
      for (const key of await matchBatch(patterns, batch)) {
        byKey.get(key)?.forEach((p) => protectedPaths.add(p));
      }
    }
  }

  return [...new Set(paths)].filter((p) => protectedPaths.has(p));
}
