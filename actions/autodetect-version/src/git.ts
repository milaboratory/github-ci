import * as exec from '@actions/exec'
import * as github from '@actions/github'

import {countOccurrences} from './utils'

async function git(...args: string[]): Promise<exec.ExecOutput> {
  const execResult = await exec.getExecOutput('git', args)

  if (execResult.exitCode !== 0) {
    const cmd = `git '${args.join("' '")}'`
    const exitCode = execResult.exitCode.toString()
    const stderr = execResult.stderr

    throw Error(`Command "${cmd}" failed with code '${exitCode}': ${stderr}`)
  }

  return execResult
}

async function fetchHistory(depth: number): Promise<void> {
  // Fetch all tags without their history.
  // We don't need almost the full repo to be fetched.
  await git('fetch', '--depth=1', 'origin', 'refs/tags/*:refs/tags/*')

  // Check the size of already fetched history from current commit.
  // We need to fetch more only if the current history is shorter than we want.
  const revListResult = await git('rev-list', `--max-count=${depth}`, 'HEAD')
  const revList = revListResult.stdout.trim()
  const fetchedLength: number = countOccurrences(revList, '\n') + 1

  if (fetchedLength < depth) {
    await git('fetch', `--depth=${depth}`, 'origin', github.context.sha)
  }
}

async function getVersion(): Promise<string> {
  const describeResult = await git('describe', '--tags')
  let versionString: string = describeResult.stdout

  versionString = versionString.replace('-', '.') // v1.0-2-g<hash> -> v1.0.2-g<hash>
  versionString = versionString.split('-', 2)[0] // v1.0.2-g<hash> -> v1.0.2
  if (versionString.startsWith('v')) {
    versionString = versionString.substring(1) // v1.0.2 -> 1.0.2
  }

  return versionString
}

async function generateVersionFromGit(depth: number): Promise<string> {
  await fetchHistory(depth)
  return getVersion()
}

export default generateVersionFromGit
