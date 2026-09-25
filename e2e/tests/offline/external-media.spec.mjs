import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { expect, goTo, repoRoot, sel, setWindowSize, test } from '../../helpers/app.mjs'
import { activeTab, waitForPlayback } from '../../helpers/player.mjs'
import { DEMO_MEDIA_PATH, DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'

async function prepareTwitchYtDlp(app, page, mediaUrl, live, description = '') {
  const executable = path.join(app.userDataDir, `twitch-${live ? 'live' : 'replay'}-yt-dlp.sh`)
  const response = JSON.stringify({
    title: live ? 'A Twitch livestream' : 'A Twitch broadcast',
    description,
    webpage_url: mediaUrl,
    live_status: live ? 'is_live' : 'was_live',
    ...(live ? {} : { duration: 30 }),
    formats: [{
      format_id: 'webm-360',
      url: DEMO_MEDIA_URL,
      protocol: 'https',
      ext: 'webm',
      vcodec: 'vp9',
      acodec: 'opus',
      width: 640,
      height: 360,
      tbr: 200
    }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)
}

test('adds a web URL from Downloads and passes it to yt-dlp', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const executable = path.join(app.userDataDir, 'external-download-yt-dlp.sh')
  const argsFile = path.join(app.userDataDir, 'external-download-args.txt')
  await writeFile(executable, [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > '${argsFile}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async ({ ytDlpPath, folder }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
    await store.dispatch('updateYtDlpFfmpegSource', 'system')
    await store.dispatch('updateYtDlpDownloadFolderPath', folder)
  }, { ytDlpPath: executable, folder: app.userDataDir })
  await goTo(page, 'downloads')
  await page.getByRole('button', { name: 'Add download' }).click()
  const urlPrompt = page.getByRole('dialog', { name: 'Add download' })
  await expect(urlPrompt).toBeVisible()
  await urlPrompt.getByRole('textbox', { name: 'URL' }).fill('file:///tmp/video.mp4')
  await expect(urlPrompt.getByRole('button', { name: 'Next' })).toBeDisabled()
  await urlPrompt.getByRole('textbox', { name: 'URL' }).fill('https://vimeo.com/123456789')
  await urlPrompt.getByRole('textbox', { name: 'URL' }).press('Enter')
  const options = page.getByRole('dialog', { name: 'https://vimeo.com/123456789' })
  await expect(options).toBeVisible()
  await options.getByRole('button', { name: 'Download', exact: true }).click()
  await expect.poll(() => readFile(argsFile, 'utf8').catch(() => '')).toContain('https://vimeo.com/123456789')
  await options.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Add download' }).click()
  await expect(page.getByRole('dialog', { name: 'Add download' }).getByRole('textbox', { name: 'URL' })).toBeEmpty()
})

test('offers in-app playback for YouTube URL downloads only', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const [id, title, externalUrl, videoId] of [
      [101, 'YouTube URL download', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'jNQXAC9IVRw'],
      [102, 'Other site download', 'https://vimeo.com/123456789', '123456789']
    ]) {
      store.commit('upsertYtDlpDownload', {
        id,
        title,
        mode: 'video',
        status: 'completed',
        destination: '/tmp/example.mp4',
        retryPayload: { externalUrl },
        files: [{ videoId, path: '/tmp/example.mp4', available: true }]
      })
    }
  })
  await goTo(page, 'downloads')
  await expect(page.locator('.downloadRow').filter({ hasText: 'YouTube URL download' }).getByRole('button', { name: 'Play download' })).toBeVisible()
  await expect(page.locator('.downloadRow').filter({ hasText: 'Other site download' }).getByRole('button', { name: 'Play download' })).toHaveCount(0)
})

test('offers download options for external media', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false)
  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  const externalMedia = page.locator(`${activeTab} .externalMedia`)
  await externalMedia.getByRole('button', { name: 'Download Video' }).click()
  await expect(page.getByRole('dialog', { name: 'A Twitch broadcast' })).toBeVisible()
})

test('external media cards are separated on phone layouts', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false, 'A Twitch broadcast description')
  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  const externalMedia = page.locator(`${activeTab} .externalMedia`)
  await expect(externalMedia.locator('.externalMediaDescription')).toBeVisible()
  await expect(externalMedia.locator('.twitchChat')).toBeVisible()

  for (const scale of [1, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    await page.setViewportSize({ width: 375, height: 667 })
    const cards = ['.externalMediaDetails', '.externalMediaDescription', '.twitchChat']
    for (const [index, selector] of cards.entries()) {
      if (index === 0) continue
      const previous = await externalMedia.locator(cards[index - 1]).boundingBox()
      const current = await externalMedia.locator(selector).boundingBox()
      expect(current.y - previous.y - previous.height).toBeGreaterThanOrEqual(12)
    }
  }
})

test('Twitch replay uses the watch chat toggle and side panel', async ({ app, page, attachScreenshot }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  await setWindowSize(app, page, { width: 1800, height: 1000 })

  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  const externalMedia = page.locator(`${activeTab} .externalMedia`)
  expect(await externalMedia.locator('.externalMediaPlayer video').evaluate(video => video.ui.getConfiguration().overflowMenuButtons)).toContain('playback_rate')
  const toggle = externalMedia.locator('.externalMediaDetails').getByRole('button', { name: 'Close Live Chat Replay' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(externalMedia.locator('.twitchChat')).toBeVisible()
  const playerBox = await externalMedia.locator('.externalMediaPlayer').boundingBox()
  const chatBox = await externalMedia.locator('.twitchChat').boundingBox()
  const infoBox = await externalMedia.locator('.externalMediaDetails').boundingBox()
  expect(chatBox.x).toBeGreaterThan(playerBox.x + playerBox.width - 5)
  expect(Math.abs(chatBox.y - playerBox.y)).toBeLessThan(12)
  expect(Math.abs(infoBox.x - playerBox.x)).toBeLessThan(12)
  expect(infoBox.width).toBeLessThanOrEqual(playerBox.width + 12)
  expect(chatBox.height).toBeGreaterThan(playerBox.height * 0.8)
  await attachScreenshot('Twitch chat normal layout')

  await externalMedia.locator('.externalMediaPlayer').hover()
  await externalMedia.locator('.externalMediaPlayer .theatre-button').click()
  await externalMedia.locator('.externalMediaPlayer').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const theatrePlayerBox = await externalMedia.locator('.externalMediaPlayer').boundingBox()
  const theatreChatBox = await externalMedia.locator('.twitchChat').boundingBox()
  expect(theatrePlayerBox.width).toBeGreaterThan(playerBox.width * 1.25)
  expect(theatreChatBox.y).toBeGreaterThan(theatrePlayerBox.y + theatrePlayerBox.height - 5)
  await attachScreenshot('Twitch chat theatre layout')
  await externalMedia.locator('.externalMediaPlayer .theatre-button').click()
  await externalMedia.locator('.externalMediaPlayer').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))

  await toggle.click()
  await expect(externalMedia.locator('.twitchChat')).toHaveCount(0)
  const closedPlayerBox = await externalMedia.locator('.externalMediaPlayer').boundingBox()
  expect(Math.abs(closedPlayerBox.width - theatrePlayerBox.width)).toBeLessThan(2)
  const closedToggle = externalMedia.locator('.externalMediaDetails').getByRole('button', { name: 'Show Live Chat Replay' })
  await expect(closedToggle).toHaveAttribute('aria-pressed', 'false')
  await closedToggle.click()
  await expect(externalMedia.locator('.twitchChat')).toBeVisible()
  await externalMedia.locator('.twitchChat').getByRole('button', { name: 'Close Live Chat Replay' }).click()
  await expect(externalMedia.locator('.twitchChat')).toHaveCount(0)
  await expect(closedToggle).toHaveAttribute('aria-pressed', 'false')

  await closedToggle.click()
  await externalMedia.locator('.externalMediaPlayer .ftVideoPlayer').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('s')
  const fullscreenChatToggle = externalMedia.locator('.fullscreenLiveChatToggle')
  await fullscreenChatToggle.click()
  await expect(externalMedia.locator('.fullscreenLiveChatTarget .twitchChat')).toBeVisible()
  await externalMedia.locator('.fullscreenLiveChatTarget .twitchChat').getByRole('button', { name: 'Close Live Chat Replay' }).click()
  await expect(externalMedia.locator('.twitchChat')).toHaveCount(0)
  await page.keyboard.press('s')
})

