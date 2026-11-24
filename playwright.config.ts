import { defineConfig, devices } from '@playwright/test';

/**
 * Each browser gets its own server and empty database. Its `install` project runs the install flow first, in
 * order; the other specs sign in with the account it creates and only start once it has passed.
 */
const targets = [
  { name: 'chromium', device: devices['Desktop Chrome'], port: 4101 },
  { name: 'firefox', device: devices['Desktop Firefox'], port: 4102 },
  { name: 'webkit', device: devices['Desktop Safari'], port: 4103 },
  { name: 'mobile', device: devices['Pixel 7'], port: 4104 },
  { name: 'tablet', device: devices['iPad Mini'], port: 4105 },
];

const only = process.env.E2E_PROJECTS?.split(',').map((name) => name.trim());
const selected = only ? targets.filter((target) => only.includes(target.name)) : targets;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // The tests share one database per browser and run in order: a retry would start over on an installed instance.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: selected.flatMap((target) => {
    const use = { ...target.device, baseURL: `http://127.0.0.1:${target.port}`, locale: 'en-US' };
    return [
      { name: `${target.name}-install`, testMatch: 'install.e2e.ts', use },
      { name: target.name, testIgnore: 'install.e2e.ts', dependencies: [`${target.name}-install`], use },
    ];
  }),
  webServer: selected.map((target) => ({
    command: `bun e2e/serve.ts almanach_e2e_${target.name} ${target.port}`,
    url: `http://127.0.0.1:${target.port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
});
