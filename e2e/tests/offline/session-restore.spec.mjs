import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

const SETTINGS_TAB_ID = 'e2e-settings-tab'
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
              id: SETTINGS_TAB_ID,
              url: 'app://bundle/index.html#/settings',
              title: 'Einstellungen',
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
  await expect(tabs.nth(0)).toContainText('Einstellungen')
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
  await expect(page).toHaveURL(/#\/settings/)
  await expect(tabs.nth(0)).toHaveClass(/active/)
  await expect(tabs.nth(0)).toContainText('Einstellungen')

  ;({ page } = await app.relaunch())
  const restoredTabs = page.locator(sel.tabs)
  await expect(restoredTabs).toHaveCount(3)
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
  await expect(restoredTabs.nth(0)).toContainText('Einstellungen')
  await expect(restoredTabs.nth(1)).toContainText('Verlauf')
  await expect(restoredTabs.filter({ hasText: /Settings\.Settings|History\.History/ })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/settings/)
  await expect(restoredTabs.nth(1)).not.toHaveClass(/unloaded/)
  await expect(restoredTabs.nth(2)).toHaveClass(/unloaded/)

  await goTo(page, 'history')
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
})
