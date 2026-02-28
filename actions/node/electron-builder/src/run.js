const path = require('path');
const { existsSync } = require('fs');

const { getInput, setFailed } = require('@actions/core');
const exec = require('@actions/exec');

// Writes a message to the console
// eslint-disable-next-line no-undef
const log = console.log.bind(console);

// Sleep function for delays between retries
// eslint-disable-next-line no-undef
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry configuration from environment variables with defaults
const RETRY_COUNT = parseInt(process.env.RETRY_COUNT || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '10000', 10); // default 10 seconds

// Retry wrapper function
async function withRetry(operation, operationName) {
  let lastError;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      log(`${operationName}: Attempt ${attempt}/${RETRY_COUNT}`);
      await operation();
      log(`${operationName}: Succeeded on attempt ${attempt}`);
      return;
    } catch (error) {
      lastError = error;
      log(`${operationName}: Failed attempt ${attempt}/${RETRY_COUNT}`);
      log(`Error: ${error.message}`);

      if (attempt < RETRY_COUNT) {
        log(`Waiting ${RETRY_DELAY / 1000} seconds before next attempt...`);
        await sleep(RETRY_DELAY);
      }
    }
  }

  throw new Error(
    `${operationName}: Failed after ${RETRY_COUNT} attempts. Last error: ${lastError.message}`,
  );
}

// Sets the specified env variable if the value isn't empty
function setEnv(name, value) {
  if (value) {
    process.env[name] = value;
  }
}

// Returns the value for an input variable, or null if it's not defined.
function getActionInput(name, required = false) {
  const value = getInput(name) || null;
  if (required && !value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}

// Executes the provided shell command and redirects stdout/stderr to the console
async function executeShellCommand(command, workingDirectory = null) {
  const originalDirectory = process.cwd();

  if (workingDirectory) {
    process.chdir(workingDirectory);
  }

  try {
    await exec.exec(command);
  } finally {
    if (workingDirectory) {
      process.chdir(originalDirectory);
    }
  }
}

function getCurrentOS() {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'Unknown';
  }
}

async function run() {
  // Log retry configuration
  log(`Retry Configuration - Count: ${RETRY_COUNT}, Delay: ${RETRY_DELAY}ms`);

  const release = getActionInput('release', true) === 'false';
  const buildScriptName = getActionInput('build-script-name', true);
  const skipBuild = getActionInput('skip-build') === 'true';
  const electronBuilderArgs = getActionInput('electron-builder-args') || '';
  const workingDirectory = getActionInput('working-directory', true);
  const githubToken = getActionInput('github-token', true);
  const packageManager = getActionInput('package-manager') || 'npm';
  const platform = getCurrentOS();
  const macosCertificate = getActionInput('macos-certs');
  const macosCertificatePassword = getActionInput('macos-certs-password');
  const windowsCertificate = getActionInput('windows-certs');
  const windowsCertificatePassword = getActionInput('windows-certs-password');

  log(`Using package manager: ${packageManager}`);

  const packageJsonPath = path.join(workingDirectory, 'package.json');

  if (!existsSync(packageJsonPath)) {
    setFailed(`package.json not found in ${workingDirectory}`);
    return;
  }

  setEnv('GH_TOKEN', githubToken);

  if (platform === 'macos') {
    setEnv('CSC_LINK', macosCertificate);
    setEnv('CSC_KEY_PASSWORD', macosCertificatePassword);
  } else if (platform === 'windows') {
    setEnv('CSC_LINK', windowsCertificate);
    setEnv('CSC_KEY_PASSWORD', windowsCertificatePassword);
  }

  setEnv('ADBLOCK', true);
  setEnv('NODE_AUTH_TOKEN', githubToken);

  // Install dependencies with retry
  const installCmd =
    packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile --prefer-offline' : 'npm ci';
  await withRetry(async () => {
    await executeShellCommand(installCmd, workingDirectory);
  }, 'Dependencies installation');

  if (!skipBuild) {
    // Build script with retry
    const buildCmd =
      packageManager === 'pnpm'
        ? `pnpm run ${buildScriptName}`
        : `npm run ${buildScriptName} --if-present`;
    await withRetry(async () => {
      await executeShellCommand(buildCmd, workingDirectory);
    }, 'Build script execution');
  } else {
    log('Skipping build script because `skip-build` option is set');
  }

  // Electron builder with retry
  const ebCmd =
    packageManager === 'pnpm'
      ? `pnpm exec electron-builder --${platform} ${release ? '--publish always' : ''} ${electronBuilderArgs}`
      : `npx --no-install electron-builder --${platform} ${release ? '--publish always' : ''} ${electronBuilderArgs}`;
  await withRetry(async () => {
    await executeShellCommand(ebCmd, workingDirectory);
  }, 'Electron builder execution');

  log('Electron application built and signed successfully');
}

run().catch((error) => setFailed(`Action failed with error: ${error}`));
