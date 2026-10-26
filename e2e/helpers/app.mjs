import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

import { test as base, expect, _electron as electron } from '@playwright/test'

// Shared fixtures also run from the base checkout against candidate builds.
const INTERNET_CHECK_URL = 'https://connectivitycheck.grapheneos.network/generate_204'

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
  confirmCloseWindowWithMultipleTabs: false,
  useAITranslationCompletions: false,
  // Desktop-sized window so the responsive layout doesn't collapse into
  // its mobile variant (which hides the search bar, among other things).
  bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
}

/** Blocks unmocked services while keeping the fixture's internet check reachable. */
export function abortUnmockedRequest(route) {
  return route.request().url() === INTERNET_CHECK_URL
    ? route.fulfill({ status: 204 })
    : route.abort()
}

/**
 * Exposes the renderer's Vuex store and router to `page.evaluate` callbacks as
 * `window.$store` and `window.$router`. Helpers shared with the Android CDP
 * tests in tests/android cannot rely on these accessors.
 */
function installRendererAccessors() {
  for (const name of ['$store', '$router']) {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => document.querySelector('#app').__vue_app__.config.globalProperties[name]
    })
  }
}

/**
 * Reads a desktop datastore as NeDB's line format, one document per line.
 * Before the app opens a store, this is its seeded legacy file.
 * @param {string} userDataDir
 * @param {string} name e.g. 'settings' or 'search-history'
 */
export function readDatastore(userDataDir, name) {
  const file = path.join(userDataDir, `${name}.sqlite`)
  if (!existsSync(file)) {
    const legacyFile = path.join(userDataDir, `${name}.db`)
    return existsSync(legacyFile) ? readFileSync(legacyFile, 'utf8') : ''
  }
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const members = db.prepare('SELECT data FROM children WHERE parent = ? ORDER BY pos')
    return db.prepare('SELECT id, data, has_children FROM docs').all().map(row => {
      if (row.has_children !== 1) return `${row.data}\n`
      const doc = JSON.parse(row.data)
      doc.videos = members.all(row.id).map(member => JSON.parse(member.data))
      return `${JSON.stringify(doc)}\n`
    }).join('')
  } finally {
    db.close()
  }
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
  return Object.fromEntries(contents.trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(record => record._id && !record.$$deleted)
    .map(record => [record._id, record.value]))
}

export async function updateInputWithoutScrolling(input, value) {
  await input.evaluate((element, nextValue) => {
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Clicks Chromium's themed cancel control, which has no DOM locator. */
export async function clickSearchCancel(input) {
  const position = await input.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      x: style.direction === 'rtl'
        ? Number.parseFloat(style.paddingLeft) + 12
        : rect.width - Number.parseFloat(style.paddingRight) - 12,
      y: rect.height / 2
    }
  })
  await input.click({ position })
}

export async function expectScrollAtRenderedEnd(scroller) {
  await expect.poll(() => scroller.evaluate((element) => {
    const content = Array.from(element.children).findLast(child => !child.classList.contains('os-scrollbar'))
    const style = getComputedStyle(element)
    const contentEnd = content.getBoundingClientRect().bottom +
      Number.parseFloat(getComputedStyle(content).marginBottom) +
      Number.parseFloat(style.paddingBottom)
    const viewportEnd = element.getBoundingClientRect().bottom -
      Number.parseFloat(style.borderBottomWidth)
    // Keep every measurement fractional at non-100% UI scales. Chromium can
    // quantize the scroll offset to a physical pixel at the rendered boundary.
    // At fractional zoom, the content and viewport edges can each round by a
    // pixel, so allow their combined difference.
    const remaining = Math.max(-element.scrollTop, contentEnd - viewportEnd)
    return Math.abs(remaining) * devicePixelRatio
  })).toBeLessThanOrEqual(2)
}

