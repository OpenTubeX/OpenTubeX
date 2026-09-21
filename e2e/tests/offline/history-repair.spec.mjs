import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo } from '../../helpers/app.mjs'

const timeWatched = Date.now() - 1000
const original = {
  _id: 'abcdefghijk',
  videoId: 'abcdefghijk',
  title: 'Imported video',
  author: '',
  authorId: '',
  lengthSeconds: 0,
  isLive: true,
  isWatched: true,
  watchProgress: 42,
  timeWatched,
  published: 0,
  type: 'video'
}

test.use({ seed: { history: [original] } })

async function startRepair(page) {
  await page.getByRole('button', { name: 'Repair History', exact: true }).click()
  await page.getByRole('dialog', { name: 'Repair History' }).getByRole('button', { name: 'Start repair', exact: true }).click()
}

test('repairs imported history metadata without changing watch state', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.route('**/youtubei/v1/player*', route => route.fulfill({
    json: {
      videoDetails: {
        videoId: original.videoId,
        title: 'Imported video',
        author: 'Recovered channel',
        channelId: 'UCabcdefghijklmnopqrstuv',
        lengthSeconds: '120',
        isLiveContent: true
      },
      microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
    }
  }))
  await goTo(page, 'history')
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
  await expect(page.getByRole('heading', { name: 'Repair finished', exact: true })).toBeVisible()
  await expect(page.getByText('Recovered channel', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
  expect(saved).toMatchObject({
    isLive: false,
    liveNow: false,
    isUpcoming: false,
    lengthSeconds: 120,
    isWatched: true,
    watchProgress: 42,
    published: Date.parse('2025-01-01'),
    timeWatched
  })
  await page.screenshot({ path: testInfo.outputPath('history-repair.png') })
  await page.reload()
  await goTo(page, 'history')
  await expect(page.getByText('Recovered channel', { exact: true })).toBeVisible()
})

test('failed history metadata requests leave imported entries intact', async ({ page }) => {
  await page.route('**/youtubei/v1/player*', route => route.fulfill({ json: { playabilityStatus: { status: 'ERROR' } } }))
  await goTo(page, 'history')
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
  await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
  await expect(page.getByText('Imported video', { exact: true })).toBeVisible()
})

test('keeps Cancel available if history is cleared during a repair', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/player*', async route => {
    await pending
    await route.fulfill({ json: {} }).catch(() => {})
  })
  try {
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removeAllHistory'))
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  } finally {
    release()
  }
})

test('can dismiss the repair status after the repair stops', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/player*', async route => {
    await pending
    await route.fulfill({ json: {} }).catch(() => {})
  })
  try {
    await goTo(page, 'history')
    await startRepair(page)
    const status = page.getByRole('region', { name: 'Repair History' })
    await expect(status.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await expect(status.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    await status.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(status.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    await status.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(status).toHaveCount(0)
  } finally {
    release()
  }
})

test.describe('Invidious history repair', () => {
  test.use({
    seed: {
      settings: { backendPreference: 'invidious', defaultInvidiousInstance: 'https://history-repair.test' },
      history: [original]
    }
  })

  for (const isUpcoming of [false, true]) {
    test(`uses Invidious metadata with upcoming status ${isUpcoming}`, async ({ page }) => {
      await page.route('https://history-repair.test/api/v1/videos/**', route => route.fulfill({
        json: {
          videoId: original.videoId,
          title: original.title,
          author: 'Invidious channel',
          authorId: 'UCabcdefghijklmnopqrstuv',
          lengthSeconds: 120,
          liveNow: false,
          isUpcoming,
          published: 1735689600
        }
      }))
      await goTo(page, 'history')
      await startRepair(page)
      await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
      await expect(page.getByText('Invidious channel', { exact: true })).toBeVisible()
      const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
      expect(saved.isUpcoming).toBe(isUpcoming)
      expect(saved.isLive).toBe(false)
      expect(saved.liveNow).toBe(false)
    })
  }

  test('preserves live flags when Invidious omits the upcoming status', async ({ page }) => {
    await page.route('https://history-repair.test/api/v1/videos/**', route => route.fulfill({
      json: {
        videoId: original.videoId,
        title: original.title,
        author: 'Invidious channel',
        authorId: 'UCabcdefghijklmnopqrstuv',
        lengthSeconds: 120,
        liveNow: false,
        published: 1735689600
      }
    }))
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved.isLive).toBe(true)
    expect(saved.lengthSeconds).toBe(0)
  })
})

