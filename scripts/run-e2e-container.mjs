import { spawn } from 'node:child_process';
import { constants as osConstants, tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliPath = require.resolve('@playwright/test/cli');
const temporaryRoot = path.join(
  tmpdir(),
  `web-toolbox-playwright-container-${process.getuid?.() ?? 'user'}`,
);

const env = { ...process.env };
if (env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  env.PLAYWRIGHT_BROWSERS_PATH = path.join(temporaryRoot, 'browsers');
}
if (env.XDG_CACHE_HOME === undefined) {
  env.XDG_CACHE_HOME = path.join(temporaryRoot, 'xdg-cache');
}

await Promise.all([
  mkdir(env.PLAYWRIGHT_BROWSERS_PATH === '0' ? temporaryRoot : env.PLAYWRIGHT_BROWSERS_PATH, { recursive: true }),
  mkdir(env.XDG_CACHE_HOME, { recursive: true }),
]);

const args = process.argv.slice(2);
const optionArgs = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'));
const isHelpCommand = optionArgs.some((argument) => ['--help', '-h'].includes(argument));
let hasInvalidDebugOption = false;
let debugOptionRequestsHeaded = false;
let bareUI = false;
let hostedUI = false;
for (let index = 0; index < optionArgs.length; index += 1) {
  const argument = optionArgs[index];
  if (argument === '--debug') {
    const nextArgument = optionArgs[index + 1];
    if (nextArgument !== undefined && !nextArgument.startsWith('-')) {
      hasInvalidDebugOption ||= !['inspector', 'cli'].includes(nextArgument);
      debugOptionRequestsHeaded = nextArgument === 'inspector';
      index += 1;
    } else {
      debugOptionRequestsHeaded = true;
    }
  } else if (argument.startsWith('--debug=')) {
    const mode = argument.slice('--debug='.length);
    hasInvalidDebugOption ||= !['inspector', 'cli'].includes(mode);
    debugOptionRequestsHeaded = mode === 'inspector';
  } else if (argument === '--ui') {
    bareUI = true;
  } else if (['--ui-host', '--ui-port'].includes(argument)
    || argument.startsWith('--ui-host=')
    || argument.startsWith('--ui-port=')) {
    hostedUI = true;
  }
}
if (!isHelpCommand && !hasInvalidDebugOption) {
  const debugMode = env.PWDEBUG ?? env.npm_config_pwdebug ?? env.npm_package_config_pwdebug;
  const debugRequestsHeaded = debugMode !== undefined
    && debugMode !== ''
    && debugMode !== '0'
    && debugMode !== 'false'
    && debugMode !== 'console';
  // Playwright 1.65.1 makes inspector debug headed; bare local UI also needs Chromium while its tests stay headless.
  const headed = optionArgs.includes('--headed') || debugRequestsHeaded || (!bareUI && debugOptionRequestsHeaded);
  const localUI = bareUI && !hostedUI;
  const shellOption = headed ? '--no-shell' : localUI ? undefined : '--only-shell';
  const installArgs = ['install', ...(shellOption ? [shellOption] : []), 'chromium', 'firefox'];
  const install = spawn(process.execPath, [cliPath, ...installArgs], {
    env,
    stdio: 'inherit',
  });
  const installResult = await new Promise((resolve) => {
    install.once('error', (error) => resolve({ error }));
    install.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (installResult.error) {
    console.error(`Could not start Playwright browser installation: ${installResult.error.message}`);
    process.exit(1);
  }
  if (installResult.code !== 0) {
    process.exit(installResult.code ?? 1);
  }
}

env.WEB_TOOLBOX_E2E_CONTAINER = '1';
const test = spawn(process.execPath, [cliPath, 'test', ...args], {
  env,
  stdio: 'inherit',
});
test.once('error', (error) => {
  console.error(`Could not start Playwright: ${error.message}`);
  process.exitCode = 1;
});
test.once('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1);
});
