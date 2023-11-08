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

async function loadBranchVersions(targetBranch: string): Promise<void> {
  const refType = process.env.GITHUB_REF_TYPE as string
  const refName = process.env.GITHUB_REF_NAME as string

  const runNumber: string = process.env.GITHUB_RUN_NUMBER as string
  const currentSha: string = await git.resolveRef('HEAD')
  const currentVersionStr = `${runNumber}-${currentSha.substring(0, 8)}`

  const currentVersion = version.parse(currentVersionStr)
  const isRelease = refType === 'branch' && refName === targetBranch
  const isBranchHead = await utils.isBranchHead()

  setOutputs({
    current: {
      v: currentVersion,
      tag: '',
      sha: currentSha
    },
    previous: {
      v: version.parse('unknown'),
      tag: '',
      sha: 'unknown'
    },
    latest: {
      v: version.parse('unknown'),
      tag: '',
      sha: 'unknown'
    },
    isRelease,
    isBranchHead,
    isLatestVersion: isBranchHead && isRelease,
    isLatestMajor: isBranchHead && isRelease
  })
}

async function loadTagVersions(depth: number): Promise<void> {
  await prepareRepository(depth)

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

  setOutputs({
    current: {
      v: curVersion,
      tag: curTag,
      sha: curSha
    },
    previous: {
      v: prevVersion,
      tag: prevTag,
      sha: prevSha
    },
    latest: {
      v: latestVersion,
      tag: latestTag,
      sha: latestSha
    },
    isRelease: curTag !== '',
    isBranchHead: await utils.isBranchHead(),
    isLatestVersion: version.compare(latestVersion, curVersion) === 0,
    isLatestMajor: utils.isLatestMajor(knownVersions, curVersion)
  })
}

interface versionInfo {
  v: version.versionInfo
  tag: string
  sha: string
}

function setOutputs(p: {
  current: versionInfo
  previous: versionInfo
  latest: versionInfo
  isRelease: boolean
  isBranchHead: boolean
  isLatestVersion: boolean
  isLatestMajor: boolean
}): void {
  core.debug(
    `current version: '${p.current.v.original}'
current tag: '${p.current.tag}'

previous version: '${p.previous.v.original}'
previous tag: '${p.previous.tag}'

latest version: '${p.latest.v.original}'
latest tag: '${p.latest.tag}'
`
  )

  core.setOutput('current-version', version.toString(p.current.v))
  core.setOutput('current-tag', p.current.tag)
  core.setOutput('current-sha', p.current.sha)

  core.setOutput('previous-version', version.toString(p.previous.v))
  core.setOutput('previous-tag', p.previous.tag)
  core.setOutput('previous-sha', p.previous.sha)

  core.setOutput('latest-version', version.toString(p.latest.v))
  core.setOutput('latest-tag', p.latest.tag)
  core.setOutput('latest-sha', p.latest.sha)

  core.setOutput('is-release', p.isRelease)
  core.setOutput('is-branch-head', p.isBranchHead)
  core.setOutput('is-latest-version', p.isLatestVersion)
  core.setOutput('is-latest-major', p.isLatestMajor)
}

async function detectVersions(): Promise<void> {
  // Read inputs
  const fetchDepth: number = parseInt(core.getInput('fetch-depth'))
  const branchVersioning: string = core.getInput('branch-versioning')

  if (branchVersioning !== '') {
    await loadBranchVersions(branchVersioning)
    return
  }

  await loadTagVersions(fetchDepth)
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