for (const failure of ['HTTP', 'network']) {
  test(`retries a temporary ${failure} failure without restarting repair`, async ({ page }) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      if (++requests === 1) {
        if (failure === 'HTTP') await route.fulfill({ status: 503, body: 'Service unavailable' })
        else await route.abort('failed')
        return
      }
      await route.fulfill({
        json: {
          videoDetails: {
            videoId: original.videoId,
            title: original.title,
            author: 'Recovered channel',
            channelId: 'UCabcdefghijklmnopqrstuv',
            lengthSeconds: '120'
          },
          microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
        }
      })
    })
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
    expect(requests).toBe(2)
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved).toMatchObject({
      author: 'Recovered channel',
      lengthSeconds: 120,
      isLive: false,
      watchProgress: original.watchProgress,
      timeWatched: original.timeWatched,
      isWatched: original.isWatched
    })
  })
}

for (const responseType of ['bot check', 'HTTP 429']) {
  test(`waits before recovering from a ${responseType}`, async ({ page }, testInfo) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      if (++requests === 1) {
        if (responseType === 'HTTP 429') await route.fulfill({ status: 429, body: 'Too many requests' })
        else await route.fulfill({ json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } } })
        return
      }
      await route.fulfill({
        json: {
          videoDetails: { videoId: original.videoId, author: 'Recovered channel', channelId: 'UCabcdefghijklmnopqrstuv', lengthSeconds: '120' },
          microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
        }
      })
    })
    await goTo(page, 'history')
    await page.clock.install()
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
    await expect(page.getByRole('heading', { name: 'Waiting for YouTube. Repair will resume automatically.' })).toBeVisible()
    await expect(page.getByRole('progressbar')).not.toHaveAttribute('value')
    if (responseType === 'bot check') await page.screenshot({ path: testInfo.outputPath('repair-waiting.png') })
    await page.clock.fastForward(29000)
    expect(requests).toBe(1)
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.clock.fastForward(1000)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
    expect(requests).toBe(2)
  })
}

test('reports a persistent bot check and stops retrying', async ({ page }) => {
  const reason = 'Sign in to confirm you’re not a bot'
  let requests = 0
  await page.route('**/youtubei/v1/player*', async route => {
    requests++
    await route.fulfill({ json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason } } })
  })
  await goTo(page, 'history')
  await page.clock.install()
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
  await page.clock.fastForward(30000)
  await expect.poll(() => requests).toBe(2)
  await expect.poll(async () => {
    await page.clock.fastForward(1000)
    return requests
  }, { intervals: [50] }).toBe(3)
  await expect(page.getByRole('alert')).toHaveText(reason)
  await expect(page.getByRole('heading', { name: 'Repair stopped', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
  expect(requests).toBe(3)
})

for (const width of [1280, 375]) {
  test(`explains repair before starting at ${width}px`, async ({ page }, testInfo) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      requests++
      await route.fulfill({ json: {} })
    })
    await page.setViewportSize({ width, height: 812 })
    await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), width === 1280 ? 'dark' : 'light')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair History' })
    await expect(dialog).toContainText('Use this after importing history')
    await expect(dialog).toContainText('Your watch progress and watched status stay unchanged.')
    await expect(dialog).toContainText('Deleted or private videos may stay incomplete.')
    await expect(dialog.getByRole('button', { name: 'Start repair' })).toBeInViewport()
    expect(requests).toBe(0)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`repair-explanation-${width}.png`), animations: 'disabled' })
    await dialog.screenshot({ path: testInfo.outputPath(`repair-dialog-${width}.png`), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeFocused()
    expect(requests).toBe(0)
  })
}

test.describe('German repair explanation', () => {
  test.use({ seed: { history: [original], settings: { currentLocale: 'de-DE', baseTheme: 'light', uiScale: 125 } } })

  test('fits the explanation and actions at 125% scale in a short window', async ({ app, page }, testInfo) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(850, 450)
      window.webContents.setZoomFactor(1.25)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Verlauf reparieren', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Verlauf reparieren' })
    await expect(dialog.getByRole('button', { name: 'Reparatur starten' })).toBeInViewport()
    await expect(dialog.getByRole('heading')).toBeInViewport()
    const scroller = dialog.locator('.promptContentScroller')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(dialog.getByRole('heading')).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Reparatur starten' })).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('repair-explanation-german.png'), animations: 'disabled' })
    expect(await dialog.getByRole('button', { name: 'Reparatur starten' }).evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight
    })).toBe(true)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(850, 900)
    })
    await expect.poll(() => scroller.evaluate(element => ({
      scrollTop: element.scrollTop,
      hasVisibleScrollbar: element.querySelector(':scope > .os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible') ?? false
    }))).toEqual({ scrollTop: 0, hasVisibleScrollbar: false })
  })
})

