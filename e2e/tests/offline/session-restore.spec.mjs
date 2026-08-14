import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

const SUBSCRIPTIONS_TAB_ID = 'e2e-subscriptions-tab'
const HISTORY_TAB_ID = 'e2e-history-tab'
const WATCH_TAB_ID = 'e2e-watch-tab'
const STALE_WATCH_URL = 'app://bundle/index.html#/watch/jNQXAC9IVRw?oneTimeTimestamp=12&timestamp=34'

test.use({
  seed: {
    settings: { currentLocale: 'de-DE', startupBehavior: 'restoreTabLoadState' },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: SUBSCRIPTIONS_TAB_ID,
              url: 'app://bundle/index.html#/subscriptions',
              title: 'Abos',
              isUnloaded: false
            },
            {
              id: HISTORY_TAB_ID,
              url: 'app://bundle/index.html#/history',
              title: 'Verlauf',
              isUnloaded: false
            },
            {
              id: WATCH_TAB_ID,
              url: STALE_WATCH_URL,
              title: 'Saved video',
              isUnloaded: true
            }
          ],
          activeTabId: HISTORY_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
})

async function readSavedSession(userDataDir) {
  const contents = await readFile(path.join(userDataDir, 'tab-session.db'), 'utf8')
  const records = contents
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record._id === 'e2e-window-session' && record.value)

  return records.at(-1)?.value
}

test('restores tab order, titles, active route, and saved load state across restarts', async ({ app, page }) => {
  const tabs = page.locator(sel.tabs)
  await expect(tabs).toHaveCount(3)
  await expect(tabs.nth(0)).toContainText('Abos')
  await expect(tabs.nth(1)).toContainText('Verlauf')
  await expect(tabs.nth(2)).toContainText('Saved video')
  await expect(tabs.nth(1)).toHaveClass(/active/)
  await expect(tabs.nth(0)).not.toHaveClass(/unloaded/)
  await expect(tabs.nth(2)).toHaveClass(/unloaded/)
  await expect(page).toHaveURL(/#\/history/)

  // oneTimeTimestamp is only valid for an in-process player reload. Persisting
  // it used to override the newer watch progress when a session was restored.
  await expect.poll(async () => {
    const session = await readSavedSession(app.userDataDir)
    return session?.tabs.find((tab) => tab.id === WATCH_TAB_ID)?.url
  }).toBe('app://bundle/index.html#/watch/jNQXAC9IVRw?timestamp=34')

  await tabs.nth(0).click()
  await expect(page).toHaveURL(/#\/subscriptions/)
  await expect(tabs.nth(0)).toHaveClass(/active/)
  await expect(tabs.nth(0)).toContainText('Abos')

  ;({ page } = await app.relaunch())
  const restoredTabs = page.locator(sel.tabs)
  await expect(restoredTabs).toHaveCount(3)
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
  await expect(restoredTabs.nth(0)).toContainText('Abos')
  await expect(restoredTabs.nth(1)).toContainText('Verlauf')
  await expect(restoredTabs.filter({ hasText: /Settings\.Settings|History\.History/ })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/subscriptions/)
  await expect(restoredTabs.nth(1)).not.toHaveClass(/unloaded/)
  await expect(restoredTabs.nth(2)).toHaveClass(/unloaded/)

  await goTo(page, 'history')
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
})

test.describe('active watch tab restore', () => {
  const watchRestoreSeed = {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: '',
      startupBehavior: 'loadLastActiveTab'
    },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/jNQXAC9IVRw',
              title: 'Saved video',
              isUnloaded: false
            }
          ],
          activeTabId: WATCH_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
  const invidiousServer = createServer()

  test.use({
    seed: watchRestoreSeed
  })

  test.beforeAll(async () => {
    await new Promise(resolve => invidiousServer.listen(0, '127.0.0.1', resolve))
    const address = invidiousServer.address()
    watchRestoreSeed.settings.defaultInvidiousInstance = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    invidiousServer.closeAllConnections()
    await new Promise(resolve => invidiousServer.close(resolve))
  })

  test('presents the video player skeleton during startup', async ({ page }) => {
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(
      '.tabContent[aria-hidden="false"] .videoPlayerPlaceholder.ft-shimmer'
    )).toBeVisible()
  })
})

test.describe('restored watch tab startup priority', () => {
  const ACTIVE_WATCH_TAB_ID = 'e2e-active-watch-tab'
  const BACKGROUND_WATCH_TAB_ID = 'e2e-background-watch-tab'
  const SUBSCRIPTIONS_TAB_ID = 'e2e-background-subscriptions-tab'
  const priorityRestoreSeed = {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: '',
      startupBehavior: 'loadAllTabs'
    },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: BACKGROUND_WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/background-video',
              title: 'Background video',
              isUnloaded: false
            },
            {
              id: ACTIVE_WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/active-video',
              title: 'Active video',
              isUnloaded: false
            },
            {
              id: SUBSCRIPTIONS_TAB_ID,
              url: 'app://bundle/index.html#/subscriptions',
              title: 'Subscriptions',
              isUnloaded: false
            }
          ],
          activeTabId: ACTIVE_WATCH_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
  const invidiousServer = createServer()

  test.use({ seed: priorityRestoreSeed })

  test.beforeAll(async () => {
    await new Promise(resolve => invidiousServer.listen(0, '127.0.0.1', resolve))
    const address = invidiousServer.address()
    priorityRestoreSeed.settings.defaultInvidiousInstance = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    invidiousServer.closeAllConnections()
    await new Promise(resolve => invidiousServer.close(resolve))
  })

  test('defers background watch tabs until the active watch load finishes', async ({ page }) => {
    const backgroundWatchTab = page.locator(`.tab[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"]`)
    const subscriptionsTab = page.locator(`.tab[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)

    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', ACTIVE_WATCH_TAB_ID)
    await expect(backgroundWatchTab).toHaveClass(/unloaded/)
    await expect(subscriptionsTab).not.toHaveClass(/unloaded/)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === ACTIVE_WATCH_TAB_ID)?.isLoading
    }).toBe(true)

    await page.evaluate(activeTabId => {
      window.ftElectron.tabs.setLoading(false, activeTabId)
    }, ACTIVE_WATCH_TAB_ID)

    await expect(backgroundWatchTab).not.toHaveClass(/unloaded/)
    await expect(page.locator(
      `.tabContent[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"] [data-tab-loading-indicator]`
    )).toHaveCount(1)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === BACKGROUND_WATCH_TAB_ID)?.loadState
    }).not.toBe('unloaded')
  })

  test('releases background watch tabs when a loaded tab becomes active', async ({ page }) => {
    const backgroundWatchTab = page.locator(`.tab[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"]`)
    const subscriptionsTab = page.locator(`.tab[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)

    await expect(backgroundWatchTab).toHaveClass(/unloaded/)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === SUBSCRIPTIONS_TAB_ID)?.loadState
    }).toBe('loaded')

    await subscriptionsTab.click()

    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', SUBSCRIPTIONS_TAB_ID)
    await expect(backgroundWatchTab).not.toHaveClass(/unloaded/)
  })
})