/**
 * Creates an isolated userData directory, optionally seeded with
 * settings and datastore documents.
 *
 * @param {object} [seed]
 * @param {boolean} [seed.freshProfile] leave the settings datastore absent for first-run tests
 * @param {Record<string, unknown>} [seed.settings] additional settings.db entries ({ settingId: value })
 * @param {object[]} [seed.history] history.db documents
 * @param {object[]} [seed.playlists] playlists.db documents
 * @param {object[]} [seed.profiles] profiles.db documents
 * @param {object[]} [seed.searchHistory] search-history.db documents
 * @param {object[]} [seed.subscriptionCache] subscription-cache.db documents
 * @param {object[]} [seed.tabSessions] tab-session.db documents
 * @param {object[]} [seed.watchStats] watch-stats.db documents
 * @param {object[]} [seed.downloads] persisted downloads
 */
export async function createUserDataDir(seed = {}) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'opentubex-e2e-'))

  if (!seed.freshProfile) {
    const settings = { ...BASE_SETTINGS, ...seed.settings }
    const settingsDocs = Object.entries(settings).map(([_id, value]) => ({ _id, value }))
    await writeFile(path.join(userDataDir, 'settings.db'), toNedbFile(settingsDocs))
  }

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
  if (seed.downloads?.length) {
    await writeFile(path.join(userDataDir, 'downloads.json'), JSON.stringify(seed.downloads))
  }

  return userDataDir
}

/**
 * Launches the packed app (dist/main.js) against the given userData directory.
 *
 * @param {string} userDataDir
 * @param {string[]} [extraArgs]
 * @param {object} [options]
 * @param {string} [options.appRoot] repository root containing dist-e2e
 * @param {string} [options.executablePath] Electron executable to launch
 * @param {Record<string, string>} [options.env] additional environment variables
 * @param {(phase: 'electronConnected'|'windowCreated'|'routeCommitted'|'interactive', page?: import('@playwright/test').Page, electronApp?: import('@playwright/test').ElectronApplication) => void|Promise<void>} [options.onPhase]
 * @param {number} [windowRetry] internal first-window retry count
 */
