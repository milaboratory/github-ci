import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

interface NpmRegistryConfig {
  scopes: string[];
  tokenVar: string;
}

interface NpmConfig {
  registries: Record<string, NpmRegistryConfig>;
}

async function run(): Promise<void> {
  try {
    const configInput = core.getInput('npmrcConfig');
    const append = core.getInput('append') === 'true';
    const config: NpmConfig = JSON.parse(configInput); // Now TypeScript knows the structure of `config`

    const workspacePath = process.env.GITHUB_WORKSPACE;
    if (!workspacePath) {
      throw new Error('GITHUB_WORKSPACE not defined');
    }

    const npmrcPath = path.join(workspacePath, '.npmrc');
    let npmrcContent = '';

    // Iterate over each registry in the configuration
    for (const [registryUrl, { scopes, tokenVar }] of Object.entries(config.registries)) {
      const registryURL = new URL(registryUrl);
      // always-auth and token settings for the registry
      npmrcContent += `//${registryURL.hostname}/:always-auth=true\n`;
      npmrcContent += `//${registryURL.hostname}/:_authToken=\${${tokenVar}}\n`;

      // Add registry setting for each scope
      scopes.forEach((scope: string) => {
        // Explicitly declare the type of 'scope'
        npmrcContent += `@${scope}:registry=${registryUrl}\n`;
      });
    }

    // Write to the .npmrc file, appending if specified, overwriting otherwise
    if (append) {
      // Check if the existing file ends with a newline and append accordingly
      const existingContent = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '';
      if (existingContent && !existingContent.endsWith('\n')) {
        npmrcContent = '\n' + npmrcContent; // Prepend a newline if the existing content does not end with one
      }
      fs.appendFileSync(npmrcPath, npmrcContent);
    } else {
      fs.writeFileSync(npmrcPath, npmrcContent);
    }

    core.setOutput('npmrcPath', npmrcPath);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

run();
