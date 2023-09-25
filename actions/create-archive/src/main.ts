import * as core from '@actions/core'
import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import JSZip from 'jszip'
import {createGzip} from 'zlib'
import {createWriteStream, createReadStream} from 'fs'
import tar from 'tar-stream'

// Helpers
function matchFilename(filename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const escapeRegex = (string: string) =>
      string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp(
      '^' + pattern.split(/\*+/).map(escapeRegex).join('.*') + '$'
    )
    if (regex.test(filename)) {
      return true
    }
  }
  return false
}

async function getAllFilesFromDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true})
  let files = entries
    .filter(file => !file.isDirectory())
    .map(file => path.join(dir, file.name))
  const directories = entries.filter(directory => directory.isDirectory())
  for (const directory of directories) {
    files = files.concat(
      await getAllFilesFromDir(path.join(dir, directory.name))
    )
  }
  return files
}

function checkRequiredInputs(requiredInputs: string[]): void {
  for (const input of requiredInputs) {
    const value = core.getInput(input)
    if (!value) {
      console.error(`Error: Required input ${input} is missing.`)
      core.setFailed(`Error: Required input ${input} is missing.`)
      process.exit(1)
    }
  }
}

// ZIP logic
async function createZipArchive(files: string[], archiveName: string) {
  const zip = new JSZip()

  for (const file of files) {
    const data = await fs.readFile(file)
    zip.file(path.basename(file), data)
  }

  const content = await zip.generateAsync({type: 'nodebuffer'})
  await fs.writeFile(archiveName, content)
}

// TAR.GZ logic
async function createTarGzArchive(files: string[], archiveName: string) {
  const pack = tar.pack()
  const output = createWriteStream(archiveName)
  const gzip = createGzip()

  for (const file of files) {
    const fileStream = createReadStream(file)
    pack.entry({name: path.basename(file)}, await fs.readFile(file))
  }

  pack.finalize()
  pack.pipe(gzip).pipe(output)
}

async function main(): Promise<void> {
  checkRequiredInputs(['source_files']) // Adjust required fields as needed.

  const rawSourceFiles = core
    .getInput('source-files')
    .split('\n')
    .map(item => item.trim())
  const includePatterns = core
    .getInput('include-patterns')
    .split('\n')
    .map(item => item.trim())
  const excludePatterns = core
    .getInput('exclude-patterns')
    .split('\n')
    .map(item => item.trim())

  let allFiles: string[] = []
  for (const entry of rawSourceFiles) {
    try {
      const stats = await fs.stat(entry)
      if (stats.isFile()) {
        allFiles.push(entry)
      } else if (stats.isDirectory()) {
        const filesFromDir = await getAllFilesFromDir(entry)
        allFiles = allFiles.concat(filesFromDir)
      }
    } catch (error) {
      if (error instanceof Error) {
        console.warn(
          `Warning: Couldn't process entry "${entry}": ${error.message}`
        )
      }
    }
  }

  const filteredFiles = allFiles.filter(
    file =>
      matchFilename(file, includePatterns) &&
      !matchFilename(file, excludePatterns)
  )

  const archiveName = core.getInput('archive-name') || 'archive.tgz'

  // OS-based archiving
  const platform = os.platform()

  if (platform === 'win32') {
    console.log('Detected OS: Windows')
    await createZipArchive(filteredFiles, archiveName)
  } else if (platform === 'linux' || platform === 'darwin') {
    console.log('Detected OS: Linux/MacOS')
    await createTarGzArchive(filteredFiles, archiveName)
  } else {
    console.error(`Unsupported platform: ${platform}`)
    core.setFailed(`Error: Unsupported platform ${platform}.`)
    process.exit(1)
  }
}

main().catch(error => {
  core.setFailed(error.message)
})
