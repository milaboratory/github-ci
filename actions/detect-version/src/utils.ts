import {git, version} from 'milib'

// <tag name> -> <version>
export interface versionsMap {
  [key: string]: version.versionInfo
}

/**
 * Get map of version numbers in git repository:
 *  <tag name> -> <parsed version info>
 */
export async function getVersions(): Promise<versionsMap> {
  const tagsResult = await git.tag({list: true})
  const tags = tagsResult.split('\n')

  const result = {} as versionsMap

  for (const tag of tags) {
    let v = tag
    if (tag.startsWith('v')) {
      v = tag.slice(1) // cut 'v' prefix
    }

    result[tag] = version.parse(v)
  }

  return result
}

export function latestVersionTag(v: versionsMap): string {
  const versionsList = Object.entries(v)

  // Sort the list by values
  versionsList.sort((a, b) => version.compare(a[1], b[1]))

  // Get the tag name of the latest version
  return versionsList[versionsList.length - 1][0]
}

/**
 * Check if action was started from branch AND current commit is
 * repository's branch head.
 */
export async function isBranchHead(): Promise<boolean> {
  const refType = process.env.GITHUB_REF_TYPE as string
  const currentSha = process.env.GITHUB_SHA as string
  const eventName = process.env.GITHUB_EVENT_NAME as string
  let refName

  if (refType !== 'branch') {
    return false
  }

  if (eventName === 'pull_request') {
    // For pull requests get refName form the head ref or source branch
    refName = process.env.GITHUB_HEAD_REF
  } else {
    refName = process.env.GITHUB_REF_NAME
  }

  await git.fetch({
    deepen: 1,
    remote: 'origin',
    refSpec: refName
  })

  const remoteRefSha = await git.resolveRef(`origin/${refName}`)
  return remoteRefSha === currentSha
}

/**
 * Check if current version is the latest known modification of the major verison.
 * Returns 'true' when 1.3.12 is the latest known modification of v1 even if
 * 2.12.1, 3.0.0 and other higher versions exist in list.
 */
export function isLatestMajor(
  knownVersions: versionsMap,
  current: version.versionInfo
): boolean {
  const allVersions = Object.values(knownVersions)
  allVersions.sort(version.compare)

  for (let i = allVersions.length - 1; i >= 0; i--) {
    const v = allVersions[i]
    if (v.major === current.major) {
      return version.compare(v, current) === 0
    }
  }
  return false
}
