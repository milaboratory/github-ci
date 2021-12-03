import * as core from '@actions/core'

import {canonizeVersion, sanitizeVersion} from './utils'
import {git} from 'milib'

async function prepareRepository(depth: number): Promise<void> {
  await git.fetchTags()
  return git.ensureHistorySize(depth)
}

async function commitsCount(startRef: string, endRef: string): Promise<number> {
  const commits = await git.revList({ref: `${startRef}..${endRef}`})
  return commits.length
}

async function genDevVersion(
  baseVersion: string,
  baseRef: string
): Promise<string> {
  const currentRefName = process.env.GITHUB_REF_NAME as string
  const count = await commitsCount(baseRef, 'HEAD')

  return `${baseVersion}-${count}-${currentRefName}`
}

/**
 * Check if action was started from branch AND current commit is
 * repository's branch head.
 */
async function isBranchHead(): Promise<boolean> {
  const refType = process.env.GITHUB_REF_TYPE as string
  const refName = process.env.GITHUB_REF_NAME as string
  const currentSha = process.env.GITHUB_SHA as string

  if (refType !== 'branch') {
    return false
  }

  await git.fetch({
    deepen: 1,
    remote: 'origin',
    refSpec: refName
  })

  const remoteRefSha = await git.resolveRef(`origin/${refName}`)
  return remoteRefSha === currentSha
}

async function detectVersions(): Promise<void> {
  // Read inputs
  const fetchDepth: number = parseInt(core.getInput('fetch-depth'))
  const canonize: boolean = core.getBooleanInput('canonize')

  await prepareRepository(fetchDepth)

  const isRemoteLatestCommit = await isBranchHead()

  const latestTag = await git.latestVersionTag()
  const latestSha = await git.resolveRef(latestTag)
  let latestVersion = sanitizeVersion(latestTag)

  const prevTag = await git.previousTag()
  const prevSha = await git.resolveRef(prevTag)
  let prevVersion = sanitizeVersion(prevTag)

  const curSha = await git.resolveRef('HEAD')
  let curTag = ''
  let curVersion = ''
  try {
    curTag = await git.currentTag()
    curVersion = sanitizeVersion(curTag)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    core.notice(
      `Current commit seems to have no tag. Version number will be generated.\n${error.message}`
    )
    curVersion = await genDevVersion(prevVersion, prevTag)
  }

  // Canonize version number so it always has <major>.<minor>.<patch> format
  if (canonize) {
    if (curTag) {
      curVersion = canonizeVersion(curVersion)
    }
    if (prevTag) {
      prevVersion = canonizeVersion(prevVersion)
    }
    if (latestTag) {
      latestVersion = canonizeVersion(latestVersion)
    }
  }

  core.debug(
    `current version: '${curVersion}'
current tag: '${curTag}'

previous version: '${prevVersion}'
previous tag: '${prevTag}'

latest version: '${latestVersion}'
latest tag: '${latestTag}'
`
  )

  core.setOutput('current-version', curVersion)
  core.setOutput('current-tag', curTag)
  core.setOutput('current-sha', curSha)

  core.setOutput('previous-version', prevVersion)
  core.setOutput('previous-tag', prevTag)
  core.setOutput('previous-sha', prevSha)

  core.setOutput('latest-tag', latestTag)
  core.setOutput('latest-sha', latestSha)
  core.setOutput('latest-version', latestVersion)

  core.setOutput('is-branch-head', isRemoteLatestCommit)
}

async function run(): Promise<void> {
  try {
    await detectVersions()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      return
    }

    throw error
  }
}

run()
