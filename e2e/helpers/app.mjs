import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test as base, expect, _electron as electron } from '@playwright/test'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Settings that keep tests deterministic and stop the app from phoning home
// for things unrelated to the functionality under test.
const BASE_SETTINGS = {
  backendPreference: 'local',
  backendFallback: false,
  checkForUpdates: false,
  checkForBlogPosts: false,
  externalLinkHandling: 'doNothing',
  confirmCloseApp: false,
  // Desktop-sized window so the responsive layout doesn't collapse into
  // its mobile variant (which hides the search bar, among other things).
  bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
}

/**
 * Serializes documents in the newline-delimited JSON format used by nedb.
 *
 * @param {object[]} docs
 */
function toNedbFile(docs) {
  return docs.map((doc) => JSON.stringify(doc)).join('\n') + '\n'
}

export function latestSettings(contents) {
  return Object.fromEntries(contents.trim().split('\n')
    .map(line => JSON.parse(line))
    .filter(record => record._id && !record.$$deleted)
    .map(record => [record._id, record.value]))
}

/**
 * Creates an isolated userData directory, optionally seeded with
 * settings and datastore documents.
 *
 * @param {object} [seed]
 * @param {Record<string, unknown>} [seed.settings] additional settings.db entries ({ settingId: value })
 * @param {object[]} [seed.history] history.db documents
 * @param {object[]} [seed.playlists] playlists.db documents
 * @param {object[]} [seed.profiles] profiles.db documents
 * @param {object[]} [seed.searchHistory] search-history.db documents
 * @param {object[]} [seed.subscriptionCache] subscription-cache.db documents
 * @param {object[]} [seed.tabSessions] tab-session.db documents
 * @param {object[]} [seed.watchStats] watch-stats.db documents
 */
export async function createUserDataDir(seed = {}) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'opentubex-e2e-'))

  const settings = { ...BASE_SETTINGS, ...seed.settings }
  const settingsDocs = Object.entries(settings).map(([_id, value]) => ({ _id, value }))
  await writeFile(path.join(userDataDir, 'settings.db'), toNedbFile(settingsDocs))

  const seededStores = {
    history: seed.history,
    playlists: seed.playlists,
    profiles: seed.profiles,
    'search-history': seed.searchHistory,
    'subscription-cache': seed.subscriptionCache,
    'tab-session': seed.tabSessions,
    'watch-stats': seed.watchStats
  }
  for (const [store, docs] of Object.entries(seededStores)) {
    if (docs?.length) {
      await writeFile(path.join(userDataDir, `${store}.db`), toNedbFile(docs))
    }
  }

  return userDataDir
}

/**
 * Launches the packed app (dist/main.js) against the given userData directory.
 */
export async function launchApp(userDataDir, extraArgs = []) {
  // Force X11 so the app renders on the xvfb display instead of escaping
  // to the user's real Wayland session.
  const env = {
    ...process.env,
    OPENTUBEX_E2E_USER_DATA_DIR: userDataDir,
    ELECTRON_OZONE_PLATFORM_HINT: 'x11'
  }
  delete env.WAYLAND_DISPLAY
  // Cursor / some agent shells set this, which turns Electron into plain Node
  // and breaks require('electron') / Playwright's Electron launcher.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  // The E2E build lives in its own directory so a running `pnpm dev`
  // (which rebuilds dist/ in development mode) can't clobber it.
  const launchOptions = {
    args: [
      path.join(repoRoot, 'dist-e2e', 'main.js'),
      ...extraArgs,
      '--ozone-platform=x11',
      '--mute-audio'
    ],
    cwd: repoRoot,
    env
  }

  let electronApp
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      electronApp = await electron.launch(launchOptions)
      break
    } catch (error) {
      // Concurrent Linux launches can transiently fail with ETXTBSY, a
      // startup SIGTRAP, or no diagnostic beyond the launch failure.
      const message = String(error.message)
      const isTransient = ['ETXTBSY', 'SIGTRAP', 'Process failed to launch']
        .some(value => message.includes(value))
      if (!isTransient || attempt === 2) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000))
    }
  }

  const page = await electronApp.firstWindow()

  // Fail fast if dist-e2e contains a development build (it would load the
  // dev server on localhost instead of the bundled files). A transient
  // chrome-error page can appear under heavy parallel load - reload once.
  // waitUntil: 'commit' — under heavy parallel load reaching the full 'load'
  // state can take longer than the timeout even though the right URL is
  // already committed; waitForAppReady below covers actual usability.
  try {
    await page.waitForURL(/^app:\/\/bundle/, { timeout: 15_000, waitUntil: 'commit' })
  } catch {
    if (page.url().startsWith('chrome-error://')) {
      await page.reload().catch(() => {})
    }
    try {
      await page.waitForURL(/^app:\/\/bundle/, { timeout: 15_000, waitUntil: 'commit' })
    } catch {
      const url = page.url()
      await electronApp.close().catch(() => {})
      throw new Error(
        `Unexpected app URL ${url} — dist-e2e must contain a production build, run "pnpm run test:e2e:pack"`
      )
    }
  }

  // Safety guard: if the userData override ever stops working, abort
  // instead of silently running tests against the user's real profile.
  const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  if (actualUserData !== userDataDir) {
    await electronApp.close().catch(() => {})
    throw new Error(
      `E2E userData isolation failed: expected ${userDataDir}, got ${actualUserData}. ` +
      'Did you run "pnpm run test:e2e:pack" after changing src/main?'
    )
  }

  await waitForAppReady(page)

  return { electronApp, page }
}

