/**
 * Get version number from current Action Context
 */
function generateVersionFromCtx(): string {
  const refName: string = process.env.GITHUB_REF_NAME as string // github.context does not support this data yet

  if (refName.startsWith('v')) {
    return refName.substring(1) // v1.0.1 -> 1.0.1
  }

  return refName
}

export default generateVersionFromCtx
