import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'

// Get the package name and version from package.json located at the given path.
function getPackageJSON(packagePath: string): {name: string; version: string} {
  const fullPath = path.join(packagePath, 'package.json')
  const rawData = fs.readFileSync(fullPath, 'utf-8')
  const packageJson = JSON.parse(rawData)

  return {
    name: packageJson.name,
    version: packageJson.version
  }
}

async function main(): Promise<void> {
  try {
    // Get inputs
    const packagePath = core.getInput('package-json-path')
    const npmRegistryUrl = core.getInput('npm-registry-url')

    // Get name and version from package.json
    const {name: packageName, version: packageVersion} =
      getPackageJSON(packagePath)

    // Check if package exists in the registry
    const response = await fetch(
      `${npmRegistryUrl}/${packageName}/v/${packageVersion}`
    )

    if (response.ok) {
      core.setOutput('exists', '1')
    } else if (response.status === 404) {
      core.setOutput('exists', '0')
    } else {
      throw new Error(`Unexpected response: ${response.statusText}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred.')
    }
  }
}

main().catch(error => {
  core.setFailed(error.message)
})
