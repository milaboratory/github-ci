const { getInput, setFailed } = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const { existsSync } = require('fs');

// Writes a message to the console
function log(message) {
  console.log(message);
}

// Returns the value for an environment variable, or null if it's not defined
function getEnv(name) {
  return process.env[name] || null;
}

// Sets the specified env variable if the value isn't empty
function setEnv(name, value) {
  if (value) {
    process.env[name] = value;
  }
}

// Returns the value for an input variable, or null if it's not defined.
// If the variable is required and doesn't have a value, abort the action
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

// Determines the current operating system
function getCurrentOS() {
  switch (process.platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'Unknown';
  }
}

async function run() {
    const release = getActionInput('release', true) === 'true';
    const buildScriptName = getActionInput('build-script-name', true);
    const skipBuild = getActionInput('skip-build') === 'true';
    const electronBuilderArgs = getActionInput('electron-builder-args') || '';
    const workingDirectory = getActionInput('working-directory', true);
    const githubToken = getActionInput('github-token', true);
    const platform = getCurrentOS();
    // macOS code signing
    const macosCertificate = getActionInput('macos-certs');
    const macosCertificatePassword = getActionInput('macos-certs-password');
    // Windows code signing
    const windowsCertificate = getActionInput('windows-certs');
    const windowsCertificatePassword = getActionInput('windwos-certs-password');

    const packageJsonPath = path.join(workingDirectory, 'package.json');
    
    if (!existsSync(packageJsonPath)) {
      setFailed(`package.json not found in ${workingDirectory}`);
      return;
    }      
    // Copy "github_token" input variable to "GH_TOKEN" env variable (required by `electron-builder`)
    setEnv('GH_TOKEN', githubToken);
 
    if (platform === 'macOS') {
	setEnv('CSC_LINK', macosCertificate);
	setEnv('CSC_KEY_PASSWORD', macosCertificatePassword);
    } else if (platform === 'Windows') {
        setEnv('CSC_LINK', windowsCertificate);
        setEnv('CSC_KEY_PASSWORD', windowsCertificatePassword);
    }
    // Disable console advertisements during npm install phase
    setEnv('ADBLOCK', true);

    // Install dependencies
    log('Installing dependencies using npm');
    await executeShellCommand('npm ci', workingDirectory);

    if (skipBuild) {
       log('Skipping build script because `skip-build` option is set');
    } else {
       log('Running the build script…');
       // Set GITHUB_TOKEN as NODE_AUTH_TOKEN for npm ci to be able to download npm packages from a private repository
       // Token must have packages:read permission
       setEnv('NODE_AUTH_TOKEN', githubToken);
       executeShellCommand(`npm run ${buildScriptName} --if-present`, workingDirectory);
    }

    // Run electron-builder
    log(`Building${release ? ' and releasing' : ''} the Electron application…`);
    await executeShellCommand(`npx --no-install electron-builder --${platform} ${release ? '--publish always' : ''} ${electronBuilderArgs}`, workingDirectory);

    log('Electron application built and signed successfully');
}

try {
  run();
} catch (error) {
  setFailed(`Action failed with error: ${error}`);
}