export async function launchApp(userDataDir, extraArgs = [], options = {}, windowRetry = 0) {
  const appRoot = options.appRoot ?? repoRoot
  // Force X11 so the app renders on the xvfb display instead of escaping
  // to the user's real Wayland session.
  const env = {
    ...process.env,
    OPENTUBEX_E2E_USER_DATA_DIR: userDataDir,
    ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    // Tests expect en-GB strings, which CI's bare "en" system locale resolves
    // to. Pin it so the default locale setting does not follow the host.
    LANG: 'en_GB.UTF-8',
    LANGUAGE: 'en_GB',
    LC_ALL: 'en_GB.UTF-8',
    ...options.env,
  }
  delete env.WAYLAND_DISPLAY
  // Cursor/agent shells may set this, which makes Electron act as Node and
  // reject Chromium launch flags used by Playwright.
  delete env.ELECTRON_RUN_AS_NODE

  // The E2E build lives in its own directory so a running `pnpm dev`
  // (which rebuilds dist/ in development mode) can't clobber it.
  const launchOptions = {
    args: [
      path.join(appRoot, 'dist-e2e', 'main.js'),
      ...extraArgs,
      '--ozone-platform=x11',
      '--mute-audio'
    ],
    cwd: appRoot,
    env
  }
  if (options.executablePath) {
    launchOptions.executablePath = options.executablePath
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
  // Listen before waiting for the first window or renderer readiness so startup
  // exceptions cannot disappear before a test gets access to its page fixture.
  const electronProcess = electronApp.process()
  const context = electronApp.context()
  const startupErrors = []
  // Keep the stack: a bare message such as a JSON syntax error cannot be traced.
  // Thrown values other than errors, such as events, have an empty stack.
  const recordStartupError = error => startupErrors.push(error.error().stack || error.error().message)
  context.on('weberror', recordStartupError)

  const notifyPhase = async (phase, page) => {
    try {
      await options.onPhase?.(phase, page, electronApp)
    } catch (error) {
      await electronApp.close().catch(() => {})
      throw error
    }
  }
  // Tests control WAN reachability independently of the host running them.
  // Page routes can override these replies to exercise real offline recovery.
  await context.route(INTERNET_CHECK_URL, route => route.fulfill({ status: 204 }))
  // Covers reloads and later windows. The first document may already exist.
  await context.addInitScript(installRendererAccessors)
  await notifyPhase('electronConnected')

  let page
  try {
    page = await electronApp.firstWindow()
  } catch (error) {
    context.off('weberror', recordStartupError)
    const exited = electronProcess.exitCode !== null || electronProcess.signalCode !== null
      ? Promise.resolve()
      : new Promise(resolve => electronProcess.once('exit', resolve))
    await electronApp.close().catch(() => {})
    await exited
    // A stalled Linux startup can connect without creating a window. Close
    // that process before retrying; persistent failures still fail the test.
    if (error.name !== 'TimeoutError' || windowRetry === 2) throw error
    expect(startupErrors, 'Renderer errors during startup').toEqual([])
    return launchApp(userDataDir, extraArgs, options, windowRetry + 1)
  }
  await notifyPhase('windowCreated', page)

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
        `Unexpected app URL ${url}. ${path.join(appRoot, 'dist-e2e')} must contain a production build`
      )
    }
  }
  await notifyPhase('routeCommitted', page)

  // Safety guard: if the userData override ever stops working, abort
  // instead of silently running tests against the user's real profile.
  const actualUserData = await evaluateMainProcess(electronApp, ({ app }) => app.getPath('userData'))
  if (actualUserData !== userDataDir) {
    await electronApp.close().catch(() => {})
    throw new Error(
      `E2E userData isolation failed: expected ${userDataDir}, got ${actualUserData}. ` +
      'Did you run "pnpm run test:e2e:pack" after changing src/main?'
    )
  }

  try {
    await waitForAppReady(page)
    await page.evaluate(installRendererAccessors)
    // Init scripts can miss a reloaded document on CI, so the main process
    // also installs the accessors whenever a document is ready. This is only
    // a fallback, so it must not fail the launch.
    await electronApp.evaluate(({ app, BrowserWindow }, source) => {
      const install = contents => contents.on('dom-ready', () => contents.executeJavaScript(source).catch(() => {}))
      app.on('web-contents-created', (_, contents) => install(contents))
      for (const browserWindow of BrowserWindow.getAllWindows()) install(browserWindow.webContents)
    }, `(${installRendererAccessors})()`).catch(() => {})
    await notifyPhase('interactive', page)
    expect(startupErrors, 'Renderer errors during startup').toEqual([])
  } catch (error) {
    await electronApp.close().catch(() => {})
    expect(startupErrors, 'Renderer errors during startup').toEqual([])
    throw error
  } finally {
    context.off('weberror', recordStartupError)
  }

  return { electronApp, page }
}

/**
 * Waits until the renderer has booted far enough to interact with.
 */
export async function waitForAppReady(page) {
  // The top nav is rendered once Vue has mounted and the locale has loaded.
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.tabBar')).toBeVisible()
  await expect(page.locator('#startup-splash')).toHaveCount(0)
}

/** Opens a new app window through the tab bar's empty-space context menu. */
export async function openNewWindowFromTabBar(app, page) {
  const newWindowPromise = app.electronApp.waitForEvent('window')
  await page.locator(sel.newTabButton).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^New [Ww]indow$/ }).click()
  return newWindowPromise
}

/**
 * Attaches a screenshot to the HTML report, so visual behaviour can be
 * reviewed there instead of only on failure. Never fails the test: a
 * screenshot that can't be taken (e.g. the window is already closing) is
 * not worth losing the result over.
 *
 * Prefer the `attachScreenshot` fixture below, which binds page and testInfo.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Page} page
 * @param {string} name shown as the attachment's title in the report
 */
export async function attachScreenshot(testInfo, page, name) {
  try {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
  } catch {
    // ignored on purpose, see above
  }
}

/** The renderer's current viewport size. */
export function getViewport(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight
  }))
}

/**
 * Evaluates an idempotent function in the Electron main process.
 *
 * DevTools tracks the evaluation result only weakly until a microtask settles
 * it, and the main process runs microtasks late. A garbage collection in that
 * window, likely during startup, fails the call with "Resulting promise was
 * garbage collected" even though the function ran, so those calls are retried.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {Function} fn
 * @param {unknown} [arg]
 */
