import * as core from '@actions/core'

import {canonizeVersion} from './utils'
import generateVersionFromCtx from './context'
import generateVersionFromGit from './git'

async function generateVersion(): Promise<void> {
  // Read inputs
  const fetchDepth: number = parseInt(core.getInput('fetch-depth'))
  const canonize: boolean = core.getBooleanInput('canonize')
  const appendHash: boolean = core.getBooleanInput('append-hash')
  const appendBuildID: boolean = core.getBooleanInput('append-build-id')

  // Initialize storage for evaluated version
  let version = ''

  const refType: string = process.env.GITHUB_REF_TYPE as string // github.context does not support this data yet
  if (refType === 'tag') {
    version = generateVersionFromCtx()
  }

  if (version === '') {
    // We failed to get version number from Action Context here.
    // Generate version number from current git repository state.
    version = await generateVersionFromGit(fetchDepth)
  }

  // Canonize version number to always have <major>.<minor>.<bugfix> format
  if (canonize) {
    version = canonizeVersion(version)
  }

  // Append either build ID or commit hash if requested.
  // Never do both to keep version length short.
  // We can identify exact commit by any of this strings.
  if (appendBuildID) {
    const runID: string = process.env.GITHUB_RUN_ID as string
    version = `${version}-${runID}`
  } else if (appendHash) {
    const sha: string = process.env.GITHUB_SHA as string
    version = `${version}-${sha.substring(0, 6)}`
  }

  core.setOutput('version', version)
}

async function run(): Promise<void> {
  try {
    return generateVersion()
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
