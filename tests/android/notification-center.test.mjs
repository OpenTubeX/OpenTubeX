import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Requires an owned emulator and a current debug APK.
const enabled = Boolean(process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL?.startsWith('emulator-'))
const APP_ID = 'org.opentubex.app.dev'
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' })
const launch = () => adb('shell', 'am', 'start', '-n', `${APP_ID}/org.opentubex.app.MainActivity`)

async function connect() {
  let pid
  await expect.poll(() => {
    pid = adb('shell', 'pidof', APP_ID).trim()
    return Boolean(pid && adb('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`))
  }, { timeout: 15000 }).toBe(true)
  adb('forward', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`, `localabstract:webview_devtools_remote_${pid}`)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  await page.locator('.profileTrigger').waitFor()
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  if (await skip.isVisible()) await skip.click()
  return { browser, page }
}

test('notifications appear in the app while it is visible and in the system otherwise', { skip: !enabled }, async () => {
  const channelId = `UC${'0'.repeat(22)}`
  const run = Date.now().toString(36)
  // Real videos, so their thumbnails load. Disabling notifications afterwards resets the known uploads.
  const [seed, visible, hidden] = ['jNQXAC9IVRw', 'dQw4w9WgXcQ', '9bZkp7q19f0']
  const stream = `stream${run}`.slice(0, 11).padEnd(11, '0')
  const systemNotifications = () => adb('shell', 'dumpsys', 'notification', '--noredact')
  let browser, page
  try {
    adb('shell', 'pm', 'grant', APP_ID, 'android.permission.POST_NOTIFICATIONS')
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    adb('shell', 'wm', 'dismiss-keyguard')
    adb('shell', 'am', 'force-stop', APP_ID)
    launch();
    ({ browser, page } = await connect())
    await page.evaluate(() => localStorage.removeItem('opentubex-notification-history'))
    const observe = ids => page.evaluate(async ({ channelId, ids }) => {
      const entries = ids.map(id => ({ id, title: `Upload ${id}`, published: Date.now(), live: false, upcoming: false, membersOnly: false }))
      await window.Capacitor.Plugins.SubscriptionRefresh.observeUploads({ channelId, feedType: 'videos', entries })
    }, { channelId, ids })
    await page.evaluate(async channelId => {
      // Start from a fresh baseline.
      await window.Capacitor.Plugins.SubscriptionRefresh.configureUploadNotifications({ configuration: { enabled: false } })
      await window.Capacitor.Plugins.SubscriptionRefresh.configureUploadNotifications({
        configuration: {
          enabled: true,
          mode: 'both',
          thumbnailUrl: 'https://i.ytimg.com/vi/{id}/mqdefault.jpg',
          titles: { videos: 'New video from {channel}' },
          channels: { [channelId]: { name: 'Alpha Channel', feedTypes: ['videos'], membersOnly: false } }
        }
      })
    }, channelId)
    await observe([seed])
    // Toasts close on their own, so record every one that appears.
    await page.evaluate(() => {
      window.__toasts = new Set()
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll('.toast')) window.__toasts.add(toast.textContent)
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    const toastShown = text => page.evaluate(text => [...window.__toasts].some(toast => toast.includes(text)), text)

    // While the app is visible, Android leaves the notification to the app.
    await observe([visible, seed])
    assert.doesNotMatch(systemNotifications(), new RegExp(`Upload ${visible}`))
    // Android tells the app, like after a background refresh that finishes while it is open.
    await expect.poll(() => toastShown(`New video from Alpha Channel: Upload ${visible}`)).toBe(true)
    await expect(page.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible()

    // In the background, the system shows notifications and the app collects them when it returns.
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    // The app counts as hidden once its activity stops, which follows the pause.
    await expect.poll(() => adb('shell', 'dumpsys', 'activity', 'activities')
      .match(/Hist[^\n]*org\.opentubex\.app\.dev\/org\.opentubex\.app\.MainActivity[\s\S]*?state=(\w+)/)?.[1], { timeout: 15_000 }).toBe('STOPPED')
    await observe([hidden, visible, seed])
    await expect.poll(systemNotifications).toMatch(new RegExp(`Upload ${hidden}`))
    // The thumbnail is added once it loads, which takes up to two attempts of 10 seconds each.
    await expect.poll(() => /android\.picture=/.test(systemNotifications()), { timeout: 60_000 }).toBe(true)
    // The system also shows reminders without the app.
    await page.evaluate(stream => localStorage.setItem('opentubex-capacitor-live-reminders', JSON.stringify([{
      videoId: stream,
      startTimestamp: Date.now() - 60_000,
      notificationId: 7,
      notificationTitle: 'Alpha Channel is live',
      notificationBody: 'Stream'
    }])), stream)
    launch()

    await page.getByRole('button', { name: 'Notifications (3 unread)', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Notifications', exact: true })
    const entries = sheet.locator('.notificationEntry')
    await expect(entries).toHaveCount(3)
    await expect(entries.nth(0)).toContainText(`Upload ${hidden}`)
    await expect(entries.nth(1)).toContainText(`Upload ${visible}`)
    await expect(entries.nth(2)).toContainText('Alpha Channel is live')
    // The image loader picks the best size for the video itself.
    await expect(entries.nth(0).locator('.notificationThumbnail img')).toHaveAttribute('src', new RegExp(`^https://i\\.ytimg\\.com/vi/${hidden}/`))
    await expect(entries.nth(1).locator('.notificationThumbnail img')).toHaveAttribute('src', new RegExp(`^https://i\\.ytimg\\.com/vi/${visible}/`))
    // Notifications the system already showed are not repeated in the app.
    expect(await toastShown(`Upload ${hidden}`)).toBe(false)
    await entries.nth(2).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.path))
      .toBe(`/watch/${stream}`)
    // Opening an entry marks only that one read.
    await expect(page.getByRole('button', { name: 'Notifications (2 unread)', exact: true })).toBeVisible()
  } finally {
    await page?.evaluate(async () => {
      await window.Capacitor.Plugins.SubscriptionRefresh.configureUploadNotifications({ configuration: { enabled: false } })
      localStorage.removeItem('opentubex-notification-history')
    }).catch(() => {})
    await browser?.close()
    adb('forward', '--remove', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`)
  }
})

test('reminders that fire while the app is visible appear in the app, and turning notifications off pauses them', { skip: !enabled }, async () => {
  const run = Date.now().toString(36)
  const [due, read, later] = ['due', 'read', 'later'].map(name => `${name}${run}`.slice(0, 11).padEnd(11, '0'))
  let browser, page
  try {
    adb('shell', 'pm', 'grant', APP_ID, 'android.permission.POST_NOTIFICATIONS')
    adb('shell', 'am', 'force-stop', APP_ID)
    launch();
    ({ browser, page } = await connect())
    await page.evaluate(() => localStorage.removeItem('opentubex-notification-history'))
    const store = 'document.querySelector("#app").__vue_app__.config.globalProperties.$store'
    const pending = () => page.evaluate(async () => (await window.Capacitor.Plugins.LocalNotifications.getPending()).notifications.map(notification => notification.id))

    // Records how many copies of each reminder toast are shown at once.
    await page.evaluate(() => {
      window.__toastCopies = {}
      new MutationObserver(() => {
        for (const text of ['Synth jam', 'Read early']) {
          const copies = [...document.querySelectorAll('.toast')].filter(toast => toast.textContent.includes(text)).length
          window.__toastCopies[text] = Math.max(window.__toastCopies[text] ?? 0, copies)
        }
      }).observe(document.body, { subtree: true, childList: true })
    })

    // Schedule like the app does, with the system firing the first reminder in a few seconds.
    await page.evaluate(async ({ due, read, later }) => {
      const now = Date.now()
      const reminders = [
        { videoId: due, startTimestamp: now + 5000, notificationId: 9001, notificationTitle: 'Beta Channel is live', notificationBody: 'Synth jam' },
        { videoId: later, startTimestamp: now + 3_600_000, notificationId: 9002, notificationTitle: 'Gamma Channel is live', notificationBody: 'Later' }
      ]
      // The system can deliver a reminder after the app already found it due.
      const delivered = { videoId: read, startTimestamp: now - 1000, notificationId: 9003, notificationTitle: 'Delta Channel is live', notificationBody: 'Read early' }
      localStorage.setItem('opentubex-capacitor-live-reminders', JSON.stringify([...reminders, delivered]))
      await window.Capacitor.Plugins.LocalNotifications.schedule({
        notifications: [...reminders, { ...delivered, startTimestamp: now + 8000 }].map(reminder => ({
          id: reminder.notificationId,
          title: reminder.notificationTitle,
          body: reminder.notificationBody,
          channelId: 'live-reminders',
          isExactNotification: false,
          schedule: { at: new Date(reminder.startTimestamp), allowWhileIdle: true },
          extra: { videoId: reminder.videoId }
        }))
      })
    }, { due, read, later })
    // Reading the reminders moves the one already due to the history, without a toast yet.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Delta Channel is live: Read early' })).toHaveCount(0)

    await expect.poll(() => page.evaluate(() => window.__toastCopies['Synth jam'] ?? 0), { timeout: 180_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.__toastCopies['Read early'] ?? 0), { timeout: 180_000 }).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Notifications (2 unread)', exact: true })).toBeVisible()
    // Each shows once, even when the system delivers it while the app shows it.
    await new Promise(resolve => setTimeout(resolve, 3000))
    assert.deepEqual(await page.evaluate(() => window.__toastCopies), { 'Synth jam': 1, 'Read early': 1 })
    // The app shows them instead of the system.
    await expect.poll(() => /Synth jam|Read early/.test(adb('shell', 'dumpsys', 'notification', '--noredact'))).toBe(false)

    // An overdue alarm can outlive its record until the system delivers it.
    await page.evaluate(async videoId => window.Capacitor.Plugins.LocalNotifications.schedule({
      notifications: [{ id: 9006, title: 'Eta Channel is live', body: 'Orphan', channelId: 'live-reminders', isExactNotification: false, schedule: { at: new Date(Date.now() + 3_600_000), allowWhileIdle: true }, extra: { videoId } }]
    }), `orphan${run}`.slice(0, 11))
    await expect.poll(pending).toContain(9006)
    await page.evaluate(`${store}.dispatch('updateNotificationMode', 'off')`)
    await expect(page.locator('.notificationCenter')).toHaveCount(0)
    await expect.poll(pending).not.toContain(9002)
    await expect.poll(pending).not.toContain(9006)
    // A reminder that expires while notifications are off never fired, so it stays out of the history.
    await page.evaluate(expired => {
      const records = JSON.parse(localStorage.getItem('opentubex-capacitor-live-reminders'))
      records.push({ videoId: expired, startTimestamp: Date.now() + 1000, notificationId: 9004, notificationTitle: 'Epsilon Channel is live', notificationBody: 'Missed' })
      localStorage.setItem('opentubex-capacitor-live-reminders', JSON.stringify(records))
    }, `expired${run}`.slice(0, 11))
    await new Promise(resolve => setTimeout(resolve, 2000))
    await page.evaluate(`${store}.dispatch('updateNotificationMode', 'both')`)
    await expect.poll(pending).toContain(9002)
    await expect(page.getByRole('button', { name: 'Notifications (2 unread)', exact: true })).toBeVisible()

    // In the background, the system shows the reminder and the app still keeps it.
    await page.evaluate(async videoId => {
      const reminder = { videoId, startTimestamp: Date.now() + 15_000, notificationId: 9005, notificationTitle: 'Zeta Channel is live', notificationBody: 'Background stream' }
      const records = JSON.parse(localStorage.getItem('opentubex-capacitor-live-reminders'))
      localStorage.setItem('opentubex-capacitor-live-reminders', JSON.stringify([...records, reminder]))
      await window.Capacitor.Plugins.LocalNotifications.schedule({
        notifications: [{
          id: reminder.notificationId,
          title: reminder.notificationTitle,
          body: reminder.notificationBody,
          channelId: 'live-reminders',
          isExactNotification: false,
          schedule: { at: new Date(reminder.startTimestamp), allowWhileIdle: true },
          extra: { videoId }
        }]
      })
    }, `bg${run}`.slice(0, 11))
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    await expect.poll(() => adb('shell', 'dumpsys', 'notification', '--noredact').includes('Background stream'), { timeout: 180_000 }).toBe(true)
    // The app hears about the delivery too, and leaves the system notification alone.
    await new Promise(resolve => setTimeout(resolve, 3000))
    assert.ok(adb('shell', 'dumpsys', 'notification', '--noredact').includes('Background stream'))
    launch()
    await expect(page.getByRole('button', { name: 'Notifications (3 unread)', exact: true })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Background stream' })).toHaveCount(0)
  } finally {
    await page?.evaluate(async () => {
      await window.Capacitor.Plugins.LocalNotifications.cancel({ notifications: [{ id: 9001 }, { id: 9002 }, { id: 9003 }, { id: 9004 }, { id: 9005 }, { id: 9006 }] })
      await window.Capacitor.Plugins.LocalNotifications.removeAllDeliveredNotifications()
      localStorage.removeItem('opentubex-capacitor-live-reminders')
      localStorage.removeItem('opentubex-notification-history')
    }).catch(() => {})
    await browser?.close()
    adb('forward', '--remove', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`)
  }
})