export async function evaluateMainProcess(electronApp, fn, arg) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await electronApp.evaluate(fn, arg)
    } catch (error) {
      if (attempt === 3 || !error.message.includes('Resulting promise was garbage collected')) throw error
    }
  }
}

/**
 * Resizes the window and waits until the renderer has laid out at the new
 * size, then returns the resulting viewport.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {import('@playwright/test').Page} page
 * @param {{ width: number, height: number }} size
 */
export async function setWindowSize({ electronApp }, page, size) {
  const before = await getViewport(page)

  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), ...bounds })
  }, size)

  await expect.poll(async () => {
    const viewport = await getViewport(page)
    return viewport.width !== before.width && viewport.height !== before.height
  }).toBe(true)
  // The viewport size changes before the resize event is dispatched on a later frame.
  // Wait for it so its listeners cannot undo state the caller sets up next.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  return await getViewport(page)
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

  // Under load, the window can fail to change its fullscreen state, which
  // Chromium reports as a fullscreenerror. Only then is pressing again safe.
  for (let attempt = 0; attempt < (isFullscreen === fullscreen ? 0 : 3); attempt++) {
    await page.evaluate(() => {
      window.__e2eFullscreenResult = null
      const record = (event) => {
        document.removeEventListener('fullscreenchange', record)
        document.removeEventListener('fullscreenerror', record)
        window.__e2eFullscreenResult = event.type
      }
      document.addEventListener('fullscreenchange', record)
      document.addEventListener('fullscreenerror', record)
      document.activeElement?.blur()
    })
    await page.keyboard.press('f')

    let result = null
    await expect.poll(async () => {
      result = await page.evaluate(() => window.__e2eFullscreenResult)
      return result
    }).not.toBeNull()
    if (result === 'fullscreenchange') break
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
 * Use `localeOverrides` to replace packaged locale messages without changing
 * the shared dist-e2e output.
 *
 * `uiScale` is set per project: tests tagged `@scale` also run at 95% and
 * 125%. Read the fixture instead of seeding `settings.uiScale` in those tests.
 */
/**
 * Workers that share an X server can move each other's cursor, steal focus and
 * interrupt drags. On Linux, each worker gets its own Xvfb whenever it is
 * installed; `E2E_XVFB=0` keeps the current display, `E2E_XVFB=1` requires Xvfb.
 */
function usesPrivateDisplay() {
  if (process.env.E2E_XVFB) return process.env.E2E_XVFB !== '0'
  return process.platform === 'linux' &&
    (process.env.PATH ?? '').split(path.delimiter).some(directory => directory && existsSync(path.join(directory, 'Xvfb')))
}

export const test = base.extend({
  // Each worker's private X server picks a free display.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
  xvfbDisplay: [async ({}, use) => {
    if (!usesPrivateDisplay()) {
      await use(process.env.DISPLAY)
      return
    }
    const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe']
    })
    const [display] = await Promise.race([
      once(xvfb.stdio[3], 'data'),
      once(xvfb, 'exit').then(([code]) => { throw new Error(`Xvfb exited with code ${code}`) })
    ])
    process.env.DISPLAY = `:${String(display).trim()}`
    try {
      await use(process.env.DISPLAY)
    } finally {
      // The startup race may already have consumed an early exit event.
      if (xvfb.exitCode === null && xvfb.signalCode === null) {
        const exited = once(xvfb, 'exit')
        xvfb.kill()
        await exited
      }
    }
  }, { scope: 'worker', auto: true }],
  seed: [{}, { option: true }],
  uiScale: [100, { option: true }],
  launchArgs: [[], { option: true }],
  showTutorial: [false, { option: true }],
  localeOverrides: [{}, { option: true }],

  app: async ({ seed, uiScale, launchArgs, showTutorial, localeOverrides }, use, testInfo) => {
    const userDataDir = await createUserDataDir(uiScale === 100
      ? seed
      : { ...seed, settings: { uiScale, ...seed.settings } })
    const hasLocaleOverrides = Object.keys(localeOverrides).length > 0
    let appRoot
    let appHandle
    try {
      appRoot = hasLocaleOverrides
        ? await mkdtemp(path.join(tmpdir(), 'opentubex-e2e-app-'))
        : repoRoot

      if (hasLocaleOverrides) {
        await cp(path.join(repoRoot, 'dist-e2e'), path.join(appRoot, 'dist-e2e'), {
          recursive: true
        })
        await cp(path.join(repoRoot, '_icons'), path.join(appRoot, '_icons'), {
          recursive: true
        })
        for (const [localePath, messages] of Object.entries(localeOverrides)) {
          const outputPath = path.join(
            appRoot,
            'dist-e2e',
            'static',
            'locales',
            `${localePath}.json.br`
          )
          await writeFile(outputPath, brotliCompressSync(JSON.stringify(messages)))
        }
      }

      const { electronApp, page } = await launchApp(userDataDir, launchArgs, { appRoot })

      /** Runs an optional checkpoint with the exited process before launching again. */
      const relaunch = async (beforeLaunch) => {
        // Wait until the old process has fully exited, otherwise it still owns
        // the single-instance lock for this userData dir and the new instance
        // immediately exits again.
        const oldProcess = appHandle.electronApp.process()
        const exited = new Promise((resolve) => oldProcess.once('exit', resolve))
        await appHandle.electronApp.close()
        await exited
        await beforeLaunch?.(oldProcess)
        const next = await launchApp(userDataDir, launchArgs, { appRoot })
        appHandle.electronApp = next.electronApp
        appHandle.page = next.page
        return next
      }

      appHandle = { electronApp, page, userDataDir, relaunch }

      if (!showTutorial && seed.freshProfile) {
        const tutorial = page.locator('.tutorialOverlay')
        await expect(tutorial).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
        await expect(tutorial).toBeHidden()
      }

      await use(appHandle)
    } finally {
      if (appHandle) {
        if (testInfo.status !== testInfo.expectedStatus) {
          await attachScreenshot(testInfo, appHandle.page, 'failure')
        }
        await appHandle.electronApp.close().catch(() => {})
      }
      await rm(userDataDir, { recursive: true, force: true })
      if (hasLocaleOverrides && appRoot) {
        await rm(appRoot, { recursive: true, force: true })
      }
    }
  },

  /**
   * Attaches a named screenshot of the app window to the report:
   *   await attachScreenshot('subscriptions feed')
   */
  attachScreenshot: async ({ app }, use, testInfo) => {
    await use((name) => attachScreenshot(testInfo, app.page, name))
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
  if (route === 'downloads') {
    const headerButton = page.locator('.topNav .downloadsButton')
    if (await headerButton.isVisible()) {
      await headerButton.click()
    } else {
      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings', exact: true }).getByRole('button', { name: 'Downloads', exact: true }).click()
    }
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    return
  }

  if (route === 'settings') {
    await page.locator('.profileTrigger').click()
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.locator('.allSettingsShortcut').click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    return
  }

  // Mobile navigation slides offscreen while scrolling down. Scrolling to the
  // top reveals it before either a route link or the More button is clicked.
  if (await page.locator('.sideNav').evaluate(nav =>
    getComputedStyle(nav).getPropertyValue('--hide-on-scroll').trim() === '1'
  )) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.locator('.sideNav')).not.toHaveClass(/scrollHidden/)
  }
  const visibleLink = () => page.locator(sel.sideNavLink(route)).first()
  if (await visibleLink().count() === 0) {
    // Entry lives in the "More" flyout in the collapsed side nav.
    await page.locator('.sideNav .moreOptionNav').click()
  }
  await visibleLink().click()
  await expect(page).toHaveURL(new RegExp(`#/${route}`))
}

