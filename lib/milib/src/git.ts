import * as exec from "@actions/exec";

export async function git(...args: string[]): Promise<exec.ExecOutput> {
  const execResult = await exec.getExecOutput("git", args, {
    ignoreReturnCode: true,
  });

  if (execResult.exitCode !== 0) {
    const cmd = `git '${args.join("' '")}'`;
    const exitCode = execResult.exitCode.toString();
    const stderr = execResult.stderr;

    throw Error(
      `command "${cmd}" failed with code '${exitCode}':\n\n${stderr}`,
    );
  }

  return execResult;
}

/*
 * Basic command wrappers.
 *   - Each command wrapper function should be named similar to original git command
 *     (translate dash-delimited to camelCase).
 *   - Each command should get single arguments object as parameter with all supported git options
 */

interface fetchOptions {
  remote?: string;
  refSpec?: string;
  depth?: number;
  deepen?: number;
  forceFlag?: boolean;
}

export async function fetch(opts?: fetchOptions): Promise<void> {
  const cmd: string[] = ["fetch"];

  if (opts && opts.forceFlag) cmd.push("--force");
  if (opts && opts.depth != null) cmd.push(`--depth=${opts.depth}`);
  if (opts && opts.deepen != null) cmd.push(`--deepen=${opts.deepen}`);
  if (opts && opts.remote) cmd.push(opts.remote);
  if (opts && opts.refSpec) cmd.push(opts.refSpec);

  await git(...cmd);
}

interface revListOptions {
  maxCount?: number;
  ref?: string;
}

export async function revList(opts?: revListOptions): Promise<string[]> {
  const cmd: string[] = ["rev-list"];

  if (opts && opts.maxCount != null) cmd.push(`--max-count=${opts.maxCount}`);
  if (opts && opts.ref) cmd.push(opts.ref);

  const revListResult = await git(...cmd);
  const revListStr = revListResult.stdout.trim();
  if (revListStr === "") {
    return [];
  }

  return revListStr.split("\n");
}

interface describeOptions {
  ref?: string;
  abbrev?: number;
  exactMatch?: boolean;
  tags?: boolean;
}

export async function describe(opts?: describeOptions): Promise<string> {
  const cmd: string[] = ["describe"];

  if (opts && opts.tags) cmd.push("--tags");
  if (opts && opts.abbrev != null) cmd.push(`--abbrev=${opts.abbrev}`);
  if (opts && opts.exactMatch) cmd.push("--exact-match");
  if (opts && opts.ref) cmd.push(opts.ref);

  const describeResult = await git(...cmd);
  const versionString: string = describeResult.stdout;

  return versionString.trim();
}

interface lsRemoteOptions {
  repository: string;
  refs?: string[];
  tagsFlag?: boolean;
  headsFlag?: boolean;
  refsFlag?: boolean;
  quietFlag?: boolean;
}

interface lsRemoteItem {
  objectSHA: string;
  refName: string;
}

export async function lsRemote(opts: lsRemoteOptions): Promise<lsRemoteItem[]> {
  const cmd: string[] = ["ls-remote"];

  if (opts.tagsFlag) cmd.push("--tags");
  if (opts.headsFlag) cmd.push("--heads");
  if (opts.refs) cmd.push("--refs");
  if (opts.quietFlag) cmd.push("--quiet");

  cmd.push(opts.repository);

  if (opts.refs) cmd.push(...opts.refs);

  const lsRemoteResult = await git(...cmd);

  const result: lsRemoteItem[] = [];
  for (const line of lsRemoteResult.stdout.trim().split("\n")) {
    const parts = line.split("\t");
    result.push({ objectSHA: parts[0], refName: parts[1] });
  }

  return result;
}

interface tagOptions {
  list?: boolean;
  ref?: string;
  pointsAt?: string;
  merged?: string;
  sort?: string;
}

export async function tag(opts?: tagOptions): Promise<string> {
  const cmd: string[] = ["tag"];

  if (opts && opts.list) cmd.push("--list");
  if (opts && opts.pointsAt) cmd.push(`--points-at=${opts.pointsAt}`);
  if (opts && opts.merged) cmd.push(`--merged=${opts.merged}`);
  if (opts && opts.sort) cmd.push(`--sort=${opts.sort}`);
  if (opts && opts.ref) cmd.push(opts.ref);

  const tagResult = await git(...cmd);

  return tagResult.stdout.trim();
}