for (const outcome of ['finish', 'cancel']) {
  test(`restores focus to Repair History after ${outcome}`, async ({ page }) => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    await page.route('**/youtubei/v1/player*', async route => {
      await pending
      await route.fulfill({ json: { videoDetails: { videoId: original.videoId, lengthSeconds: '120' } } }).catch(() => {})
    })
    try {
      await goTo(page, 'history')
      await startRepair(page)
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeFocused()
      if (outcome === 'cancel') await cancel.click()
      else release()
      await expect(cancel).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeFocused()
    } finally {
      release()
    }
  })
}

for (const backend of ['local', 'invidious']) {
  test.describe(`${backend} repair failure classification`, () => {
    test.use({ seed: { history: [original], settings: { backendPreference: backend, defaultInvidiousInstance: 'https://history-repair.test' } } })

    for (const failure of [403, 404, 'unavailable', 'malformed', 429, 503]) {
      test(`handles ${failure} without unnecessary retries`, async ({ page }) => {
        let requests = 0
        await page.clock.install()
        await page.route(backend === 'local' ? '**/youtubei/v1/player*' : '**/api/v1/videos/*', async route => {
          requests++
          if (requests === 1) {
            if (failure === 'unavailable') await route.fulfill({ json: backend === 'local' ? { playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } } : { error: 'Video unavailable' } })
            else if (failure === 'malformed') await route.fulfill({ body: '{', contentType: 'application/json' })
            else await route.fulfill({ status: failure, body: 'Request failed' })
            return
          }
          const info = { videoId: original.videoId, title: original.title, author: 'Recovered channel', authorId: 'UCabcdefghijklmnopqrstuv', lengthSeconds: 120, published: 1, liveNow: false, isUpcoming: false }
          await route.fulfill({ json: backend === 'local' ? { videoDetails: { ...info, channelId: info.authorId } } : info })
        })
        await goTo(page, 'history')
        await startRepair(page)
        if (failure === 429 || failure === 503) {
          await expect(page.getByRole('heading', { name: failure === 429 ? 'Waiting for YouTube. Repair will resume automatically.' : 'Retrying failed requests', exact: true })).toBeVisible()
          expect(requests).toBe(1)
          await page.clock.fastForward(failure === 429 ? 30000 : 1000)
          await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
          expect(requests).toBe(2)
        } else {
          await expect(page.getByRole('heading', { name: 'Repair finished', exact: true })).toBeVisible()
          await page.clock.fastForward(10000)
          expect(requests).toBe(1)
          await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
          const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
          expect(saved).toMatchObject(original)
        }
      })
    }
  })
}

test.describe('history repair cookies', () => {
  for (const mode of ['file', 'browser', 'none']) {
    test.describe(mode, () => {
      test.use({
        seed: {
          history: Array.from({ length: 501 }, (_, index) => ({ ...original, _id: String(index).padStart(11, '0'), videoId: String(index).padStart(11, '0') })),
          settings: { ytDlpPlaybackAuthMode: mode, ytDlpPlaybackCookiesPath: '/tmp/history-cookies.txt', ytDlpPlaybackCookiesBrowser: 'firefox' }
        }
      })
      test('offers configured cookies and warns only above 500 pending checks', async ({ page }, testInfo) => {
        await goTo(page, 'history')
        await page.getByRole('button', { name: 'Repair History', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Repair History' })
        const checkbox = dialog.getByRole('checkbox', { name: 'Use configured yt-dlp cookies' })
        const hint = dialog.getByText('More than 500 videos need checking.', { exact: false })
        await expect(hint).toBeVisible()
        if (mode === 'file') {
          for (const theme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme: theme })
            await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
            await dialog.screenshot({ path: testInfo.outputPath(`history-repair-cookies-${theme}.png`), animations: 'disabled' })
          }
        }
        if (mode === 'none') {
          await expect(checkbox).toHaveCount(0)
        } else {
          await expect(checkbox).not.toBeChecked()
          await dialog.getByText('Use configured yt-dlp cookies', { exact: true }).click()
          await expect(checkbox).toBeChecked()
          await expect(hint).toHaveCount(0)
          await checkbox.focus()
          await checkbox.press('Space')
          await expect(checkbox).not.toBeChecked()
          await expect(hint).toBeVisible()
        }
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return store.dispatch('updateSubscriptionHistory', { metadata: [{ videoId: '00000000000', author: 'Channel', authorId: 'channel', published: 1, lengthSeconds: 120, isLive: false }] })
        })
        await expect(hint).toHaveCount(0)
      })
    })
  }
})

