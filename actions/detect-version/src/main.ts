import * as core from '@actions/core'

import * as utils from './utils'
import {git, version} from 'milib'

async function prepareRepository(depth: number): Promise<void> {
  // We have to do black magic here because of
  // https://github.com/milaboratory/github-ci/issues/13
  const refType: string = process.env.GITHUB_REF_TYPE as string
  const refName: string = process.env.GITHUB_REF_NAME as string

  if (refType === 'tag') {
    // force-fetch current tag from origin
    await git.fetch({
      remote: 'origin',
      refSpec: `refs/tags/${refName}:refs/tags/${refName}`,
      deepen: 1,
      forceFlag: true
    })
  }

  await git.fetchTags()
  return git.ensureHistorySize(depth)
}

async function genDevVersion(
  baseVersion: version.versionInfo,
  baseRef: string
): Promise<version.versionInfo> {
  const currentRefName = process.env.GITHUB_REF_NAME as string
  const count = await git.countCommits(baseRef, 'HEAD')

  return {
    major: baseVersion.major,
    minor: baseVersion.minor,
    patch: baseVersion.patch,
    suffix: `${count}-${currentRefName}`,
    original: `${baseVersion.original}-${count}-${currentRefName}`,
    semver: true
  } as version.versionInfo
}

async function detectVersions(): Promise<void> {
  // Read inputs
  const fetchDepth: number = parseInt(core.getInput('fetch-depth'))

  await prepareRepository(fetchDepth)

  const isRemoteLatestCommit = await utils.isBranchHead()

  const knownVersions = await utils.getVersions()

  const latestTag = utils.latestVersionTag(knownVersions)
  const latestSha = await git.resolveRef(latestTag)
  const latestVersion = knownVersions[latestTag]

  const prevTag = await git.previousTag()
  const prevSha = await git.resolveRef(prevTag)
  const prevVersion = knownVersions[prevTag]

  const curSha = await git.resolveRef('HEAD')
  let curTag = ''
  let curVersion: version.versionInfo
  try {
    curTag = await git.currentTag()
    curVersion = knownVersions[curTag]
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    core.notice(
      `Current commit seems to have no tag. Version number will be generated.\n${error.message}`
    )
    curVersion = await genDevVersion(prevVersion, prevTag)
  }

  core.debug(
    `current version: '${curVersion.original}'
current tag: '${curTag}'

previous version: '${prevVersion.original}'
previous tag: '${prevTag}'

latest version: '${latestVersion.original}'
latest tag: '${latestTag}'
`
  )

  core.setOutput('current-version', version.toString(curVersion))
  core.setOutput('current-tag', curTag)
  core.setOutput('current-sha', curSha)

  core.setOutput('previous-version', version.toString(prevVersion))
  core.setOutput('previous-tag', prevTag)
  core.setOutput('previous-sha', prevSha)

  core.setOutput('latest-version', version.toString(latestVersion))
  core.setOutput('latest-tag', latestTag)
  core.setOutput('latest-sha', latestSha)

  core.setOutput('is-release', curTag !== '')
  core.setOutput('is-branch-head', isRemoteLatestCommit)
  core.setOutput(
    'is-latest-version',
    version.compare(latestVersion, curVersion) === 0
  )
  core.setOutput(
    'is-latest-major',
    utils.isLatestMajor(knownVersions, curVersion)
  )
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