/*
 * Complex git action helpers.
 * Here are functions that simplify common actions
 * The usually either 'aliases' that wrap git command with predefined arguments
 * or bunch of actions not covered by single git command.
 */

/**
 * Resolve any textual reference into commit SHA.
 * Commit SHA as <ref> is resolved to itself.
 */
export async function resolveRef(ref = "HEAD"): Promise<string> {
  const shaList = await revList({ maxCount: 1, ref });
  return shaList[0];
}

/**
 * Fetch all tags from remote repository without their history (only single commit)
 * and without breaking local history of already fetched refs
 */
export async function fetchTags(remote = "origin"): Promise<void> {
  await fetch({
    remote,
    refSpec: "refs/tags/*:refs/tags/*",
    deepen: 1,
  });
}

/**
 * Get all tags that point exactly to given commit (HEAD by default)
 */
export async function listCommitTags(ref = "HEAD"): Promise<string[]> {
  const tagsListStr = await tag({
    pointsAt: ref,
  });

  if (!tagsListStr) {
    return [];
  }

  return tagsListStr.split("\n");
}

/**
 * Count number of commits from <from> to <to> references, including <to> commit itself.
 */
export async function countCommits(from: string, to: string): Promise<number> {
  const commits = await revList({ ref: `${from}..${to}` });
  return commits.length;
}

/**
 * Get tag that points exactly to given commit
 * NOTE: when several tags point to given commit, the freshest (by tag's date)
 *       is returned. This behavior is defined by git itself.
 *       See 'man git-describe' for more info.
 */
export async function currentTag(ref = "HEAD"): Promise<string> {
  return await describe({
    tags: true,
    abbrev: 0,
    exactMatch: true,
    ref,
  });
}

/**
 * Get first tag reachable from given commit.
 * It is either tag that points directly to commit, or to any of its parents (closest parent).
 *
 * NOTE: when several tags point to single commit, the freshest (by tag's date) is returned.
 *       This behavior is defined by git itself.
 *       See 'man git-describe' for more info.
 * @param ref
 */
export async function latestTag(ref = "HEAD"): Promise<string> {
  return await describe({
    tags: true,
    abbrev: 0,
    ref,
  });
}

/**
 * Get first tag reachable from given commit's PARENT.
 * This is useful when you try to detect changes between two versions of code.
 * E.g.:
 *  const curTag = currentTag('HEAD')
 *  const prevTag = previousTag('HEAD')
 *  const versionChanges = log({ref: `${prevTag}..${curTag}`})
 *
 * NOTE: when several tags point to single commit, the freshest (by tag's date)
 *       is returned. This behavior is defined by git itself.
 *       See 'man git-describe' for more info.
 * @param ref
 */
export async function previousTag(ref = "HEAD"): Promise<string> {
  return await latestTag(`${ref}^`);
}

/**
 * Ensure git repository has history of at least <minCommits> size from <ref>.
 * If not, fetch at most <minCommits> of <ref> from <remote>.
 */
export async function ensureHistorySize(
  minCommits: number,
  remote = "origin",
  ref = "HEAD",
): Promise<void> {
  const commits = await revList({
    maxCount: minCommits,
    ref,
  });

  if (commits.length >= minCommits) {
    return;
  }

  await fetch({
    deepen: minCommits,
    remote,
    refSpec: ref,
  });
}

/**
 * Get list of files that have changed between current state and specified base branch.
 * @param refSpec: string diff ref spec: <branch>, <branch1>..<branch2>, ...
 * @returns Array of changed file paths
 */
export async function getChangedFiles(refSpec: string): Promise<string[]> {
  const cmd: string[] = ["diff", "--name-only", refSpec];
  
  const diffResult = await git(...cmd);
  const filesStr = diffResult.stdout.trim();
  
  if (!filesStr) {
    return [];
  }
  
  return filesStr.split("\n");
}
