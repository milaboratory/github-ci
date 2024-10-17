import * as core from '@actions/core';
import * as glob from '@actions/glob';
import path from 'path';
import fs from 'fs';

function readInputBool(name: string): boolean {
  return core.getInput(name).toUpperCase() === 'TRUE';
}

async function run(): Promise<void> {
  try {
    const patterns: string = core.getInput('patterns', { required: true });
    const targetFile: string = core.getInput('target-file', { required: false });
    const followSymbolicLinks: boolean = readInputBool('follow-symbolic-links');
    const excludeHiddenFiles: boolean = readInputBool('exclude-hidden-files');
    const relative: boolean = readInputBool('relative');
    const matchDirectories: boolean = readInputBool('match-directories');
    const implicitDescendants: boolean = readInputBool('implicit-descendants');

    const globOptions: glob.GlobOptions = {
      followSymbolicLinks,
      excludeHiddenFiles,
      matchDirectories,
      implicitDescendants,
    };

    const globber = await glob.create(patterns, globOptions);

    var lines: number
    if (targetFile !== "") {
      console.log(`Found paths:\n`)
      lines = await writeToFile(globber.globGenerator(), targetFile, relative)

      core.setOutput('paths', '');
      core.setOutput('file', targetFile)

    } else {
      const matchedPaths = await writeToArray(globber.globGenerator(), relative)
      lines = matchedPaths.length
      console.log(`Found paths:\n\t${matchedPaths.join('\n\t')}`);

      core.setOutput('paths', matchedPaths.join('\n'));
      core.setOutput('file', '')
    }

    core.setOutput('has-matches', lines > 0);
    core.setOutput('is-empty', lines === 0);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

function transformPath(p: string, relative: boolean): string {
  if (relative) {
    return `.${path.sep}${path.relative('.', p)}`
  }

  return p
}

async function writeToFile(items: AsyncGenerator<string, void>, filePath: string, relative: boolean): Promise<number> {
  const fileStream = fs.createWriteStream(filePath, { flags: 'a' });
  var linesCount: number = 0
  try {
    for await (const item of items) {
      const p = transformPath(item, relative)
      if (!fileStream.write(`${p}\n`)) {
        await new Promise<void>((resolve) => fileStream.once('drain', resolve));
      }
      linesCount++
      console.log(`\t${p}`)
    }
  } finally {
    fileStream.end();
  }

  return linesCount
}

async function writeToArray(items: AsyncGenerator<string, void>, relative: boolean): Promise<string[]> {
  const result: string[] = [];

  for await (const item of items) {
    result.push(transformPath(item, relative))
  }

  return result
}

run();
