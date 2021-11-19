/**
 * Converts shortened version number to its canonical 'semver' version:
 *        1 -> 1.0.0
 *     2.25 -> 2.25.0
 *   4.3.12 -> 4.3.12
 *
 * @param version
 * @throws Error when <version> can't be canonized
 */
export function canonizeVersion(version: string): string {
  const matches = version.match('^[0-9](\\.[0-9]+){0,2}$')

  if (matches === null) {
    throw Error(
      `'${version}' does not look like version number and can't thus be canonized`
    )
  }

  const parts = version.split('.')
  for (let i = parts.length; i < 3; i++) {
    parts[i] = '0'
  }

  return parts.join('.')
}

export function countOccurrences(str: string, substr: string): number {
  let index = 0
  let startIndex = 0
  const searchStrLen = substr.length

  if (searchStrLen === 0) {
    return 0
  }

  let count = 0

  while ((index = str.indexOf(substr, startIndex)) > -1) {
    count = count + 1
    startIndex = index + searchStrLen
  }

  return count
}