/**
 * Opens the More menu of the visible playlist header.
 * @param {import('@playwright/test').Page} page
 * @param {string} name matched case-insensitively, as tests run in both en-US and en-GB
 * @returns {Promise<import('@playwright/test').Locator>} the menu item with this name
 */
export async function openPlaylistMenuItem(page, name) {
  await page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'More', exact: true }).click()
  return page.getByRole('menu').getByRole('menuitem', { name })
}

const SETTINGS_CATEGORY_BY_LEGACY_SECTION = {
  theme: 'appearance',
  player: 'playback',
  'caption-appearance': 'playback',
  channel: 'playback',
  subscription: 'subscriptions',
  distraction: 'focus',
  'parental-control': 'focus',
  'sponsor-block': 'add-ons',
  'return-youtube-dislike': 'add-ons',
  'external-player': 'advanced',
  'external-software': 'advanced',
  proxy: 'advanced',
  'context-menu-search': 'general',
  storage: 'data',
  experimental: 'advanced'
}

/** Opens Settings and selects one category in the two-column modal layout. */
export async function goToSettingsSection(page, section) {
  // A window still playing its leave animation is visible but about to be
  // removed, so it must be reopened rather than reused.
  if (!await page.locator('.settingsWindow:not(.settings-window-leave-active)').isVisible()) {
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await goTo(page, 'settings')
  }
  const category = SETTINGS_CATEGORY_BY_LEGACY_SECTION[section] ?? section
  await page.locator(`.settingsMenu [data-section="${category}"]`).click()
  const content = page.locator(`.settingsContent > [data-section="${category}"]`)
  await expect(content).toBeVisible()
  if (category === 'data' && ['data', 'storage'].includes(section)) {
    const tab = section === 'data' ? 'data' : 'storage'
    const tabButton = page.locator(`.settingsWindow [data-settings-tab="${tab}"]`)
    await tabButton.click()
    await expect(tabButton).toHaveAttribute('aria-selected', 'true')
  }
  return content
}

