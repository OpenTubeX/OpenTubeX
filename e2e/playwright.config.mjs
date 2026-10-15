import { defineConfig } from '@playwright/test'

const useFixtures = !!process.env.E2E_USE_FIXTURES
const record = !!process.env.E2E_RECORD
// Performance checks live in *-performance.spec.mjs files or carry the tag.
const performanceTests = [/-performance\.spec\.mjs/, /@performance/]

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.mjs',
  outputDir: './results',
  fullyParallel: true,
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  // Electron windows share the CI X server, so parallel pointer input can
  // move another test's cursor and interrupt drags or auto-hide timers.
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'offline',
      testMatch: 'offline/**/*.spec.mjs',
      grepInvert: performanceTests
    },
    // Layout, scrolling and measurement checks tagged @scale also run at a
    // fractional downscale and upscale. See the uiScale fixture option.
    ...[95, 125].map(uiScale => ({
      name: `offline-${uiScale}`,
      testMatch: 'offline/**/*.spec.mjs',
      grep: /@scale/,
      grepInvert: performanceTests,
      use: { uiScale }
    })),
    {
      // Tracing would distort the measurements.
      name: 'performance',
      workers: 1,
      testMatch: 'offline/**/*.spec.mjs',
      grep: performanceTests,
      use: { trace: 'off' }
    },
    {
      name: 'browser',
      testMatch: 'browser/**/*.spec.mjs'
    },
    {
      name: 'network',
      testMatch: 'network/**/*.spec.mjs',
      timeout: 120_000,
      // First attempt talks to the real YouTube servers. If that fails
      // (e.g. bot checks on CI runners), the retry replays recorded fixtures.
      retries: useFixtures || record ? 0 : 1
    }
  ]
})
