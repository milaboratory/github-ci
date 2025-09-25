import * as core from '@actions/core';
import { spawn } from 'node:child_process';

const STATE_KEY = 'post_run_command';

async function runMain(): Promise<void> {
  const script = core.getInput('run', { required: true });
  core.saveState(STATE_KEY, script);
  core.info('Registered post-step script to be executed after the job.');
}

function execBash(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { stdio: 'inherit' });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Post-step command exited with code ${code}`));
    });
  });
}

async function runPost(): Promise<void> {
  const script = core.getState(STATE_KEY);
  if (!script) {
    core.info('No post-step script found. Nothing to do.');
    return;
  }
  core.startGroup('Running post-step script');
  try {
    await execBash(script);
  } finally {
    core.endGroup();
  }
}

async function run(): Promise<void> {
  try {
    // If state is available, we are in the post execution
    if (core.getState(STATE_KEY)) {
      await runPost();
    } else {
      await runMain();
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed('An unknown error occurred');
  }
}

run();