test('Twitch livestream omits playback speed from player options', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/testchannel'
  await prepareTwitchYtDlp(app, page, mediaUrl, true)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseQuickPlaybackSpeedBar', true))
  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')

  const player = page.locator(`${activeTab} .externalMediaPlayer`)
  await expect(player.locator('.shaka-overflow-menu-button')).toBeVisible()
  expect(await player.locator('video').evaluate(video => video.ui.getConfiguration().overflowMenuButtons)).not.toContain('playback_rate')
  expect(await player.locator('video').evaluate(video => video.ui.getConfiguration().controlPanelElements)).not.toContain('ft_quick_playback_rate_bar')
})

test('failed external media keeps its site title after unloading', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const executable = path.join(app.userDataDir, 'failing-yt-dlp.sh')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    'printf "%s\\n" "Media unavailable" >&2',
    'exit 1'
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.twitch.tv/unavailable')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaError`)).toBeVisible()
  await page.locator(sel.newTabButton).click()
  const tab = page.locator(sel.tabs).first()
  await tab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unload Tab', exact: true }).click()
  await expect(tab).toHaveClass(/unloaded/)
  await expect(tab.locator('.tabTitleText')).toContainText('www.twitch.tv')
})

for (const iconPack of ['material', 'remix']) {
  test.describe(`external platform tab icons with ${iconPack}`, () => {
    test.use({ seed: { settings: { iconPack } } })

    test('shows a bundled platform icon on an unloaded tab', async ({ page }, testInfo) => {
      const tab = await page.evaluate(() => window.ftElectron.tabs.create({
        route: '/external-media',
        query: { url: 'https://www.twitch.tv/example' },
        makeActive: false,
        lazyLoad: true
      }))
      const icon = page.locator(`.tab[data-tab-id="${tab.id}"] .tabPageIcon`)
      await expect(icon).toHaveAttribute('data-prefix', 'fab')
      await expect(icon).toHaveAttribute('data-icon', 'twitch')
      await expect(icon.locator('svg')).toBeVisible()
      await testInfo.attach(`${iconPack} Twitch tab`, {
        body: await page.locator(`.tab[data-tab-id="${tab.id}"]`).screenshot(),
        contentType: 'image/png'
      })
    })
  })
}

test('unknown external sites use their own favicon while unloaded', async ({ page }) => {
  await page.route('https://media.example/favicon.ico', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  }))
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/external-media',
    query: { url: 'https://media.example/video' },
    makeActive: false,
    lazyLoad: true
  }))
  const tabElement = page.locator(`.tab[data-tab-id="${tab.id}"]`)
  await expect(tabElement).toHaveClass(/unloaded/)
  await expect(tabElement.locator('img.tabAvatar')).toHaveAttribute('src', 'https://media.example/favicon.ico')
  await expect(tabElement.locator('img.tabAvatar')).toBeVisible()
})

test('unknown external sites use the web icon when no favicon is available', async ({ page }) => {
  await page.route('https://media.example/favicon.ico', route => route.abort())
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/external-media',
    query: { url: 'https://media.example/video' },
    makeActive: false,
    lazyLoad: true
  }))
  const tabElement = page.locator(`.tab[data-tab-id="${tab.id}"]`)
  await expect(tabElement).toHaveClass(/unloaded/)
  await expect(tabElement.locator('.tabPageIcon')).toHaveAttribute('data-icon', 'globe')
})

test.describe('Twitch theater mode at 125% UI scale', () => {
  test.use({ seed: { settings: { uiScale: 125 } } })

  test('animates in both directions', async ({ app, page }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
    await setWindowSize(app, page, { width: 1800, height: 1000 })
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'no-preference' })
    const mediaUrl = 'https://www.twitch.tv/videos/123456789'
    await prepareTwitchYtDlp(app, page, mediaUrl, false)
    await page.locator(sel.searchInput).fill(mediaUrl)
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator(`${activeTab} .externalMediaPlayer`)
    const theaterButton = player.locator('.theatre-button')
    await expect(theaterButton).toBeVisible()
    for (const enabled of [true, false]) {
      await theaterButton.press('Enter')
      await expect(page.locator(`${activeTab} .externalMediaLayout`)).toHaveClass(enabled ? /useTheatreMode/ : /^(?!.*useTheatreMode)/)
      expect(await player.evaluate(element => element.getAnimations().some(animation =>
        animation.effect.getKeyframes().some(frame => frame.transform?.includes('scale('))
      ))).toBe(true)
      await player.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
    }

    const jump = await player.evaluate(async element => {
      const button = element.querySelector('.theatre-button')
      button.click()
      await new Promise(resolve => setTimeout(resolve, 120))
      const before = element.getBoundingClientRect()
      button.click()
      await new Promise(resolve => requestAnimationFrame(resolve))
      const after = element.getBoundingClientRect()
      return Math.max(
        Math.abs(after.x - before.x),
        Math.abs(after.y - before.y),
        Math.abs(after.width - before.width),
        Math.abs(after.height - before.height)
      )
    })
    expect(jump).toBeLessThan(60)
  })
})