const INTERFACE_CUSTOMIZER_TABS = {
  navigation: 'navigation',
  'quick settings': 'quickSettings',
  player: 'player',
  'control bar': 'controlBar',
  'fullscreen actions': 'fullscreenActions'
}

/**
 * Opens Customize interface from the Appearance settings and selects one of its tabs.
 * @param {import('@playwright/test').Page} page
 * @param {'navigation' | 'quick settings' | 'player' | 'control bar' | 'fullscreen actions'} tab
 */
export async function openInterfaceCustomizer(page, tab) {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize interface', exact: true }).click()
  const tabButton = page.locator(`.interfaceCustomizer [data-settings-subpage-tab="${INTERFACE_CUSTOMIZER_TABS[tab]}"]`)
  await tabButton.click()
  await expect(tabButton).toHaveAttribute('aria-selected', 'true')
  return page.locator('.interfaceCustomizer')
}

/**
 * Starts collecting the CSS animations that play from here on. The classes that
 * trigger them are cleared once they have run, so waiting on the class instead
 * would be a race.
 *
 * @param {import('@playwright/test').Page} page
 */
export function recordAnimations(page) {
  return page.evaluate(() => {
    window.__playedAnimations = []
    document.addEventListener('animationstart', (event) => {
      window.__playedAnimations.push(event.animationName)
    }, true)
  })
}

/**
 * Waits for an animation recorded by `recordAnimations` to have played. Scoped
 * styles suffix the keyframes name with a hash, hence the prefix match.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
export function expectAnimation(page, name) {
  return expect.poll(() => page.evaluate(
    (animationName) => (window.__playedAnimations ?? []).some(played => played.startsWith(animationName)),
    name
  )).toBe(true)
}

/** Common locators, kept in one place so selector changes only hit here. */
export const sel = {
  searchInput: '.topNav .searchInput input.ft-input',
  sideNavLink: (route) => `:is(.sideNav, .moreOptionContainer) a[href="#/${route}"]:visible`,
  tabs: '.tabBar .tab',
  activeTab: '.tabBar .tab.active',
  newTabButton: '.tabBar .newTabButton',
  tabOrganizerButton: '.tabBar .tabOrganizerButton',
  // Keyboard accelerators (Alt+Arrow) are handled by the Electron menu and
  // don't fire from synthesized input, so tests click these buttons instead.
  backButton: '.topNav button[title^="Back"]',
  forwardButton: '.topNav button[title^="Forward"]',
  video: 'video'
}
