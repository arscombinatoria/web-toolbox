import { spawn } from 'node:child_process';
import { constants as osConstants, tmpdir } from 'node:os';
import path from 'node:path';
import { access, mkdir } from 'node:fs/promises';
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
process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH;
process.env.XDG_CACHE_HOME = env.XDG_CACHE_HOME;

const playwright = await import('@playwright/test');

await Promise.all([
  mkdir(env.PLAYWRIGHT_BROWSERS_PATH === '0' ? temporaryRoot : env.PLAYWRIGHT_BROWSERS_PATH, { recursive: true }),
  mkdir(env.XDG_CACHE_HOME, { recursive: true }),
]);

const installed = async (executablePath) => {
  try {
    await access(executablePath);
    return true;
  } catch {
    return false;
  }
};

const chromiumPath = playwright.chromium.executablePath();
const chromiumVersionDirectory = path.dirname(path.dirname(chromiumPath));
const chromiumCacheDirectory = path.dirname(chromiumVersionDirectory);
const chromiumRevision = path.basename(chromiumVersionDirectory).replace(/^chromium-/, '');
const headlessShellPath = path.join(
  chromiumCacheDirectory,
  `chromium_headless_shell-${chromiumRevision}`,
  path.relative(chromiumVersionDirectory, path.dirname(chromiumPath)),
  'chrome-headless-shell',
);

const browsersToInstall = [];
if (!(await installed(chromiumPath)) && !(await installed(headlessShellPath))) {
  browsersToInstall.push('chromium');
}
if (!(await installed(playwright.firefox.executablePath()))) {
  browsersToInstall.push('firefox');
}

if (browsersToInstall.length > 0) {
  const install = spawn(process.execPath, [cliPath, 'install', ...browsersToInstall], {
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
const test = spawn(process.execPath, [cliPath, 'test', ...process.argv.slice(2)], {
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
