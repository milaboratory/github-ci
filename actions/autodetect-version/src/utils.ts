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