test.describe('authenticated history metadata', () => {
  test.use({ seed: { history: [original], settings: { ytDlpPlaybackAuthMode: 'file', ytDlpPlaybackCookiesPath: '/tmp/history-cookies.txt' } } })
  test('uses yt-dlp when checked and preserves watch progress', async ({ page, app }, testInfo) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
    const executable = path.join(app.userDataDir, 'history-yt-dlp.sh')
    const capturedArgs = path.join(app.userDataDir, 'history-args.txt')
    const metadata = { id: original.videoId, title: 'Imported video', channel: 'Cookie channel', channel_id: 'UCabcdefghijklmnopqrstuv', duration: 120, upload_date: '20250920', live_status: 'was_live' }
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${capturedArgs}'`,
      `printf '%s' '${JSON.stringify(metadata)}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async executable => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', executable)
    }, executable)
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair History' })
    await dialog.getByText('Use configured yt-dlp cookies', { exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('history-repair-cookies.png') })
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    const args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
    expect(args[args.indexOf('--cookies') + 1]).toBe('/tmp/history-cookies.txt')
    expect(args).toContain('--skip-download')
    expect(args.at(-1)).toBe(`https://www.youtube.com/watch?v=${original.videoId}`)
    expect(saved).toMatchObject({ author: 'Cookie channel', published: Date.parse('2025-09-20'), lengthSeconds: 120, isLive: false, watchProgress: 42, isWatched: true })
  })
})

test.describe('cookie repair cancellation', () => {
  test.use({ seed: { history: [original], settings: { ytDlpPlaybackAuthMode: 'file', ytDlpPlaybackCookiesPath: '/tmp/history-cookies.txt' } } })
  test('cancels pending cookie requests without saving late metadata', async ({ page, app }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-history-metadata')
      globalThis.historyCookieRequestStarted = false
      ipcMain.handle('yt-dlp-get-history-metadata', () => new Promise(resolve => {
        globalThis.historyCookieRequestStarted = true
        globalThis.finishHistoryCookieRequest = () => resolve({ id: 'abcdefghijk', channel: 'Late channel', duration: 120 })
      }))
    })
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair History' })
    await dialog.getByText('Use configured yt-dlp cookies', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.historyCookieRequestStarted)).toBe(true)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    try {
      await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled({ timeout: 2000 })
    } finally {
      await app.electronApp.evaluate(() => globalThis.finishHistoryCookieRequest())
    }
    await expect(page.getByText('Late channel', { exact: true })).toHaveCount(0)
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved.author).toBe('')
  })
})

test.describe('native cookie repair cancellation', () => {
  test.use({ seed: { history: [original], settings: { ytDlpPlaybackAuthMode: 'file', ytDlpPlaybackCookiesPath: '/tmp/history-cookies.txt' } } })
  test('terminates the desktop metadata process on cancel', async ({ page, app }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
    const executable = path.join(app.userDataDir, 'pending-history-yt-dlp.sh')
    const pidFile = path.join(app.userDataDir, 'history-pid.txt')
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > '${pidFile}'\nexec sleep 30\n`)
    await chmod(executable, 0o755)
    await page.evaluate(async executable => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateYtDlpPath', executable)
    }, executable)
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair History' })
    await dialog.getByText('Use configured yt-dlp cookies', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect.poll(() => readFile(pidFile, 'utf8').catch(() => '')).toMatch(/^\d+$/)
    const pid = Number(await readFile(pidFile, 'utf8'))
    try {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect.poll(() => {
        try { process.kill(pid, 0); return true } catch { return false }
      }, { timeout: 2000 }).toBe(false)
    } finally {
      try { process.kill(pid) } catch { /* Already stopped. */ }
    }
  })
})