test('Twitch replay retries a failed page and refreshes once after seeking settles', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false)
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.twitchReplayRequests = 0
    ipcMain.removeHandler('twitch-chat-replay-page')
    ipcMain.handle('twitch-chat-replay-page', () => {
      globalThis.twitchReplayRequests++
      if (globalThis.twitchReplayRequests === 1) throw new Error('Temporary Twitch failure')
      return {
        data: {
          video: {
            comments: {
              pageInfo: { hasNextPage: false },
              edges: [{
                cursor: 'last',
                node: {
                  id: 'recovered',
                  contentOffsetSeconds: 0,
                  commenter: { displayName: 'Viewer' },
                  message: { fragments: [{ text: 'Recovered chat' }] }
                }
              }]
            }
          }
        }
      }
    })
  })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .twitchChat`).getByText('Recovered chat')).toBeVisible({ timeout: 10_000 })
  expect(await app.electronApp.evaluate(() => globalThis.twitchReplayRequests)).toBe(2)

  await page.locator(`${activeTab} .externalMediaPlayer video`).evaluate(video => {
    for (let index = 0; index < 3; index++) video.dispatchEvent(new Event('seeking'))
  })
  await page.waitForTimeout(300)
  expect(await app.electronApp.evaluate(() => globalThis.twitchReplayRequests)).toBe(2)
  await page.locator(`${activeTab} .externalMediaPlayer video`).evaluate(video => {
    for (let index = 0; index < 3; index++) video.dispatchEvent(new Event('seeked'))
  })
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.twitchReplayRequests)).toBe(3)
  await page.waitForTimeout(300)
  expect(await app.electronApp.evaluate(() => globalThis.twitchReplayRequests)).toBe(3)
})

test('Twitch replay waits for a seek to settle before fetching from the new position', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false)
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.twitchReplayPositions = []
    ipcMain.removeHandler('twitch-chat-replay-page')
    ipcMain.handle('twitch-chat-replay-page', (_event, _videoId, position) => {
      globalThis.twitchReplayPositions.push(position)
      return {
        data: {
          video: {
            comments: {
              pageInfo: { hasNextPage: position !== 25 },
              edges: [{
                cursor: 'next',
                node: {
                  id: String(position),
                  contentOffsetSeconds: position === 25 ? 25 : 21,
                  commenter: { displayName: 'Viewer' },
                  message: { fragments: [{ text: String(position) }] }
                }
              }]
            }
          }
        }
      }
    })
  })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  const video = page.locator(`${activeTab} .externalMediaPlayer video`)
  await video.evaluate(element => element.pause())
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.twitchReplayPositions.length)).toBe(1)

  await video.evaluate(element => {
    element.addEventListener('seeked', event => event.stopImmediatePropagation(), { capture: true, once: true })
    element.currentTime = 25
    element.dispatchEvent(new Event('seeking'))
  })
  await page.waitForTimeout(300)
  expect(await app.electronApp.evaluate(() => globalThis.twitchReplayPositions)).toHaveLength(1)
  await expect(page.locator(`${activeTab} .twitchChat`).getByText('21')).toHaveCount(0)

  await video.evaluate(element => element.dispatchEvent(new Event('seeked')))
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.twitchReplayPositions)).toEqual([0, 25])
  await expect(page.locator(`${activeTab} .twitchChat`).getByText('25')).toBeVisible()
})

test('Twitch replay continues past a page with no usable messages', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const mediaUrl = 'https://www.twitch.tv/videos/123456789'
  await prepareTwitchYtDlp(app, page, mediaUrl, false)
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('twitch-chat-replay-page')
    ipcMain.handle('twitch-chat-replay-page', async (_event, _videoId, position) => {
      if (position !== 'next') await new Promise(resolve => setTimeout(resolve, 1000))
      return {
        data: {
          video: {
            comments: position === 'next'
              ? {
                  pageInfo: { hasNextPage: false },
                  edges: [{
                    cursor: 'last',
                    node: {
                      id: 'after-empty-page',
                      contentOffsetSeconds: 0,
                      commenter: { displayName: 'Viewer' },
                      message: { fragments: [{ text: 'Chat after empty page' }] }
                    }
                  }]
                }
              : { pageInfo: { hasNextPage: true }, edges: [{ cursor: 'next', node: null }] }
          }
        }
      }
    })
  })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await page.locator(`${activeTab} .externalMediaPlayer video`).evaluate(video => video.pause())
  await expect(page.locator(`${activeTab} .twitchChat`).getByText('Chat after empty page')).toBeVisible()
})

test('Twitch live chat scrolls like the YouTube chat panel', async ({ app, page, attachScreenshot }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  await setWindowSize(app, page, { width: 1800, height: 1000 })

  const mediaUrl = 'https://www.twitch.tv/testchannel'
  await prepareTwitchYtDlp(app, page, mediaUrl, true)
  await page.evaluate(() => {
    class MockTwitchSocket extends EventTarget {
      constructor() {
        super()
        window.mockTwitchSocket = this
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }

      send() {}
      close() {}
    }
    window.WebSocket = MockTwitchSocket
  })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  const chat = page.locator(`${activeTab} .twitchChat`)
  await expect(chat).toBeVisible()
  await page.evaluate(() => {
    const lines = Array.from({ length: 100 }, (_, index) =>
      `@display-name=Viewer;id=message-${index};tmi-sent-ts=1700000000000 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #testchannel :Test message ${index}`)
    window.mockTwitchSocket.dispatchEvent(new MessageEvent('message', { data: `${lines.join('\r\n')}\r\n` }))
  })
  const scroller = chat.locator('.liveChatComments')
  await expect(scroller.locator('.comment')).toHaveCount(100)
  await expect(scroller.locator('.twitchChatAvatar')).toHaveCount(0)
  expect(await scroller.locator('.chatContent').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')
  await chat.getByRole('button', { name: 'Live chat settings' }).click()
  await chat.getByText('Show timestamps').click()
  await expect(scroller.locator('.liveChatTimestamp')).toHaveCount(100)
  await chat.getByRole('button', { name: 'Live chat settings' }).click()
  const scrollRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
  expect(scrollRange).toBeGreaterThan(100)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollRange - 20)
  await scroller.hover()
  await page.mouse.wheel(0, -300)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(scrollRange - 20)
  await expect(chat.getByRole('button', { name: 'Scroll to Bottom' })).toBeVisible()
  const scrolledTop = await scroller.evaluate(element => element.scrollTop)
  await page.evaluate(() => {
    window.mockTwitchSocket.dispatchEvent(new MessageEvent('message', {
      data: '@display-name=Viewer;id=message-100;tmi-sent-ts=1700000000000 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #testchannel :New message\r\n'
    }))
  })
  await expect(scroller.locator('.comment')).toHaveCount(101)
  expect(Math.abs((await scroller.evaluate(element => element.scrollTop)) - scrolledTop)).toBeLessThan(2)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveClass(/\bdark\b/)
  await attachScreenshot('Twitch live chat scrolled up')
  await chat.getByRole('button', { name: 'Scroll to Bottom' }).click()
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  await chat.getByRole('button', { name: 'Live chat settings' }).click()
  await chat.getByText('Show timestamps').click()
  await expect(scroller.locator('.liveChatTimestamp')).toHaveCount(0)
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)

  await setWindowSize(app, page, { width: 1500, height: 980 })
  await page.evaluate(() => {
    const longText = 'A long Twitch chat message with several words to wrap. '.repeat(8)
    const lines = Array.from({ length: 20 }, (_, index) =>
      `@display-name=Viewer;id=long-${index};tmi-sent-ts=1700000000000 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #testchannel :${longText}`)
    window.mockTwitchSocket.dispatchEvent(new MessageEvent('message', { data: `${lines.join('\r\n')}\r\n` }))
  })
  await expect(scroller.locator('.comment')).toHaveCount(121)
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  const beforeReflowHeight = await scroller.locator('.liveChatCommentList').evaluate(element => element.scrollHeight)
  await setWindowSize(app, page, { width: 1800, height: 1000 })
  await expect.poll(() => scroller.locator('.liveChatCommentList').evaluate(element => element.scrollHeight))
    .toBeLessThan(beforeReflowHeight)
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
  await page.evaluate(() => window.ftElectron.setZoomFactor(1))

  await page.locator(`${activeTab} .externalMediaPlayer .ftVideoPlayer`).click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('s')
  await page.locator(`${activeTab} .fullscreenLiveChatToggle`).click()
  const dockedChat = page.locator(`${activeTab} .fullscreenLiveChatTarget .twitchChat`)
  await expect(dockedChat).toBeVisible()
  const dockedScroller = dockedChat.locator('.liveChatComments')
  expect(await dockedScroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
  await dockedScroller.hover()
  await page.mouse.wheel(0, -300)
  await expect(dockedChat.getByRole('button', { name: 'Scroll to Bottom' })).toBeVisible()
  await dockedChat.getByRole('button', { name: 'Scroll to Bottom' }).click()
  await expect.poll(() => dockedScroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  await page.keyboard.press('s')
})

test('shows search for an unknown URL on the selected Invidious instance', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
  })
  await page.locator(sel.searchInput).fill('https://invidious.test/does/not/exist')
  await expect(page.locator('.topNav .searchInput .inputAction .buttonIcon'))
    .toHaveAttribute('data-icon', 'magnifying-glass')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/search\//)
})

test('impersonates Chrome when extracting Rumble playback', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'rumble-yt-dlp.sh')
  const mediaUrl = 'https://rumble.com/v123456-example.html'
  const response = JSON.stringify({ title: 'Rumble video', formats: [] })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    'case " $* " in',
    `  *' --impersonate chrome '*) printf '%s\\n' '${response}' ;;`,
    '  *) printf "%s\\n" "ERROR: [Rumble] Unable to download webpage: HTTP Error 403: Forbidden" >&2; exit 1 ;;',
    'esac'
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  const info = await page.evaluate(url => window.ftElectron.ytDlpGetPlaybackInfo(url), mediaUrl)
  expect(info).toMatchObject({ title: 'Rumble video' })
})