/**
 * Waits until the renderer has booted far enough to interact with.
 */
export async function waitForAppReady(page) {
  // The top nav is rendered once Vue has mounted and the locale has loaded.
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.tabBar')).toBeVisible()
}

/**
 * Toggles player fullscreen and waits for the Fullscreen API state.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} fullscreen
 */
export async function setPlayerFullscreen(page, fullscreen) {
  const player = page.locator('.ftVideoPlayer')
  const isFullscreen = await player.evaluate((element) => document.fullscreenElement === element)

  if (isFullscreen !== fullscreen) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('f')
  }

  await expect.poll(
    async () => player.evaluate((element) => document.fullscreenElement === element)
  ).toBe(fullscreen)
}

/**
 * Base test with an `app` fixture that provides a freshly launched,
 * isolated app instance per test.
 *
 * Customize seeding per test file with:
 *   test.use({ seed: { settings: { ... }, history: [ ... ] } })
 */
export const test = base.extend({
  seed: [{}, { option: true }],
  launchArgs: [[], { option: true }],

  app: async ({ seed, launchArgs }, use, testInfo) => {
    const userDataDir = await createUserDataDir(seed)
    const { electronApp, page } = await launchApp(userDataDir, launchArgs)

    const relaunch = async () => {
      // Wait until the old process has fully exited, otherwise it still owns
      // the single-instance lock for this userData dir and the new instance
      // immediately exits again.
      const oldProcess = appHandle.electronApp.process()
      const exited = new Promise((resolve) => oldProcess.once('exit', resolve))
      await appHandle.electronApp.close()
      await exited
      const next = await launchApp(userDataDir, launchArgs)
      appHandle.electronApp = next.electronApp
      appHandle.page = next.page
      return next
    }

    const appHandle = { electronApp, page, userDataDir, relaunch }

    try {
      await use(appHandle)
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshotPath = testInfo.outputPath('failure.png')
        await mkdir(path.dirname(screenshotPath), { recursive: true })
        await appHandle.page.screenshot({ path: screenshotPath }).catch(() => {})
        testInfo.attachments.push({ name: 'failure', path: screenshotPath, contentType: 'image/png' })
      }
      await appHandle.electronApp.close().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true })
    }
  },

  // Convenience: `page` resolves to the app's window.
  page: async ({ app }, use) => {
    await use(app.page)
  }
})

export { expect }

/**
 * Navigates via the side nav. Some routes appear twice in the side nav
 * (regular entry + "more options" flyout), so this clicks the first one.
 */
export async function goTo(page, route) {
  const visibleLink = () => page.locator(`${sel.sideNavLink(route)}:visible`).first()
  if (await visibleLink().count() === 0) {
    // Entry lives in the "More" flyout in the collapsed side nav.
    await page.locator('.sideNav .moreOptionNav').click()
  }
  await visibleLink().click()
  await expect(page).toHaveURL(new RegExp(`#/${route}`))
}

/** Common locators, kept in one place so selector changes only hit here. */
export const sel = {
  searchInput: '.topNav .searchInput input.ft-input',
  sideNavLink: (route) => `.sideNav a[href="#/${route}"]`,
  tabs: '.tabBar .tab',
  activeTab: '.tabBar .tab.active',
  newTabButton: '.tabBar .newTabButton',
  // Keyboard accelerators (Alt+Arrow) are handled by the Electron menu and
  // don't fire from synthesized input, so tests click these buttons instead.
  backButton: '.topNav button[title^="Back"]',
  forwardButton: '.topNav button[title^="Forward"]',
  video: 'video'
}
