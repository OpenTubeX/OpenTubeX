import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

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

    // Extra time from the limit prompt counts toward the remaining time.
    await page.evaluate(() => {
      window.$store.dispatch('extendWellbeingLimit', { kind: 'watch', extraSeconds: 15 * 60 })
    })
    await expect(page.locator('.summaryCard').filter({ hasText: 'Today' }))
      .toContainText('45 min left of your 1 hr 30 min daily limit')
  })
})

test.describe('autoplay countdown', () => {
  test.use({
    seed: {
      settings: {
        ...playbackSettings,
        playNextVideo: true,
        defaultInterval: 3,
        dailyLimitAction: 'remind',
        stopAutoplayAtBedtimeAndLimit: true,
        // Keep the default 22:00 to 06:00 bedtime from stopping autoplay before the limit does.
        bedtimeStart: timeOfDay(120),
        bedtimeEnd: timeOfDay(180),
      },
      watchStats: watchedOneHour,
    }
  })

  test('a limit reached during the countdown stops the next video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const url = page.url()

    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => vm.handleVideoEnded())
    await expect.poll(() => watch.evaluate(vm => vm.autoplayCountdown != null)).toBe(true)
    await page.evaluate(() => window.$store.dispatch('updateDailyWatchTimeLimit', 60))
    await expect.poll(() => page.evaluate(() => window.$store.getters.getWellbeingStopsAutoplay)).toBe(true)

    await expect.poll(() => watch.evaluate(vm => vm.autoplayCountdown == null), { timeout: 10_000 }).toBe(true)
    expect(page.url()).toBe(url)
  })
})

test.describe('reminder only actions', () => {
  test.use({ seed: { settings: { ...playbackSettings, breakReminderInterval: 15, breakReminderAction: 'remind' } } })

  test('a break reminder can remind without pausing', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    await commit(page, 'addWellbeingPlayback', { date: today, seconds: 15 * 60, isShort: false, recorded: true, now: Date.now() })
    await expect(page.locator('.toast', { hasText: 'Time to take a break' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Time to take a break' })).toHaveCount(0)
    expect(await video.evaluate(element => element.paused)).toBe(false)
  })
})

test.describe('daily limit with a settings password', () => {
  test.use({ seed: { settings: { ...playbackSettings, dailyWatchTimeLimit: 60, settingsPassword: 'hash' }, watchStats: watchedOneHour } })

  test('only the password-protected settings can raise the limit', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('.searchInput input').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator('.searchInput input').press('Enter')

    const prompt = page.getByRole('dialog', { name: 'Daily watch time limit reached' })
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt.getByRole('button')).toHaveText(['Ok'])
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

  test('a video that just started counts as playing for the bedtime wait', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    // Before the first watch time flush, only the play event shows that playback is active.
    expect(await page.evaluate(() => window.$store.getters.getWellbeing.lastPlaybackAt)).toBe(0)
    await page.evaluate(([start, end]) => {
      const store = window.$store
      store.dispatch('updateBedtimeStart', start)
      store.dispatch('updateBedtimeEnd', end)
      store.dispatch('updateBedtimeReminder', true)
    }, [timeOfDay(-30), timeOfDay(60)])

    await expect.poll(() => page.evaluate(() => window.$store.getters.getWellbeingBedtimeWaiting)).toBe(true)
    await expect(page.getByRole('dialog', { name: 'It\'s time for bed' })).toHaveCount(0)
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

test.describe('watch statistics turned off', () => {
  test.use({ seed: { settings: { ...playbackSettings, enableWatchStats: false } } })

  test('time watched before statistics turn on stays unrecorded', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(4)

    await page.evaluate(() => window.$store.dispatch('updateEnableWatchStats', true))
    const enabledAt = await video.evaluate(element => element.currentTime)
    await expect.poll(() => video.evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(enabledAt + 2)
    await video.evaluate(element => element.pause())
    const publicSeconds = await video.evaluate(element => element.currentTime) - enabledAt

    // Pausing flushes the buffer, which must not include the private seconds before statistics turned on.
    const recorded = () => page.evaluate(date => window.$store.getters.getWatchSecondsByDate[date] ?? 0, today)
    await expect.poll(recorded).toBeGreaterThan(1)
    expect(await recorded()).toBeLessThan(publicSeconds + 1)
  })
})

test.describe('bedtime without the reminder', () => {
  test.use({
    seed: {
      settings: {
        ...playbackSettings,
        grayscaleMode: 'bedtime',
        stopAutoplayAtBedtimeAndLimit: true,
        bedtimeReminder: false,
        bedtimeStart: timeOfDay(-30),
        bedtimeEnd: timeOfDay(60),
      },
    },
  })

  test('the bedtime window still turns the app gray', async ({ page }) => {
    await expect(page.locator('html')).toHaveClass(/(^|\s)grayscale(\s|$)/)
    await expect(page.getByRole('dialog', { name: 'It\'s time for bed' })).toHaveCount(0)
  })

  test('queued videos do not autoplay at bedtime', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await page.evaluate(() => {
      window.$store.commit('addVideoToWatchQueue', { video: { videoId: '7JV7yHNQjm4', title: 'Queued video', lengthSeconds: 60 } })
    })

    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => vm.handleVideoEnded())
    expect(await page.evaluate(() => window.$store.getters.getNextQueuedVideo?.videoId)).toBe('7JV7yHNQjm4')
    expect(page.url()).toContain('jNQXAC9IVRw')
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

test('switching from the bottom of Distraction Free to a shorter tab leaves no empty space', { tag: '@scale' }, async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 20, y: 20, width: 900, height: 600 }))
  })
  await goToSettingsSection(page, 'focus')
  const scroller = page.locator('.settingsContent')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  for (const tab of ['wellbeing', 'parental']) {
    await page.locator(`.settingsWindow [data-settings-tab="${tab}"]`).click()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    // The scrollbar must match the shorter range, whether or not the tab still overflows.
    const overflows = await scroller.evaluate(element => element.scrollHeight - element.clientHeight > 1)
    if (overflows) {
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    } else {
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    }
    await page.locator('.settingsWindow [data-settings-tab="distraction"]').click()
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  }
})
