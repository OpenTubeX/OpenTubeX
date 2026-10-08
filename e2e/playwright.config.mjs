import { defineConfig } from '@playwright/test'

const useFixtures = !!process.env.E2E_USE_FIXTURES
const record = !!process.env.E2E_RECORD
const performanceTests = [
  /performance[^/]*\.spec\.mjs/,
  // Keep interaction coverage beside these layout/work-count assertions.
  /(?:scrollbar-overlay|inline-mini-player-drag|fullscreen-docks|channel-settings-pagination|utility-window-close|resource-lifecycle|[^/]*responsiveness)\.spec\.mjs/,
  // Select performance checks from files containing other functional tests.
  /@performance/
]

export default defineConfig({
  testDir: './tests',
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
    {
      // These tests exercise packed code, which Playwright's import-based
      // --only-changed selection cannot associate with application changes.
      name: 'performance',
      testMatch: 'offline/**/*.spec.mjs',
      grep: performanceTests,
      // Single-run absolute budgets can pick up host scheduling noise. Keep
      // recovered failures visible as flaky; the paired comparison has no retry.
      retries: 1,
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
