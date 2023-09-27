import * as core from '@actions/core'
import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import JSZip from 'jszip'
import {createGzip} from 'zlib'
import {createWriteStream} from 'fs'
import tar from 'tar-stream'

// Helpers

// Path Normalization
function sanitizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/^(\.\.\\])+/, '')
}
// Pattern Sanitization
function sanitizePattern(pattern: string): string {
  return pattern.replace(/[^a-zA-Z0-9*_.-]/g, '')
}

// Checks if a given filename matches any pattern in a list of patterns.
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
// Recursively retrieves all files from a directory.
async function getAllFilesFromDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true})
  let files = entries
    .filter(file => !file.isDirectory())
    .map(file => {
      const filePath = path.join(dir, file.name)
      console.log(`Processing file: ${filePath}`)
      return filePath
    })
  const directories = entries.filter(directory => directory.isDirectory())
  for (const directory of directories) {
    files = files.concat(
      await getAllFilesFromDir(path.join(dir, directory.name))
    )
  }
  return files
}
// Verifies that required GitHub Action inputs are provided.
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

// Create zip archive of the provided files.
async function createZipArchive(files: string[], archiveName: string) {
  const zip = new JSZip()

  for (const file of files) {
    const relativePath = path.relative(process.cwd(), file)
    if ((await fs.stat(file)).isDirectory()) {
      console.log(`Adding directory to zip archive: ${relativePath}`)
      zip.folder(relativePath)
    } else {
      console.log(`Adding file to zip archive: ${relativePath}`)
      const data = await fs.readFile(file)
      zip.file(relativePath, data)
    }
  }

  const content = await zip.generateAsync({type: 'nodebuffer'})
  await fs.writeFile(archiveName, content)
}
// Creates a tar.gz archive of the provided files.
async function createTarGzArchive(files: string[], archiveName: string) {
  const pack = tar.pack()

  for (const file of files) {
    const relativePath = path.relative(process.cwd(), file)
    const linkStat = await fs.lstat(file)
    const permissions = linkStat.mode & 0o777

    if (linkStat.isDirectory()) {
      console.log(`Adding directory to tar.gz archive: ${relativePath}`)
      pack.entry({name: relativePath, type: 'directory', mode: permissions})
    } else if (linkStat.isSymbolicLink()) {
      const target = await fs.readlink(file)
      console.log(
        `Adding symlink to tar.gz archive: ${relativePath} -> ${target}`
      )
      pack.entry({
        name: relativePath,
        type: 'symlink',
        mode: permissions,
        linkname: target
      })
    } else {
      console.log(`Adding file to tar.gz archive: ${relativePath}`)
      pack.entry(
        {name: relativePath, mode: permissions},
        await fs.readFile(file)
      )
    }
  }

  pack.finalize()
  const output = createWriteStream(archiveName)
  const gzip = createGzip()
  pack.pipe(gzip).pipe(output)
}

async function main(): Promise<void> {
  checkRequiredInputs(['source-files']) // Adjust required fields as needed.

  const rawSourceFiles = core
    .getInput('source-files')
    .split('\n')
    .map(item => sanitizePath(item.trim()))
  const includePatterns = core
    .getInput('include-patterns')
    .split('\n')
    .map(item => sanitizePattern(item.trim()))
  const excludePatterns = core
    .getInput('exclude-patterns')
    .split('\n')
    .map(item => sanitizePattern(item.trim()))

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
      matchFilename(path.basename(file), includePatterns) &&
      !matchFilename(path.basename(file), excludePatterns)
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
