import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'

// Get the package name and version from package.json located at the given path.
function getPackageJSON(packagePath: string): {name: string; version: string} {
  const fullPath = path.join(packagePath, 'package.json')

  if (!fs.existsSync(fullPath)) {
    throw new Error(`package.json not found at path: ${fullPath}`)
  }

  const rawData = fs.readFileSync(fullPath, 'utf-8')
  const packageJson = JSON.parse(rawData)

  if (!packageJson.name || !packageJson.version) {
    throw new Error(
      'package.json must contain both name and version properties.'
    )
  }

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
    const fetchUrl = `${npmRegistryUrl}/${packageName}/v/${packageVersion}`
    console.log(`Fetching: ${fetchUrl}`)

    const response = await fetch(fetchUrl)

    if (response.ok) {
      core.setOutput('exists', '1')
      console.log(`Package ${packageName}@${packageVersion} found in registry.`)
    } else if (response.status === 404) {
      core.setOutput('exists', '0')
      console.log(
        `Package ${packageName}@${packageVersion} not found in registry.`
      )
    } else {
      throw new Error(
        `Unexpected response: ${response.statusText}, status code: ${response.status}`
      )
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
