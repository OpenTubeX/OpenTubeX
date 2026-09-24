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
  await page.locator(`${activeTab} .externalMediaPlayer`).getByRole('button', { name: 'Pause (k)' }).click()
  const externalMedia = page.locator(`${activeTab} .externalMedia`)
  const player = externalMedia.locator('.externalMediaPlayer')
  await player.hover()
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
  expect((await player.boundingBox()).width / (await externalMedia.boundingBox()).width).toBeGreaterThan(0.95)
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
  await page.locator(`${activeTab} .externalMediaPlayer`).getByRole('button', { name: 'Pause (k)' }).click()
  await expect(page.locator(`${sel.activeTab} .tabPageIcon`)).toBeVisible()
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
