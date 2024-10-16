import * as core from '@actions/core';
import * as glob from '@actions/glob';
import path from 'path';

function readInputBool(name: string): boolean {
  return core.getInput(name).toUpperCase() === 'TRUE';
}

async function run(): Promise<void> {
  try {
    const patterns: string = core.getInput('patterns', { required: true });
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

    // Initialize an array to collect paths
    const matchedPaths: string[] = [];

    // Using async iterator to process paths one by one
    for await (const file of globber.globGenerator()) {
      console.log(`Processing file: ${file}`);
      if (relative) {
        matchedPaths.push(`.${path.sep}${path.relative('.', file)}`);
      } else {
        matchedPaths.push(file);
      }
    }

    console.log(`Found paths: ${matchedPaths.join(', ')}`);

    core.setOutput('paths', matchedPaths.join('\n'));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

run();