test('retries failed external playback with configured cookies', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'cookie-retry-yt-dlp.sh')
  const cookiePath = path.join(app.userDataDir, 'playback-cookies.txt')
  const mediaUrl = 'https://videos.example.test/cookie-required'
  const response = JSON.stringify({
    title: 'Cookie protected video',
    formats: [{ url: DEMO_MEDIA_URL, protocol: 'https', ext: 'webm', vcodec: 'vp9', acodec: 'opus', width: 640, height: 360 }]
  })
  await writeFile(cookiePath, '# Netscape HTTP Cookie File\n')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    'case " $* " in',
    `  *' ${cookiePath} '*) printf '%s\\n' '${response}' ;;`,
    '  *) printf "%s\\n" "ERROR: Sign in to view this video" >&2; exit 1 ;;',
    'esac'
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.evaluate(async ({ ytDlpPath, cookies }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'file')
    await store.dispatch('updateYtDlpPlaybackCookiesPath', cookies)
  }, { ytDlpPath: executable, cookies: cookiePath })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.externalMediaError')).toContainText('Sign in to view this video')
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.locator('.externalMediaDetails h1')).toHaveText('Cookie protected video')
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test('offers cookie retry only after an unauthenticated external extraction', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'failing-external-yt-dlp.sh')
  const cookiePath = path.join(app.userDataDir, 'playback-cookies.txt')
  await writeFile(cookiePath, '# Netscape HTTP Cookie File\n')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    'printf "%s\\n" "ERROR: Unable to extract video" >&2',
    'exit 1'
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async ({ ytDlpPath, cookies }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'file')
    await store.dispatch('updateYtDlpPlaybackCookiesPath', cookies)
  }, { ytDlpPath: executable, cookies: cookiePath })

  await page.locator(sel.searchInput).fill('https://videos.example.test/unavailable')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.externalMediaError')).toContainText('Unable to extract video')
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.locator('.externalMediaError')).toContainText('Unable to extract video')
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const route = { path: '/external-media', query: { url: 'not-a-url' }, fullPath: '/external-media?url=not-a-url' }
    store.commit('setTabNavigation', {
      tabId: store.getters.getActiveTabId,
      route,
      history: [{ route, title: 'Watch' }],
      historyIndex: 0
    })
  })
  await expect(page.locator('.externalMediaError')).toContainText('Invalid')
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test('plays a non-YouTube URL and shows the available yt-dlp metadata', async ({ app, page }, testInfo) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-yt-dlp.sh')
  const capturedArgs = path.join(app.userDataDir, 'external-media-args.txt')
  const mediaUrl = 'https://videos.example.test/episode-1'
  const nextMediaUrl = 'https://videos.example.test/episode-2'
  const avatarUrl = 'https://videos.example.test/creator-avatar.png'
  const storyboardUrl = 'https://videos.example.test/storyboard.jpg'
  const response = JSON.stringify({
    title: 'An example episode',
    channel: 'Example creator',
    channel_url: 'https://videos.example.test/@creator',
    channel_avatar: avatarUrl,
    description: 'A video from another site.',
    webpage_url: mediaUrl,
    view_count: 1234,
    concurrent_view_count: 42,
    like_count: 15,
    dislike_count: 2,
    comment_count: 4,
    repost_count: 3,
    save_count: 5,
    series: 'Example series',
    season_number: 2,
    episode_number: 1,
    artists: ['Example artist'],
    album: 'Example album',
    genres: ['Documentary'],
    license: 'Creative Commons',
    categories: ['Education'],
    tags: ['example'],
    availability: 'unlisted',
    age_limit: 18,
    media_type: 'episode',
    chapters: [{ start_time: 5, title: 'Introduction' }, { title: 'Invalid chapter' }, { start_time: 10, title: 'Main segment' }],
    upload_date: '20260918',
    timestamp: 1789743600,
    release_date: '20260919',
    formats: [{
      format_id: 'webm-360',
      url: DEMO_MEDIA_URL,
      protocol: 'https',
      ext: 'webm',
      vcodec: 'vp9',
      acodec: 'opus',
      width: 640,
      height: 360,
      tbr: 200
    }]
  })
  const nextResponse = JSON.stringify({
    ...JSON.parse(response),
    title: 'Another episode',
    channel: null,
    channel_url: null,
    channel_avatar: null,
    uploader: 'Another creator',
    webpage_url: nextMediaUrl
  })
  const storyboardResponse = JSON.stringify({
    ...JSON.parse(response),
    storyboard: {
      protocol: 'mhtml',
      width: 160,
      height: 90,
      fps: 1 / 30,
      rows: 1,
      columns: 1,
      fragments: [{ url: storyboardUrl, duration: 30 }]
    }
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' "$@" > '${capturedArgs}'`,
    `case "$*" in *episode-2*) printf '%s\\n' '${nextResponse}' ;; *) printf '%s\\n' '${response}' '${storyboardResponse}' ;; esac`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.route(avatarUrl, route => route.fulfill({
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', 'base64')
  }))
  await page.route(storyboardUrl, route => route.fulfill({
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', 'base64')
  }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
    await store.dispatch('updateUseSponsorBlock', true)
  }, executable)

  const sponsorBlockRequests = []
  page.on('request', request => {
    if (request.url().includes('/api/skipSegments')) sponsorBlockRequests.push(request.url())
  })

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/external-media\?url=/)
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('An example episode')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('Example creator')
  await expect(page.locator(`${activeTab} .externalMediaCreator img`)).toHaveAttribute('src', avatarUrl)
  await expect(page.locator(`${activeTab} .externalMediaCreator a`).first()).toHaveAttribute('href', 'https://videos.example.test/@creator')
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toContainText('A video from another site.')
  await page.locator(`${activeTab} .externalMediaDescription`).getByRole('button', { name: '...more' }).click()
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toContainText('Creative Commons')
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toContainText('example')
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toBeVisible()
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('15 likes')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('42 watching')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('2 dislikes')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('4 comments')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('3 reposts')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('5 saves')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('Education')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('Age restricted')
  await expect(page.locator(`${activeTab} .externalMediaExtra`)).toContainText('Example series')
  await expect(page.locator(`${activeTab} .externalMediaExtra`)).toContainText('Example album')
  await expect(page.locator(`${activeTab} .externalMediaExtra`)).toContainText('Release date')
  await waitForPlayback(page)
  const externalMedia = page.locator(`${activeTab} .externalMedia`)
  const player = externalMedia.locator('.externalMediaPlayer')
  await player.hover()
  await player.locator('video.player').evaluate(video => video.pause())
  await player.locator('.shaka-seek-bar-container').hover({ position: { x: 120, y: 4 } })
  await expect(player.locator('.shaka-player-ui-thumbnail-image-container')).toBeVisible()
  await player.locator('video.player').evaluate(video => {
    video.currentTime = 0
    video.dispatchEvent(new Event('timeupdate'))
  })
  const chaptersButton = player.locator('.shaka-controls-button-panel .ft-chapters-button')
  await expect(externalMedia.locator('.externalMediaChapters')).toHaveCount(0)
  await expect(chaptersButton).toHaveAttribute('aria-label', 'Open Chapters')
  await expect(chaptersButton.locator('.ft-chapters-current-title')).toHaveText('Chapters')
  await chaptersButton.click({ force: true })
  await expect(externalMedia.locator('.externalMediaChapters')).toContainText('Main segment')
  await expect(externalMedia.locator('.externalMediaChapters [aria-current="true"]')).toHaveCount(0)
  await expect(chaptersButton).toHaveAttribute('aria-label', 'Close Chapters')
  await externalMedia.locator('.externalMediaChapters').getByRole('button', { name: 'Close Chapters' }).click()
  await expect(externalMedia.locator('.externalMediaChapters')).toHaveCount(0)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(player.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
  await expect(chaptersButton).toHaveAttribute('aria-label', 'Open Chapters')
  await chaptersButton.click({ force: true })
  await externalMedia.locator('.externalMediaChapters').getByRole('button', { name: /Main segment/ }).click()
  await expect.poll(() => player.locator('video.player').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(10)
  const seekBar = player.locator('.shaka-seek-bar-container')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(player.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
  await player.hover()
  await seekBar.hover({ position: { x: Math.floor((await seekBar.boundingBox()).width * 0.8), y: 4 } })
  await expect(player.locator('.ft-chapter-preview')).toHaveText('Main segment')
  await expect(player.locator('.ft-chapter-preview')).toBeVisible()
  await externalMedia.locator('.externalMediaChapters').getByRole('button', { name: 'Copy link at 0:10' }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${mediaUrl}?t=10`)
  await expect(player.locator('.fullscreenSponsorBlockToggle, .ft-shaka-sponsorblock-button')).toHaveCount(0)
  await expect(player.locator('.playerFullscreenTitleOverlay')).not.toHaveAttribute('role', 'button')
  await expect(player.locator('.theatre-button')).toHaveCount(0)
  const playerBox = await player.boundingBox()
  const mediaBox = await externalMedia.boundingBox()
  const expectedYouTubeWidth = Math.min(mediaBox.width, await page.evaluate(() => window.innerHeight * 0.8 * 1.78))
  expect(Math.abs(playerBox.width - expectedYouTubeWidth)).toBeLessThan(2)
  const shareButton = externalMedia.getByRole('button', { name: 'Share Video' }).first()
  await shareButton.click()
  await expect(externalMedia.getByRole('button', { name: 'Copy Link', exact: true })).toBeVisible()
  await expect(externalMedia.getByRole('button', { name: 'Copy Embed' })).toHaveCount(0)
  await externalMedia.getByRole('button', { name: 'Copy Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(mediaUrl)
  expect(sponsorBlockRequests).toEqual([])
  await expect(page.locator(`${sel.activeTab} .tabAvatar`)).toBeVisible()
  await expect(page.locator('.toast-holder .toast')).toHaveCount(0)
  await expect.poll(() => page.locator(`${activeTab} .externalMediaCreator img`).evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await externalMedia.evaluate(element => element.scrollIntoView({ block: 'start' }))
    const playerBounds = await page.locator(`${activeTab} .externalMediaPlayer video.player`).boundingBox()
    const descriptionBounds = await page.locator(`${activeTab} .externalMediaDescription`).boundingBox()
    const topNavBounds = await page.locator('.topNav').boundingBox()
    const top = Math.max(playerBounds.y, topNavBounds.y + topNavBounds.height)
    const clip = {
      x: playerBounds.x,
      y: top,
      width: playerBounds.width,
      height: descriptionBounds.y + descriptionBounds.height - top + 8
    }
    await page.screenshot({ path: testInfo.outputPath(`external-media-${theme}.png`), clip })
    await page.locator(`${activeTab} .externalMediaDetails`).screenshot({
      path: testInfo.outputPath(`external-media-details-${theme}.png`)
    })
    await page.locator(`${activeTab} .externalMediaDescription`).screenshot({
      path: testInfo.outputPath(`external-media-description-${theme}.png`)
    })
  }

  await player.locator('.ftVideoPlayer').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('s')
  await expect(player.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
  await expect(player.locator('.fullscreenMetadataOverlay.open')).toHaveCount(0)
  await player.locator('.fullscreenShareAction').getByRole('button', { name: 'Share Video' }).click()
  const fullscreenShareDialog = page.getByRole('dialog', { name: 'Share Video' })
  await expect(fullscreenShareDialog.getByRole('button', { name: 'Copy Embed' })).toHaveCount(0)
  await fullscreenShareDialog.getByRole('button', { name: 'Copy Link' }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(mediaUrl)
  await page.keyboard.press('s')
  await page.setViewportSize({ width: 375, height: 667 })
  expect(await externalMedia.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  const args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
  expect(args).toContain(mediaUrl)
  expect(args).toContain('--write-subs')
  expect(args).toContain('--write-auto-subs')
  expect(args[args.indexOf('--sub-format') + 1]).toBe('vtt/srt/ttml/dfxp')
  expect(args).not.toContain('--extractor-args')
  expect(args[args.indexOf('--format') + 1]).toBe('bestvideo*+bestaudio/best,mhtml')

  await page.locator(sel.searchInput).fill(nextMediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('Another episode')
  await expect(page.locator(`${activeTab} .externalMediaCreator img`)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getTabById(store.getters.getActiveTabId)?.avatarUrl
  })).toBeNull()
  await waitForPlayback(page)
  await page.locator(`${activeTab} .externalMediaPlayer video.player`).evaluate(video => video.pause())
  await expect(page.locator(`${sel.activeTab} .tabAvatar, ${sel.activeTab} .tabPageIcon`)).toBeVisible()
})

test('expands a metadata-only description card', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-metadata-only.sh')
  const mediaUrl = 'https://videos.example.test/metadata-only'
  const response = JSON.stringify({
    title: 'Metadata-only episode',
    description: '',
    dislike_count: 1,
    repost_count: 5,
    save_count: 5,
    license: 'Creative Commons',
    tags: ['documentary'],
    formats: [{ format_id: 'webm', url: DEMO_MEDIA_URL, protocol: 'https', ext: 'webm', vcodec: 'vp9', acodec: 'opus' }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
    await store.dispatch('updateUiScale', 95)
  }, executable)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await waitForPlayback(page)
  const description = page.locator(`${activeTab} .externalMediaDescription`)
  await expect(description.getByRole('button', { name: '...more' })).toBeVisible()
  await description.getByRole('button', { name: '...more' }).click()
  await expect(description).toContainText('Creative Commons')
  await description.getByRole('button', { name: 'Show less' }).click()
  await expect(description).not.toContainText('Creative Commons')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateUseAITranslationCompletions', true)
    await store.dispatch('updateCurrentLocale', 'uk')
  })
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('1 дизлайк')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('5 репостів')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('5 збережень')
})

test('shows an upcoming external stream before formats are available', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'upcoming-external-yt-dlp.sh')
  const mediaUrl = 'https://videos.example.test/upcoming'
  const response = JSON.stringify({
    title: 'Upcoming stream',
    live_status: 'is_upcoming',
    release_timestamp: 1790870400,
    channel: 'Example creator',
    license: 'Creative Commons',
    formats: []
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('Upcoming stream')
  await expect(page.locator(`${activeTab} .externalMediaBadges`)).toContainText('Upcoming')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).not.toContainText('Published on')
  await expect(page.locator(`${activeTab} .externalMediaExtra`)).toContainText('Release date')
  await expect(page.locator(`${activeTab} .externalMediaExtra`)).toContainText('1 Oct 2026')
  const description = page.locator(`${activeTab} .externalMediaDescription`)
  await description.getByRole('button', { name: '...more' }).click()
  await expect(description).toContainText('Creative Commons')
  await expect(page.locator(`${activeTab} .externalMediaPlayer`)).toHaveCount(0)
})

test('shows a recoverable extraction error in the player area', async ({ app, page }, testInfo) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-failing-yt-dlp.sh')
  const releaseGate = path.join(app.userDataDir, 'release-extraction')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `while [ ! -f '${releaseGate}' ]; do sleep 0.1; done`,
    'printf "%s\\n" "ERROR: [generic] Unable to download webpage: HTTP Error 503: Service Unavailable. The handshake operation timed out (caused by TransportError: The handshake operation timed out)" >&2',
    'exit 1'
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveClass(/\bdark\b/)
  await page.locator(sel.searchInput).fill('https://videos.example.test/unavailable')
  await page.locator(sel.searchInput).press('Enter')
  const state = page.locator(`${activeTab} .externalMediaState`)
  await expect(state).toContainText('Fetching streams with yt-dlp…')
  await state.screenshot({ path: testInfo.outputPath('external-media-loading-dark.png') })
  await page.setViewportSize({ width: 375, height: 667 })
  try {
    for (const selector of ['.externalMediaLoading', '.externalMediaStateContent']) {
      const bounds = await page.locator(`${activeTab} ${selector}`).boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
    }
  } finally {
    await writeFile(releaseGate, '')
  }
  await expect(state.locator('h1')).toHaveText('videos.example.test')
  await expect(state).toContainText('HTTP Error 503: Service Unavailable')
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await state.screenshot({ path: testInfo.outputPath(`external-media-error-${theme}.png`) })
  }
  await page.setViewportSize({ width: 375, height: 667 })
  expect(await state.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const errorBounds = await state.boundingBox()
  const contentBounds = await state.locator('.externalMediaStateContent').boundingBox()
  expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(errorBounds.y + errorBounds.height + 2)
  await state.getByRole('button', { name: 'Retry' }).scrollIntoViewIfNeeded()
  await expect(state.getByRole('button', { name: 'Retry' })).toBeInViewport()
  await rm(releaseGate)
  await state.getByRole('button', { name: 'Retry' }).click()
  await expect(state).toContainText('Fetching streams with yt-dlp…')
  await writeFile(releaseGate, '')
  await expect(state).toContainText('HTTP Error 503: Service Unavailable')
})

test('plays a progressive external format when yt-dlp omits codec fields', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-missing-codecs.sh')
  const mediaUrl = 'https://clips.twitch.tv/example'
  const response = JSON.stringify({
    title: 'Example clip',
    formats: [{
      format_id: '360',
      url: DEMO_MEDIA_URL,
      protocol: 'https',
      ext: 'webm',
      height: 360
    }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaPlayer`)).toBeVisible({ timeout: 3000 })
  await waitForPlayback(page)
})

for (const [name, mediaUrl, format] of [
  ['a direct MP4 without codecs or dimensions', 'https://media.example.test/video.mp4', { format_id: 'mp4', ext: 'mp4' }],
  ['an Instagram video-only MP4', 'https://www.instagram.com/reel/example/', { format_id: 'dash-video', ext: 'mp4', vcodec: 'avc1.64001F', acodec: 'none', width: 720, height: 1280 }],
  ['a Streamable MP4 without an audio codec', 'https://streamable.com/example', { format_id: 'mp4', ext: 'mp4', vcodec: 'h264', width: 1280, height: 720 }]
]) {
  test(`plays ${name}`, async ({ app, page }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

    const executable = path.join(app.userDataDir, 'external-media-direct-mp4.sh')
    const streamUrl = 'https://media.example.test/video.mp4'
    const response = JSON.stringify({
      title: name,
      formats: [{ ...format, url: streamUrl, protocol: 'https' }]
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    const media = Buffer.from((await readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'post-live-video.mp4.b64'), 'utf8')).replaceAll('\n', ''), 'base64')
    await page.route(streamUrl, route => route.fulfill({
      contentType: 'video/mp4',
      headers: { 'content-length': String(media.length), 'accept-ranges': 'bytes' },
      body: media
    }))
    await page.evaluate(async ytDlpPath => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.locator(sel.searchInput).fill(mediaUrl)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator(`${activeTab} .externalMediaPlayer`)).toBeVisible({ timeout: 20000 })
    await waitForPlayback(page)
  })
}

test('keeps protected media headers with a long external storyboard', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const media = await readFile(DEMO_MEDIA_PATH)
  const receivedHeaders = []
  const captionHeaders = []
  const siblingHeaders = []
  const storyboardHeaders = []
  const redirectedStoryboardHeaders = []
  const server = createServer((request, response) => {
    if (request.url === '/foobar/ping') {
      siblingHeaders.push(request.headers)
      response.writeHead(204).end()
      return
    }
    if (request.url === '/storyboard.jpg') {
      storyboardHeaders.push(request.headers)
      response.writeHead(204).end()
      return
    }
    if (request.url === '/storyboard/1.jpg') {
      response.writeHead(302, { Location: '/foo/preview.jpg' }).end()
      return
    }
    if (request.url === '/foo/preview.jpg') {
      redirectedStoryboardHeaders.push(request.headers)
      response.writeHead(204).end()
      return
    }
    if (request.url === '/foo/captions.vtt') captionHeaders.push(request.headers)
    else receivedHeaders.push(request.headers)
    if (
      !request.headers.cookie?.includes('stream_session=test-token') ||
      request.headers.referer !== 'https://www.tiktok.com/' ||
      request.headers['user-agent'] !== 'yt-dlp-test-agent'
    ) {
      response.writeHead(403).end()
      return
    }
    if (request.url === '/foo/captions.vtt') {
      response.writeHead(200, { 'content-type': 'text/vtt' })
        .end('WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nCaption text\n')
      return
    }
    response.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': media.length,
      'accept-ranges': 'bytes'
    }).end(media)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const executable = path.join(app.userDataDir, 'external-media-cookie-stream.sh')
    const streamUrl = `http://127.0.0.1:${server.address().port}/foo/video.webm`
    const captionUrl = `http://127.0.0.1:${server.address().port}/foo/captions.vtt`
    const siblingUrl = `http://127.0.0.1:${server.address().port}/foobar/ping`
    const storyboardUrl = `http://127.0.0.1:${server.address().port}/storyboard.jpg`
    const response = JSON.stringify({
      title: 'Cookie protected stream',
      requested_subtitles: {
        en: {
          ext: 'vtt',
          url: captionUrl,
          http_headers: { Referer: 'https://www.tiktok.com/', 'User-Agent': 'yt-dlp-test-agent' }
        }
      },
      subtitles: { en: [{ ext: 'vtt', url: captionUrl }] },
      formats: [{
        format_id: '360',
        url: streamUrl,
        protocol: 'http',
        ext: 'webm',
        height: 360,
        http_headers: { Referer: 'https://www.tiktok.com/', 'User-Agent': 'yt-dlp-test-agent' }
      }]
    })
    const storyboardResponse = JSON.stringify({
      ...JSON.parse(response),
      storyboard: {
        protocol: 'mhtml',
        width: 160,
        height: 90,
        fps: 1,
        rows: 1,
        columns: 1,
        http_headers: { Referer: 'https://www.tiktok.com/' },
        fragments: Array.from({ length: 300 }, (_, index) => ({
          url: `http://127.0.0.1:${server.address().port}/${index === 0 ? 'storyboard.jpg' : `storyboard/${index}.jpg`}`,
          duration: 1
        }))
      }
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      'previous=""',
      'for argument in "$@"; do',
      '  if [ "$previous" = "--cookies" ]; then',
      '    printf "127.0.0.1\\tFALSE\\t/foo\\tFALSE\\t4102444800\\tstream_session\\ttest-token\\n127.0.0.1\\tFALSE\\t/storyboard.jpg\\tFALSE\\t4102444800\\tpreview_session\\ttest-token\\n" > "$argument"',
      '  fi',
      '  previous="$argument"',
      'done',
    `printf '%s\\n' '${response}' '${storyboardResponse}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
      await store.dispatch('updateEnableSubtitlesByDefault', true)
    }, executable)

    await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
    await expect.poll(() => captionHeaders.length).toBeGreaterThan(0)
    expect(receivedHeaders.length).toBeGreaterThan(0)
    expect(receivedHeaders.every(headers => headers.cookie?.includes('stream_session=test-token'))).toBe(true)
    expect(receivedHeaders.every(headers => headers.referer === 'https://www.tiktok.com/')).toBe(true)
    expect(receivedHeaders.every(headers => headers['user-agent'] === 'yt-dlp-test-agent')).toBe(true)
    await page.evaluate(async url => { await fetch(url, { mode: 'no-cors' }) }, storyboardUrl)
    expect(storyboardHeaders.length).toBe(1)
    expect(storyboardHeaders[0].referer).toBe('https://www.tiktok.com/')
    expect(storyboardHeaders[0].cookie).toBeUndefined()
    await page.evaluate(async url => { await fetch(url, { mode: 'no-cors' }) }, `http://127.0.0.1:${server.address().port}/storyboard/1.jpg`)
    expect(redirectedStoryboardHeaders.length).toBe(1)
    expect(redirectedStoryboardHeaders[0].cookie).toBeUndefined()
    expect(captionHeaders.every(headers => headers.cookie?.includes('stream_session=test-token'))).toBe(true)
    expect(captionHeaders.every(headers => headers.referer === 'https://www.tiktok.com/')).toBe(true)
    expect(captionHeaders.every(headers => headers['user-agent'] === 'yt-dlp-test-agent')).toBe(true)
    await page.evaluate(async url => { await fetch(url, { mode: 'no-cors' }) }, siblingUrl)
    expect(siblingHeaders.length).toBe(1)
    expect(siblingHeaders[0].cookie).toBeUndefined()
    expect(siblingHeaders[0].referer).not.toBe('https://www.tiktok.com/')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('uses configured playback cookies for external streams', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const media = await readFile(DEMO_MEDIA_PATH)
  const server = createServer((request, response) => {
    if (!request.headers.cookie?.includes('account_session=test-token')) {
      response.writeHead(403).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': media.length,
      'accept-ranges': 'bytes'
    }).end(media)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const executable = path.join(app.userDataDir, 'external-media-auth-stream.sh')
    const cookiePath = path.join(app.userDataDir, 'external-media-auth-cookies.txt')
    const streamUrl = `http://127.0.0.1:${server.address().port}/video.webm`
    const response = JSON.stringify({
      title: 'Authenticated stream',
      formats: [{ format_id: '360', url: streamUrl, protocol: 'http', ext: 'webm', height: 360 }]
    })
    await writeFile(cookiePath, '127.0.0.1\tFALSE\t/\tFALSE\t4102444800\taccount_session\ttest-token\n')
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async ({ ytDlpPath, cookiesPath }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
      await store.dispatch('updateYtDlpPlaybackAuthMode', 'file')
      await store.dispatch('updateYtDlpPlaybackCookiesPath', cookiesPath)
      await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
    }, { ytDlpPath: executable, cookiesPath: cookiePath })

    await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('uses only format cookies for browser-authenticated external streams', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const media = await readFile(DEMO_MEDIA_PATH)
  const server = createServer((request, response) => {
    if (request.headers.cookie !== 'account_session=test-token') {
      response.writeHead(403).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': media.length,
      'accept-ranges': 'bytes'
    }).end(media)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const executable = path.join(app.userDataDir, 'external-media-browser-auth.sh')
    const capturedArgs = path.join(app.userDataDir, 'external-media-browser-args.txt')
    const streamUrl = `http://127.0.0.1:${server.address().port}/video.webm`
    const response = JSON.stringify({
      title: 'Browser authenticated stream',
      formats: [{
        format_id: '360',
        url: streamUrl,
        protocol: 'http',
        ext: 'webm',
        height: 360,
        cookies: 'account_session=test-token; Domain=127.0.0.1; Path=/'
      }]
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      `printf '%s\\n' "$@" > '${capturedArgs}'`,
      `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async ytDlpPath => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
      await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
      await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
      await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
    }, executable)

    await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
    const args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
    expect(args).toContain('--cookies-from-browser')
    expect(args).not.toContain('--cookies')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('skips a TikTok codec unsupported by the player when a compatible stream exists', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-unsupported-codec.sh')
  const unsupportedUrl = 'https://codec.example.test/video.mp4'
  const response = JSON.stringify({
    title: 'Example short video',
    formats: [
      { format_id: 'vp9-540', url: DEMO_MEDIA_URL, protocol: 'https', ext: 'webm', vcodec: 'vp9', acodec: 'opus', width: 540, height: 960 },
      { format_id: 'bytevc1-720', url: unsupportedUrl, protocol: 'https', ext: 'mp4', vcodec: 'h265', acodec: 'aac', width: 720, height: 1280 }
    ]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.route(unsupportedUrl, async route => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    body: await readFile(DEMO_MEDIA_PATH)
  }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
  await page.locator(sel.searchInput).press('Enter')
  await waitForPlayback(page)
})

test('tries an accessible H.265 stream when another codec URL is blocked', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-h265-fallback.sh')
  const blockedUrl = 'https://codec.example.test/blocked.mp4'
  const fallbackUrl = 'https://codec.example.test/fallback.mp4'
  const response = JSON.stringify({
    title: 'Example short video',
    formats: [
      { format_id: 'h264-540', url: blockedUrl, protocol: 'https', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 540, height: 960 },
      { format_id: 'h265-720', url: fallbackUrl, protocol: 'https', ext: 'mp4', vcodec: 'h265', acodec: 'aac', width: 720, height: 1280 }
    ]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  const mp4Base64 = await readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'post-live-video.mp4.b64'), 'utf8')
  const media = Buffer.from(mp4Base64.replaceAll('\n', ''), 'base64')
  await page.route(blockedUrl, route => route.fulfill({ status: 403 }))
  await page.route(fallbackUrl, route => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    headers: { 'content-length': String(media.length), 'accept-ranges': 'bytes' },
    body: media
  }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
  await page.locator(sel.searchInput).press('Enter')
  await waitForPlayback(page)
})

test('plays an H.264 MP4 when yt-dlp supplies short codec names', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-h264.sh')
  const streamUrl = 'https://mp4.example.test/video.mp4'
  const response = JSON.stringify({
    title: 'Example H.264 video',
    formats: [{ format_id: 'h264-540', url: streamUrl, protocol: 'https', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 540, height: 960 }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  const mp4Base64 = await readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'post-live-video.mp4.b64'), 'utf8')
  const media = Buffer.from(mp4Base64.replaceAll('\n', ''), 'base64')
  await page.route(streamUrl, route => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    headers: { 'content-length': String(media.length), 'accept-ranges': 'bytes' },
    body: media
  }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
  await page.locator(sel.searchInput).press('Enter')
  await waitForPlayback(page)
})

test('plays an audio-only SoundCloud HLS stream', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const mediaUrl = 'https://soundcloud.com/davidloehlein/superar'
  const playlistUrl = 'https://audio.example.test/playlist.m3u8'
  const segmentUrl = 'https://audio.example.test/segment.mp3'
  const executable = path.join(app.userDataDir, 'soundcloud-yt-dlp.sh')
  const response = JSON.stringify({
    title: 'Superar',
    duration: 4,
    webpage_url: mediaUrl,
    formats: [
      { format_id: 'hls_mp3_1_0', url: playlistUrl, protocol: 'm3u8_native', ext: 'mp3', vcodec: 'none', acodec: 'mp3' },
      { format_id: 'http_mp3_1_0', url: segmentUrl, protocol: 'http', ext: 'mp3', vcodec: 'none', acodec: 'mp3' }
    ]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.route(playlistUrl, route => route.fulfill({
    contentType: 'application/x-mpegurl',
    body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4,\nsegment.mp3\n#EXT-X-ENDLIST\n'
  }))
  await page.route(segmentUrl, async route => route.fulfill({
    contentType: 'audio/mpeg',
    body: await readFile(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'demo-audio.mp3'))
  }))
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await waitForPlayback(page)
  const player = page.locator(`${activeTab} .externalMediaPlayer`)
  await expect(player.locator('video')).toHaveClass(/audioOnly/)
  await expect(page.locator(`${activeTab} .externalMediaError`)).toHaveCount(0)
})

test('does not show an audio-only player when a video site blocks its video streams', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-blocked-video.sh')
  const response = JSON.stringify({
    title: 'Example short video',
    formats: [
      { format_id: 'audio', url: DEMO_MEDIA_URL, protocol: 'https', ext: 'mp3', vcodec: 'none', acodec: 'mp3' },
      { format_id: 'video', url: 'https://blocked-video.example.test/stream.mp4', protocol: 'https', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 576, height: 1024 }
    ]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.route('https://blocked-video.example.test/stream.mp4', route => route.fulfill({ status: 403 }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaError`)).toBeVisible()
  await expect(page.locator(`${activeTab} .externalMediaPlayer`)).toHaveCount(0)
})

test('plays an audio-only HLS stream from external media', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-audio-hls.sh')
  const manifestUrl = 'https://audio.example.test/playlist.m3u8'
  const segmentUrl = 'https://audio.example.test/segment.m4a'
  const response = JSON.stringify({
    title: 'Example audio show',
    formats: [{
      format_id: 'hls-audio',
      url: manifestUrl,
      manifest_url: manifestUrl,
      protocol: 'm3u8_native',
      ext: 'mp4',
      vcodec: 'none',
      acodec: 'mp4a.40.2'
    }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  const media = Buffer.from((await readFile(path.join(repoRoot, 'e2e/fixtures/media/post-live-audio.m4a.b64'), 'utf8')).replaceAll('\n', ''), 'base64')
  await page.route(manifestUrl, route => route.fulfill({
    contentType: 'application/vnd.apple.mpegurl',
    body: `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${segmentUrl}"
#EXTINF:2,
${segmentUrl}
#EXT-X-ENDLIST
`
  }))
  await page.route(segmentUrl, route => route.fulfill({ contentType: 'audio/mp4', body: media }))
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://www.mixcloud.com/example/show/')
  await page.locator(sel.searchInput).press('Enter')
  await expect.poll(async () => {
    const diagnostic = page.locator(`${activeTab} .externalMediaDiagnostic`)
    if (await diagnostic.count()) return await diagnostic.textContent()
    const video = page.locator(`${activeTab} .externalMediaPlayer video`)
    return await video.count() && await video.evaluate(element => element.currentTime > 0)
      ? 'playing'
      : 'pending'
  }, { timeout: 20000 }).toBe('playing')
})

test('plays both streams when an external clip has separate audio and codec-free video', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-separate-tracks.sh')
  const videoUrl = 'https://coub.example.test/video.mp4'
  const audioUrl = 'https://coub.example.test/audio.m4a'
  const response = JSON.stringify({
    title: 'Example clip',
    formats: [
      { format_id: 'audio', url: audioUrl, protocol: 'https', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2' },
      { format_id: 'video', url: videoUrl, protocol: 'https', ext: 'mp4', acodec: 'none' }
    ]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  const videoBytes = Buffer.from((await readFile(path.join(repoRoot, 'e2e/fixtures/media/post-live-video.mp4.b64'), 'utf8')).replaceAll('\n', ''), 'base64')
  const audioBytes = Buffer.from((await readFile(path.join(repoRoot, 'e2e/fixtures/media/post-live-long-audio.m4a.b64'), 'utf8')).replaceAll('\n', ''), 'base64')
  await page.route(videoUrl, route => route.fulfill({ contentType: 'video/mp4', body: videoBytes }))
  await page.route(audioUrl, route => route.fulfill({ contentType: 'audio/mp4', body: audioBytes }))
  await page.evaluate(async ytDlpPath => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill('https://coub.com/view/example')
  await page.locator(sel.searchInput).press('Enter')
  const video = page.locator(`${activeTab} .externalMediaPlayer video`)
  const audio = page.locator(`${activeTab} .externalMediaCompanionAudio`)
  await expect.poll(() => video.evaluate(element => element.videoWidth).catch(() => 0), { timeout: 20000 }).toBeGreaterThan(0)
  await expect.poll(() => audio.evaluate(element => element.currentTime > 0 && !element.paused).catch(() => false), { timeout: 20000 }).toBe(true)
  await audio.evaluate(async element => { element.currentTime = 0; await element.play() })
  await video.evaluate(element => element.dispatchEvent(new Event('waiting')))
  await expect.poll(() => audio.evaluate(element => element.paused), { timeout: 1000 }).toBe(true)
  await video.evaluate(element => element.dispatchEvent(new Event('playing')))
  await expect.poll(() => audio.evaluate(element => !element.paused)).toBe(true)
  await expect.poll(() => audio.evaluate(element => element.currentTime > 2.5 && !element.paused).catch(() => false), { timeout: 20000 }).toBe(true)
  await expect(video).toHaveJSProperty('loop', true)
  await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true)
  await video.evaluate(element => element.pause())
  await expect.poll(() => audio.evaluate(element => element.paused)).toBe(true)
  await video.evaluate(element => element.play())
  await expect.poll(() => audio.evaluate(element => !element.paused)).toBe(true)
  await video.evaluate(element => element.pause())
  await expect.poll(() => audio.evaluate(element => element.paused)).toBe(true)
  await audio.evaluate(element => {
    element.play = () => {
      HTMLMediaElement.prototype.play.call(element).catch(() => {})
      element.pendingPlay = new Promise((_resolve, reject) => {
        element.addEventListener('pause', () => reject(new DOMException('Playback interrupted', 'AbortError')), { once: true })
      })
      return element.pendingPlay
    }
  })
  await video.evaluate(element => element.play())
  await expect.poll(() => audio.evaluate(element => !element.paused)).toBe(true)
  await video.evaluate(element => element.dispatchEvent(new Event('waiting')))
  await audio.evaluate(async element => {
    try { await element.pendingPlay } catch { /* the buffering pause interrupted play */ }
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await expect(video).toHaveJSProperty('paused', false)
  await video.evaluate(element => element.pause())
  await audio.evaluate(element => { element.play = () => Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) })
  await video.evaluate(element => element.play())
  await expect.poll(() => video.evaluate(element => element.paused), { timeout: 1000 }).toBe(true)
})

for (const [name, videoCodec] of [
  ['uses a playable HLS variant when the master playlist is blocked', 'avc1.64001f'],
  ['keeps HLS video enabled when its codec metadata is missing', undefined]
]) {
  test(name, async ({ app, page }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

    const executable = path.join(app.userDataDir, 'external-media-hls-variant.sh')
    const masterUrl = 'https://hls.example.test/master.m3u8'
    const variantUrl = 'https://hls.example.test/1080.m3u8'
    const segmentUrl = 'https://hls.example.test/segment.mp4'
    const response = JSON.stringify({
      title: 'Example HLS video',
      manifest_url: masterUrl,
      formats: [{
        format_id: 'hls-1080',
        url: variantUrl,
        manifest_url: masterUrl,
        protocol: 'm3u8_native',
        ext: 'mp4',
        vcodec: videoCodec,
        acodec: 'mp4a.40.2',
        width: 1920,
        height: 1080
      }]
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.route(masterUrl, route => route.fulfill({ status: 403 }))
    await page.route(variantUrl, route => route.fulfill({
      status: 200,
      contentType: 'application/vnd.apple.mpegurl',
      body: `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${segmentUrl}"
#EXTINF:2,
${segmentUrl}
#EXT-X-ENDLIST
`
    }))
    await page.route(segmentUrl, async route => route.fulfill({
      contentType: 'video/mp4',
      body: await readFile(path.join(repoRoot, 'e2e/fixtures/media/hls-1080.mp4'))
    }))
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const variantRequested = page.waitForRequest(variantUrl)
    await page.locator(sel.searchInput).fill('https://www.dailymotion.com/video/example')
    await page.locator(sel.searchInput).press('Enter')
    await variantRequested
    await expect(page.locator(`${activeTab} .externalMediaPlayer video`)).not.toHaveClass(/audioOnly/)
    await expect.poll(async () => {
      const diagnostic = page.locator(`${activeTab} .externalMediaDiagnostic`)
      if (await diagnostic.count()) return await diagnostic.textContent()
      const player = page.locator(`${activeTab} .externalMediaPlayer`)
      const playbackTime = await player.count()
        ? await player.evaluate(el => el.querySelector('video')?.currentTime ?? 0)
        : 0
      return playbackTime > 0.2 ? 'playing' : 'pending'
    }, { timeout: 8_000 }).toBe('playing')
  })
}

test('passes yt-dlp headers to HLS media segments', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const media = await readFile(path.join(repoRoot, 'e2e/fixtures/media/hls-1080.mp4'))
  const server = createServer((request, response) => {
    if (request.headers.referer !== 'https://www.dailymotion.com/') {
      response.writeHead(403).end()
      return
    }
    if (request.url === '/media/variant.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end(`#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="segment.mp4"
#EXTINF:2,
segment.mp4
#EXT-X-ENDLIST
`)
      return
    }
    response.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': media.length,
      'accept-ranges': 'bytes'
    }).end(media)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const executable = path.join(app.userDataDir, 'external-media-hls-headers.sh')
    const manifestUrl = `http://127.0.0.1:${server.address().port}/media/variant.m3u8`
    const response = JSON.stringify({
      title: 'Header protected HLS video',
      formats: [{
        format_id: 'hls-1080',
        url: manifestUrl,
        manifest_url: manifestUrl,
        protocol: 'm3u8_native',
        ext: 'mp4',
        vcodec: 'avc1.64001f',
        acodec: 'mp4a.40.2',
        width: 1920,
        height: 1080,
        http_headers: { Referer: 'https://www.dailymotion.com/' }
      }]
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.locator(sel.searchInput).fill('https://www.dailymotion.com/video/example')
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
