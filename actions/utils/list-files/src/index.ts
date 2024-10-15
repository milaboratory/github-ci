import * as core from '@actions/core';
import * as glob from '@actions/glob';

async function run(): Promise<void> {
  try {
    const patterns: string = core.getInput('patterns', { required: true });
    const followSymbolicLinks: boolean =
      core.getInput('follow-symbolic-links').toUpperCase() !== 'FALSE';
    const excludeHiddenFiles: boolean =
      core.getInput('exclude-hidden-files').toUpperCase() !== 'FALSE';

    const globOptions: glob.GlobOptions = {
      followSymbolicLinks,
      excludeHiddenFiles,
    };

    const globber = await glob.create(patterns, globOptions);

    // Initialize an array to collect paths
    const matchedPaths: string[] = [];

    // Using async iterator to process paths one by one
    for await (const file of globber.globGenerator()) {
      console.log(`Processing file: ${file}`);
      matchedPaths.push(file);
    }

    console.log(`Found paths: ${matchedPaths.join(', ')}`);

    core.setOutput('paths', matchedPaths.join('\n'));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

run();
