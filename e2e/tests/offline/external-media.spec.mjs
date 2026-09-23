import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { expect, repoRoot, sel, test } from '../../helpers/app.mjs'
import { activeTab, waitForPlayback } from '../../helpers/player.mjs'
import { DEMO_MEDIA_PATH, DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'

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

test('plays a non-YouTube URL and shows the available yt-dlp metadata', async ({ app, page }, testInfo) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-yt-dlp.sh')
  const capturedArgs = path.join(app.userDataDir, 'external-media-args.txt')
  const mediaUrl = 'https://videos.example.test/episode-1'
  const nextMediaUrl = 'https://videos.example.test/episode-2'
  const avatarUrl = 'https://videos.example.test/creator-avatar.png'
  const response = JSON.stringify({
    title: 'An example episode',
    channel: 'Example creator',
    channel_url: 'https://videos.example.test/@creator',
    channel_avatar: avatarUrl,
    description: 'A video from another site.',
    webpage_url: mediaUrl,
    view_count: 1234,
    upload_date: '20260918',
    duration: 30,
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
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' "$@" > '${capturedArgs}'`,
    `case "$*" in *episode-2*) printf '%s\\n' '${nextResponse}' ;; *) printf '%s\\n' '${response}' ;; esac`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await page.route(avatarUrl, route => route.fulfill({
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', 'base64')
  }))
  await page.evaluate(async (ytDlpPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', ytDlpPath)
  }, executable)

  await page.locator(sel.searchInput).fill(mediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/external-media\?url=/)
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('An example episode')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('Example creator')
  await expect(page.locator(`${activeTab} .externalMediaCreator img`)).toHaveAttribute('src', avatarUrl)
  await expect(page.locator(`${activeTab} .externalMediaCreator a`).first()).toHaveAttribute('href', 'https://videos.example.test/@creator')
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toContainText('A video from another site.')
  await expect(page.locator(`${activeTab} .externalMediaDescription`)).toBeVisible()
  await waitForPlayback(page)
  await page.locator(`${activeTab} .externalMediaPlayer`).getByRole('button', { name: 'Pause (k)' }).click()
  await expect(page.locator(`${sel.activeTab} .tabAvatar`)).toBeVisible()
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    const playerBounds = await page.locator(`${activeTab} .externalMediaPlayer`).boundingBox()
    const descriptionBounds = await page.locator(`${activeTab} .externalMediaDescription`).boundingBox()
    const clip = {
      x: playerBounds.x,
      y: playerBounds.y,
      width: playerBounds.width,
      height: descriptionBounds.y + descriptionBounds.height - playerBounds.y + 8
    }
    await page.screenshot({ path: testInfo.outputPath(`external-media-${theme}.png`), clip })
    await page.locator(`${activeTab} .externalMediaDetails`).screenshot({
      path: testInfo.outputPath(`external-media-details-${theme}.png`)
    })
    await page.locator(`${activeTab} .externalMediaDescription`).screenshot({
      path: testInfo.outputPath(`external-media-description-${theme}.png`)
    })
  }

  const args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
  expect(args).toContain(mediaUrl)
  expect(args).not.toContain('--extractor-args')
  expect(args[args.indexOf('--format') + 1]).toBe('bestvideo*+bestaudio/best')

  await page.locator(sel.searchInput).fill(nextMediaUrl)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('Another episode')
  await expect(page.locator(`${activeTab} .externalMediaCreator img`)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getTabById(store.getters.getActiveTabId)?.avatarUrl
  })).toBeNull()
  await waitForPlayback(page)
  await page.locator(`${activeTab} .externalMediaPlayer`).getByRole('button', { name: 'Pause (k)' }).click()
  await expect(page.locator(`${sel.activeTab} .tabPageIcon`)).toBeVisible()
})

test('shows a recoverable extraction error in the player area', async ({ app, page }, testInfo) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-failing-yt-dlp.sh')
  const releaseGate = path.join(app.userDataDir, 'release-extraction')
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `while [ ! -f '${releaseGate}' ]; do sleep 0.1; done`,
    'printf "%s\\n" "ERROR: [generic] Unable to download webpage: HTTP Error 503: Service Unavailable" >&2',
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
  await writeFile(releaseGate, '')
  await expect(state.locator('h1')).toHaveText('videos.example.test')
  await expect(state).toContainText('HTTP Error 503: Service Unavailable')
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await state.screenshot({ path: testInfo.outputPath(`external-media-error-${theme}.png`) })
  }
  await page.setViewportSize({ width: 375, height: 667 })
  await expect(state.getByRole('button', { name: 'Retry' })).toBeInViewport()
  expect(await state.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
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

test('plays a TikTok stream that requires extraction cookies and format headers', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const media = await readFile(DEMO_MEDIA_PATH)
  const receivedHeaders = []
  const siblingHeaders = []
  const server = createServer((request, response) => {
    if (request.url === '/foobar/ping') {
      siblingHeaders.push(request.headers)
      response.writeHead(204).end()
      return
    }
    receivedHeaders.push(request.headers)
    if (
      !request.headers.cookie?.includes('stream_session=test-token') ||
      request.headers.referer !== 'https://www.tiktok.com/' ||
      request.headers['user-agent'] !== 'yt-dlp-test-agent'
    ) {
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
    const executable = path.join(app.userDataDir, 'external-media-cookie-stream.sh')
    const streamUrl = `http://127.0.0.1:${server.address().port}/foo/video.webm`
    const siblingUrl = `http://127.0.0.1:${server.address().port}/foobar/ping`
    const response = JSON.stringify({
      title: 'Cookie protected stream',
      formats: [{
        format_id: '360',
        url: streamUrl,
        protocol: 'http',
        ext: 'webm',
        height: 360,
        http_headers: { Referer: 'https://www.tiktok.com/', 'User-Agent': 'yt-dlp-test-agent' }
      }]
    })
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
      'previous=""',
      'for argument in "$@"; do',
      '  if [ "$previous" = "--cookies" ]; then',
      '    printf "127.0.0.1\\tFALSE\\t/foo\\tFALSE\\t4102444800\\tstream_session\\ttest-token\\n" > "$argument"',
      '  fi',
      '  previous="$argument"',
      'done',
    `printf '%s\\n' '${response}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpSource', 'system')
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    await page.locator(sel.searchInput).fill('https://www.tiktok.com/@example/video/123')
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
    expect(receivedHeaders.length).toBeGreaterThan(0)
    expect(receivedHeaders.every(headers => headers.cookie?.includes('stream_session=test-token'))).toBe(true)
    expect(receivedHeaders.every(headers => headers.referer === 'https://www.tiktok.com/')).toBe(true)
    expect(receivedHeaders.every(headers => headers['user-agent'] === 'yt-dlp-test-agent')).toBe(true)
    await page.evaluate(async url => { await fetch(url, { mode: 'no-cors' }) }, siblingUrl)
    expect(siblingHeaders.length).toBe(1)
    expect(siblingHeaders[0].cookie).toBeUndefined()
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

test('uses a playable HLS variant when the master playlist is blocked', async ({ app, page }) => {
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
      vcodec: 'avc1.64001f',
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
