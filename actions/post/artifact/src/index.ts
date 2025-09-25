import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as artifact from '@actions/artifact';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_ARTIFACT_STATE = 'post_artifact_state';

async function runMain(): Promise<void> {
  const name = core.getInput('name', { required: true });
  const path = core.getInput('path', { required: true });
  const retentionDays = Number(core.getInput('retention-days', { required: false })) ?? 5;

  core.saveState(STATE_ARTIFACT_STATE, 
    {name, path, retentionDays}
  );

  core.info('Registered post-step artifact upload to be executed after the job.');
}

async function createTarArchive(files: string[], archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-c', '-f', archivePath, ...files], { stdio: 'inherit' });
    tar.on('error', err => reject(err));
    tar.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`tar command exited with code ${code}`));
    });
  });
}

async function uploadArtifact(name: string, pathPattern: string, retentionDays: number): Promise<void> {
  try {
    const globber = await glob.create(pathPattern)
    const files = await globber.glob()
    if (files.length === 0) {
      core.warning(`No files found matching pattern: ${pathPattern}`);
      return;
    }

    core.info(`Found ${files.length} files to upload:`);
    files.forEach((file) => core.info(`  ${file}`));

    // Create tar archive
    const archiveName = `artifact-${name}.tar`;
    const archivePath = path.join(process.cwd(), archiveName);
    
    core.info(`Creating tar archive: ${archivePath}`);
    await createTarArchive(files, archivePath);

    // Upload artifact
    core.info(`Uploading artifact: ${name}`);
    const artifactClient = new artifact.DefaultArtifactClient()
    const uploadResult = await artifactClient.uploadArtifact(
      name, [archivePath], process.cwd(), {
        retentionDays: retentionDays,
      }
    );
    
    core.info(`Artifact uploaded successfully. ID: ${uploadResult.id}`);
    
    // Clean up tar file
    try {
      await fs.promises.unlink(archivePath);
      core.info('Cleaned up temporary tar file');
    } catch (cleanupError) {
      core.warning(`Failed to clean up tar file: ${cleanupError}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Failed to upload artifact: ${error.message}`);
    } else {
      core.setFailed('An unknown error occurred while uploading artifact');
    }
    throw error;
  }
}

async function runPost(): Promise<void> {
  const {name, path, retentionDays} = JSON.parse(core.getState(STATE_ARTIFACT_STATE));
  if (!name) {
    core.info('Empty artifact name. Nowhere to upload');
    return;
  }
  if (!path) {
    core.info('Empty path. Nothing to upload.');
    return;
  }

  core.startGroup('Running post-step script');
  try {
    await uploadArtifact(name, path, retentionDays);
  } finally {
    core.endGroup();
  }
}

async function run(): Promise<void> {
  try {
    // If state is available, we are in the post execution
    if (core.getState(STATE_ARTIFACT_STATE)) {
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
