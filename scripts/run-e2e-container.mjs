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
const isHelpCommand = args.some((argument) => ['--help', '-h'].includes(argument));
if (!isHelpCommand) {
  const headed = args.includes('--headed');
  const installArgs = ['install', headed ? '--no-shell' : '--only-shell', 'chromium', 'firefox'];
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
