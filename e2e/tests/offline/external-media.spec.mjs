import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, sel, test } from '../../helpers/app.mjs'
import { activeTab, waitForPlayback } from '../../helpers/player.mjs'
import { DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'

test('plays a non-YouTube URL and shows the available yt-dlp metadata', async ({ app, page }, testInfo) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')

  const executable = path.join(app.userDataDir, 'external-media-yt-dlp.sh')
  const capturedArgs = path.join(app.userDataDir, 'external-media-args.txt')
  const mediaUrl = 'https://videos.example.test/episode-1'
  const response = JSON.stringify({
    title: 'An example episode',
    uploader: 'Example creator',
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
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' "$@" > '${capturedArgs}'`,
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
  await expect(page).toHaveURL(/#\/external-media\?url=/)
  await expect(page.locator(`${activeTab} .externalMediaDetails h1`)).toHaveText('An example episode')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('Example creator')
  await expect(page.locator(`${activeTab} .externalMediaDetails`)).toContainText('A video from another site.')
  await waitForPlayback(page)
  const playerBounds = await page.locator(`${activeTab} .externalMediaPlayer`).boundingBox()
  const descriptionBounds = await page.locator(`${activeTab} .externalMediaDescription`).boundingBox()
  const clip = {
    x: playerBounds.x,
    y: playerBounds.y,
    width: playerBounds.width,
    height: descriptionBounds.y + descriptionBounds.height - playerBounds.y + 8
  }
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await page.screenshot({ path: testInfo.outputPath(`external-media-${theme}.png`), clip })
  }

  const args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
  expect(args).toContain(mediaUrl)
  expect(args).not.toContain('--extractor-args')
  expect(args[args.indexOf('--format') + 1]).toBe('bestvideo*+bestaudio/best')
})
