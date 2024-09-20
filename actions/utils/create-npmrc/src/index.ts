import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

async function run(): Promise<void> {
  try {
    const configInput = core.getInput('npmrcConfig');
    const config = JSON.parse(configInput);

    const workspacePath = process.env.GITHUB_WORKSPACE;
    if (!workspacePath) {
      throw new Error('GITHUB_WORKSPACE not defined');
    }

    const npmrcPath = path.join(workspacePath, '.npmrc');
    let npmrcContent = '';

    Object.entries(config.registries).forEach(([registryUrl, scopes]) => {
      Object.entries(scopes as Record<string, string>).forEach(([scope, tokenVar]) => {
        npmrcContent += `@${scope}:registry=${registryUrl}\n`;
        const registryURL = new URL(registryUrl);
        npmrcContent += `//${registryURL.hostname}/${scope}/:_authToken=${process.env[tokenVar]}\n`;
      });
    });

    fs.writeFileSync(npmrcPath, npmrcContent);

    core.setOutput('npmrcPath', npmrcPath);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

run();
