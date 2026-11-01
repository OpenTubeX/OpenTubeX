import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

/**
 * @param {Date} date
 */
function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const today = toDateKey(new Date())
const playbackSettings = { animationSpeed: 0, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }
// Marks the history migration as completed, so the seeded totals stay exact.
const migrationDone = { _id: 'history-watch-time-v1', completedAt: Date.now(), hadEstimates: false, adjustment: null }
const watchedOneHour = [{ _id: today, date: today, seconds: 3600 }, migrationDone]

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} type
 * @param {unknown} [payload]
 */
function commit(page, type, payload) {
  return page.evaluate(([type, payload]) => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit(type, payload)
  }, [type, payload])
}

/**
 * @param {number} offsetMinutes
 */
function timeOfDay(offsetMinutes) {
  const date = new Date(Date.now() + offsetMinutes * 60_000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

test.describe('daily watch time limit', () => {
  test.use({ seed: { settings: { ...playbackSettings, dailyWatchTimeLimit: 60 }, watchStats: watchedOneHour } })

  test('a reached limit blocks playback until more time is allowed', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('.searchInput input').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator('.searchInput input').press('Enter')

    const prompt = page.getByRole('dialog', { name: 'Daily watch time limit reached' })
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt).toContainText('You\'ve watched 1 hr today.')
    const video = page.locator('.ftVideoPlayer video')
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

    await prompt.getByRole('button', { name: '15 More Minutes' }).click()
    await expect(prompt).toBeHidden()
    await video.evaluate(element => element.play())
    await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
    await expect(prompt).toBeHidden()
  })

  test('the stats page shows the remaining daily limit', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateDailyWatchTimeLimit', 90)
    })
    await goTo(page, 'stats')
    await expect(page.locator('.summaryCard').filter({ hasText: 'Today' }))
      .toContainText('30 min left of your 1 hr 30 min daily limit')
  })
})

test.describe('break and bedtime reminders', () => {
  test.use({ seed: { settings: { ...playbackSettings, breakReminderInterval: 15 } } })

  test('the break reminder pauses playback after the interval', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    await commit(page, 'addWellbeingPlayback', { date: today, seconds: 15 * 60, isShort: false, recorded: true, now: Date.now() })
    const prompt = page.getByRole('dialog', { name: 'Time to take a break' })
    await expect(prompt).toContainText('You\'ve been watching for 15 min.')
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
    await prompt.getByRole('button', { name: 'Ok' }).click()
    await expect(prompt).toBeHidden()
  })

  test('the bedtime reminder waits for the video to end', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    // Playback reports time while playing, which marks it as active.
    await commit(page, 'addWellbeingPlayback', { date: today, seconds: 1, isShort: false, recorded: true, now: Date.now() })
    await page.evaluate(([start, end]) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.dispatch('updateBedtimeStart', start)
      store.dispatch('updateBedtimeEnd', end)
      store.dispatch('updateBedtimeReminder', true)
    }, [timeOfDay(-30), timeOfDay(60)])

    const prompt = page.getByRole('dialog', { name: 'It\'s time for bed' })
    await expect.poll(() => page.evaluate(() => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWellbeingBedtimeWaiting
    })).toBe(true)
    await expect(prompt).toBeHidden()
    expect(await video.evaluate(element => element.paused)).toBe(false)

    await video.evaluate(element => { element.currentTime = element.duration })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Dismiss' }).click()
    await expect(prompt).toBeHidden()
  })
})

test.describe('starting during bedtime', () => {
  test.use({ seed: { settings: { animationSpeed: 0, bedtimeReminder: true, bedtimeStart: timeOfDay(-30), bedtimeEnd: timeOfDay(60) } } })

  test('reminds right away', async ({ page }) => {
    const prompt = page.getByRole('dialog', { name: 'It\'s time for bed' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Dismiss' }).click()
    await expect(prompt).toBeHidden()
  })
})

test.describe('grayscale', () => {
  test.use({ seed: { settings: { animationSpeed: 0, grayscaleMode: 'always' } } })

  test('the app turns grayscale and returns to color when turned off', async ({ page, attachScreenshot }) => {
    const root = page.locator('html')
    await expect(root).toHaveClass(/(^|\s)grayscale(\s|$)/)
    expect(await root.evaluate(element => getComputedStyle(element).filter)).toBe('grayscale(1)')

    const wellbeingSettings = await goToSettingsSection(page, 'wellbeing')
    await expect(page.getByRole('tab', { name: 'Digital Wellbeing' })).toHaveAttribute('aria-selected', 'true')
    await attachScreenshot('digital wellbeing settings')

    const grayscale = wellbeingSettings.getByRole('combobox', { name: 'Grayscale' })
    await grayscale.click()
    await page.getByRole('option', { name: 'Off' }).click()
    await expect(root).not.toHaveClass(/(^|\s)grayscale(\s|$)/)
  })
})

test.describe('distraction free tabs', () => {
  test('search, legacy sections and arrow keys open the matching tab', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const tab = id => page.locator(`.settingsWindow [data-settings-tab="${id}"]`)
    await expect(tab('distraction')).toHaveAttribute('aria-selected', 'true')
    await expect(focus.getByRole('combobox', { name: 'Daily Watch Time Limit' })).toHaveCount(0)

    await page.getByRole('searchbox', { name: 'Search settings' }).fill('Daily Watch Time Limit')
    await page.getByRole('button', { name: 'Daily Watch Time Limit', exact: true }).click()
    await expect(tab('wellbeing')).toHaveAttribute('aria-selected', 'true')
    await expect(focus.getByRole('combobox', { name: 'Daily Watch Time Limit' })).toBeVisible()

    await page.evaluate(() => window.$store.commit('setSettingsWindowSection', 'parental-control'))
    await expect(tab('parental')).toHaveAttribute('aria-selected', 'true')
    await expect(focus.getByRole('checkbox', { name: 'Hide Unsubscribe Button' })).toBeVisible()

    await tab('parental').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab('distraction')).toBeFocused()
    await expect(tab('distraction')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tab('parental')).toBeFocused()
  })
})

test('distraction free tabs stack their icons in narrow windows', { tag: '@scale' }, async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 20, y: 20, width: 360, height: 700 }))
  })
  await goToSettingsSection(page, 'focus')
  const tabs = page.locator('.settingsWindow [data-settings-tab]')
  await expect(tabs).toHaveCount(3)
  for (const tab of await tabs.all()) {
    const layout = await tab.evaluate(element => {
      const icon = element.querySelector('svg, .ft-icon').getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(element.lastChild)
      const label = range.getBoundingClientRect()
      return { iconAbove: icon.bottom <= label.top + 0.5, fits: element.scrollWidth <= element.clientWidth }
    })
    expect(layout).toEqual({ iconAbove: true, fits: true })
  }
})
