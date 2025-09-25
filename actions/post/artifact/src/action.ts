import * as core from "@actions/core";
import * as util from "./util";

const STATE_ARTIFACT_STATE = "post_artifact_state";

export async function runMain(): Promise<void> {
  const name = core.getInput("name", { required: true });
  const path = core.getInput("path", { required: false });
  const glob = core.getInput("glob", { required: false });

  const createArchive =
    core.getInput("archive", { required: false }) === "true";
  const retentionDays =
    Number(core.getInput("retention-days", { required: false })) ?? 5;

  if (!path && !glob) {
    core.setFailed(`'path' or 'glob' inputs are required`);
    return;
  }
  if (path && glob) {
    core.setFailed(`'path' and 'glob' inputs cannot be used together`);
    return;
  }

  core.saveState(STATE_ARTIFACT_STATE, {
    name,
    path,
    glob,
    createArchive,
    retentionDays,
  });

  core.info(
    "Registered post-step artifact upload to be executed after the job.",
  );
}

export async function runPost(): Promise<void> {
  const { name, path, glob, createArchive, retentionDays } = JSON.parse(
    core.getState(STATE_ARTIFACT_STATE),
  );
  if (!name) {
    core.info("Empty artifact name. Nowhere to upload");
    return;
  }
  if (!path && !glob) {
    core.info("Empty path. Nothing to upload.");
    return;
  }

  let toUpload: string[];
  if (path) {
    const lines = path.split("\n").map((p: string) => p.trim()).filter((p: string) => p !== "")
    // No need to expand paths to files if we tar all of them
    toUpload = createArchive ? lines : await util.expandPaths(lines);
  } else {
    toUpload = await util.expandGlob(glob);
  }

  if (toUpload.length === 0) {
    core.info("No files to upload. Nothing to do.");
    return;
  }

  core.startGroup(`Running post-step artifact upload: name=${name}`);
  try {
    await util.uploadArtifact(name, toUpload, createArchive, retentionDays);
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
    else core.setFailed("An unknown error occurred");
  }
}

run();
