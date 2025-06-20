import * as core from '@actions/core';
import * as github from '@actions/github';
import { git } from '@milaboratories/github-ci-actions-milib';

async function run(): Promise<void> {
  try {
    // Get inputs
    const token = core.getInput('token', { required: true });
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
    core.debug(`Changed files:\n  - ${changedFiles.join('\n  - ')}`);

    // Filter out ignored files using regex patterns
    const filesToReview = changedFiles.filter(file => {
      return !ignoreRegex.test(file);
    });

    core.debug(`Review required for files:\n  - ${filesToReview.join('\n  - ')}`);

    if (filesToReview.length === 0) {
      core.info('No files to review after applying ignore patterns');
      return;
    }

    // Get PR reviews
    const octokit = github.getOctokit(token);
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: prNumber
    });

    core.debug(`Reviews: ${JSON.stringify(reviews)}`);

    const approvals = reviews.filter(review => review.state === 'APPROVED').length;

    if (approvals === 0) {
      const filesToShow = filesToReview.slice(0, 15);
      const remainingCount = filesToReview.length - filesToShow.length;
      const fileList = filesToShow.join('\n  - ');
      const remainingMessage = remainingCount > 0 ? `\n  ... and ${remainingCount} more files` : '';
      core.error(`List of files that require review:\n  - ${fileList}${remainingMessage}`);
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
