import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`sync switches at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          uiScale,
          syncServerEnabled: true,
          syncServerUrl: '',
          syncServerUsername: 'example-user',
          syncServerToken: 'offline-test-token',
          syncServerPrivacyMode: 'enhanced',
          syncServerAutoSync: false,
          syncServerSyncSessions: true,
          syncServerSharedTabs: false,
        }
      }
    })

    test('aligns switches in each column across responsive layouts', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('body')).toHaveClass(/dark/)
      const section = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerWatchStatsSupported', true)
        store.commit('setSyncServerLiveRemindersSupported', true)
      })
      const toggles = section.locator('.toggles').nth(1)
      await expect(toggles.getByRole('checkbox')).toHaveCount(10)

      for (const [width, height] of [[1580, 880], [1000, 800], [480, 700]]) {
        await setWindowSize(app, page, { width, height })
        await expect.poll(() => toggles.evaluate(element => {
          const columns = getComputedStyle(element).gridTemplateColumns.split(' ').length
          const switches = [...element.querySelectorAll('.switch-label')]
          return switches.every((label, index) => {
            const rect = label.getBoundingClientRect()
            const columnStart = switches[index % columns].getBoundingClientRect().left
            return Math.abs(rect.left - columnStart) <= 1
          })
        })).toBe(true)
        expect(await toggles.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

        if (uiScale === 100 && width === 1580) {
          await toggles.screenshot({ path: testInfo.outputPath('sync-switches-dark.png') })
          await page.emulateMedia({ colorScheme: 'light' })
          await expect(page.locator('body')).toHaveClass(/light/)
          await toggles.screenshot({ path: testInfo.outputPath('sync-switches-light.png') })
        }
      }
    })
  })
}
