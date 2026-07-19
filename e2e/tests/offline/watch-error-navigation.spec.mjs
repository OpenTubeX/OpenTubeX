import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { goTo, repoRoot, test, expect } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'

const fixtureDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch', 'shows-video-metadata')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')
test.use({
  seed: {
    history: [{
      _id: 'jNQXAC9IVRw',
      videoId: 'jNQXAC9IVRw',
      title: 'Blocked test video',
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      published: Date.now() - 86_400_000,
      description: '',
      viewCount: 1234,
      lengthSeconds: 60,
      watchProgress: 10,
      isWatched: false,
      timeWatched: Date.now(),
      isLive: false,
      type: 'video'
    }]
  }
})

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

test('watch page IP-block error does not break later navigation', async ({ app, page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })

  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })

  await page.route(/^https?:\/\//, (route) => route.abort())
  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

    if (url === 'https://www.youtube.com/iframe_api') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'player\\/test-player\\/' })
    }

    if (url.includes('/img/desktop/unavailable/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' })
    }

    if (/\/s\/player\//.test(url) || /\/sw\.js_data/.test(url)) {
      const { pathname } = new URL(url)
      const name = `shared-${crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)}.gz`
      const body = await fixture(sharedDir, name) ??
        (url.includes('/s/player/') ? await fixture(sharedDir, 'shared-99c4a5c04897.gz') : null)
      if (body) {
        return route.fulfill({
          status: 200,
          contentType: url.includes('/s/player/') ? 'text/javascript' : 'application/json',
          body
        })
      }
      return route.abort()
    }

    if (url.includes('/youtubei/v1/player')) {
      const files = await readdir(fixtureDir)
      const body = await fixture(fixtureDir, files.find((file) => file.startsWith('player-')))
      const json = JSON.parse(body.toString())
      json.playabilityStatus = {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you’re not a bot'
      }
      delete json.streamingData
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    }

    if (url.includes('/youtubei/v1/')) {
      const key = fixtureKey(url, request.postData())
      let body = await fixture(fixtureDir, `${key}.0.json.gz`)
      if (!body) {
        const endpoint = key.replace(/-[0-9a-f]{12}$/, '')
        const files = (await readdir(fixtureDir)).filter((file) => file.startsWith(`${endpoint}-`))
        if (files.length > 0) body = await fixture(fixtureDir, files[0])
      }
      if (body) {
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      return route.abort()
    }

    return route.fallback()
  })

  await goTo(page, 'history')
  await page.getByText('Blocked test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.errorMessage')).toContainText('blocked')

  await page.locator('.topNav a[href="#/subscriptions"]').evaluate((link) => link.click())
  await expect(page).toHaveURL(/#\/subscriptions/)
  await expect(page.locator('.subscriptionsPage')).toBeVisible()

  const renderErrors = errors.filter((error) =>
    error.includes('emitsOptions') || error.includes('failed to render')
  )
  expect(renderErrors, `Renderer errors:\n${errors.join('\n')}`).toEqual([])
})
