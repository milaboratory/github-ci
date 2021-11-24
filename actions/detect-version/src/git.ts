import * as exec from '@actions/exec'

export async function git(...args: string[]): Promise<exec.ExecOutput> {
  const execResult = await exec.getExecOutput('git', args, {
    ignoreReturnCode: true
  })

  if (execResult.exitCode !== 0) {
    const cmd = `git '${args.join("' '")}'`
    const exitCode = execResult.exitCode.toString()
    const stderr = execResult.stderr

    throw Error(`command "${cmd}" failed with code '${exitCode}':\n\n${stderr}`)
  }

  return execResult
}

interface fetchOptions {
  remote?: string
  refSpec?: string
  depth?: number
  deepen?: number
}

export async function fetch(opts?: fetchOptions): Promise<void> {
  const cmd: string[] = ['fetch']

  if (opts && opts.depth != null) cmd.push(`--depth=${opts.depth}`)
  if (opts && opts.deepen != null) cmd.push(`--deepen=${opts.deepen}`)
  if (opts && opts.remote) cmd.push(opts.remote)
  if (opts && opts.refSpec) cmd.push(opts.refSpec)

  await git(...cmd)
}

interface revListOptions {
  maxCount?: number
  ref?: string
}

export async function revList(opts?: revListOptions): Promise<string[]> {
  const cmd: string[] = ['rev-list']

  if (opts && opts.maxCount != null) cmd.push(`--max-count=${opts.maxCount}`)
  if (opts && opts.ref) cmd.push(opts.ref)

  const revListResult = await git(...cmd)
  const revListStr = revListResult.stdout.trim()
  if (revListStr === '') {
    return []
  }

  return revListStr.split('\n')
}

export async function resolveRef(ref = 'HEAD'): Promise<string> {
  const shaList = await revList({maxCount: 1, ref})
  return shaList[0]
}

/**
 * Fetch all tags from remote repository without their history (only single commit)
 * and without breaking local history of already fetched refs
 */
export async function fetchTags(remote = 'origin'): Promise<void> {
  await fetch({
    remote,
    refSpec: 'refs/tags/*:refs/tags/*',
    deepen: 1
  })
}

/**
 * Ensure git repository has history of at least <minCommits> size from <ref>.
 * If not, fetch at most <minCommits> of <ref> from <remote>.
 */
export async function ensureHistorySize(
  minCommits: number,
  remote = 'origin',
  ref = 'HEAD'
): Promise<void> {
  const commits = await revList({
    maxCount: minCommits,
    ref
  })

  if (commits.length >= minCommits) {
    return
  }

  await fetch({
    deepen: minCommits,
    remote,
    refSpec: ref
  })
}

interface describeOptions {
  ref?: string
  abbrev?: number
  exactMatch?: boolean
  tags?: boolean
}

export async function describe(opts?: describeOptions): Promise<string> {
  const cmd: string[] = ['describe']

  if (opts && opts.tags) cmd.push('--tags')
  if (opts && opts.abbrev != null) cmd.push(`--abbrev=${opts.abbrev}`)
  if (opts && opts.exactMatch) cmd.push('--exact-match')
  if (opts && opts.ref) cmd.push(opts.ref)

  const describeResult = await git(...cmd)
  const versionString: string = describeResult.stdout

  return versionString.trim()
}
