import * as core from '@actions/core';
import * as github from '@actions/github';
import { git } from '@milaboratories/github-ci-actions-milib';

async function run(): Promise<void> {
  try {
    // Get inputs
    const baseBranch = core.getInput('baseBranch', { required: true });
    const ignorePatterns = core.getInput('ignore')
      .split('\n')
      .map(pattern => pattern.trim())
      .filter(pattern => pattern.length > 0);

    const ignoreRegex = new RegExp(`(${ignorePatterns.join(')|(')})`);

    // Get PR number
    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      core.setFailed('This action must be run in a pull request context');
      return;
    }

    // Get changed files
    const changedFiles = await git.getChangedFiles(`origin/${baseBranch}...HEAD`);
    core.debug(`Changed files: ${changedFiles.join('\n')}`);
    
    // Filter out ignored files using regex patterns
    const filesToReview = changedFiles.filter(file => {
      return !ignoreRegex.test(file);
    });

    if (filesToReview.length === 0) {
      core.info('No files to review after applying ignore patterns');
      return;
    }

    // Get PR reviews
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN || '');
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: prNumber
    });

    const approvals = reviews.filter(review => review.state === 'APPROVED').length;

    if (approvals === 0) {
      core.setFailed('PR requires at least one approval');
      return;
    }

    core.info(`PR has ${approvals} approval(s)`);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run(); 
