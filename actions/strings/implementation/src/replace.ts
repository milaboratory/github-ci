import * as core from '@actions/core'

async function replace(): Promise<void> {
  // Read inputs
  const inputStr: string = core.getInput('input')
  // const rulesStr: string = core.getInput('replace-rules')

  core.setOutput('result', inputStr)
}

async function run(): Promise<void> {
  try {
    await replace()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      return
    }

    throw error
  }
}

run()
