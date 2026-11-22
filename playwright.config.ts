import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173/web-toolbox/', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testMatch: ['smoke.spec.ts', 'ip-address-layout.spec.ts', 'image-converter.spec.ts'],
      use: {
        ...devices['Desktop Firefox'],
        ...(process.env.WEB_TOOLBOX_E2E_CONTAINER === '1'
          ? {
              launchOptions: {
                env: {
                  ...process.env,
                  MOZ_DISABLE_CONTENT_SANDBOX: '1',
                  MOZ_DISABLE_RDD_SANDBOX: '1',
                },
              },
            }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/web-toolbox/',
    reuseExistingServer: false,
  },
});
