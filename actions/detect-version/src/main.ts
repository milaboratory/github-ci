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

async function detectVersions(): Promise<void> {
  // Read inputs
  const fetchDepth: number = parseInt(core.getInput('fetch-depth'))
  const canonize: boolean = core.getBooleanInput('canonize')

  await prepareRepository(fetchDepth)

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
  }

  core.debug(
    `current version: '${curVersion}'
current tag: '${curTag}'
previous version: '${prevVersion}'
previous tag: '${prevTag}'`
  )

  core.setOutput('version', curVersion)
  core.setOutput('tag', curTag)
  core.setOutput('sha', curSha)
  core.setOutput('prev-version', prevVersion)
  core.setOutput('prev-tag', prevTag)
  core.setOutput('prev-sha', prevSha)
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