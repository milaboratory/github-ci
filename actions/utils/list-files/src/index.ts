import * as core from '@actions/core';
import * as glob from '@actions/glob';

async function run(): Promise<void> {
  try {
    const patterns: string = core.getInput('patterns', { required: true });
    const followSymbolicLinks: boolean =
      core.getInput('follow-symbolic-links').toUpperCase() !== 'FALSE';
    const globOptions = { followSymbolicLinks };

    const globber = await glob.create(patterns, globOptions);

    // Initialize an array to collect files
    const files: string[] = [];

    // Using async iterator to process files one by one
    for await (const file of globber.globGenerator()) {
      console.log(`Processing file: ${file}`);
      files.push(file);
    }

    console.log(`Found files: ${files.join(', ')}`);

    core.setOutput('files', files.join('\n'));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

run();
