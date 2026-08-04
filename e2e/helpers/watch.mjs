import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { repoRoot } from './app.mjs'
import { fixtureKey } from './innertube.mjs'

const fixtureDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch', 'shows-video-metadata')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')

/** The history entry the fixtures below belong to. */
export const watchHistoryEntry = {
  _id: 'jNQXAC9IVRw',
  videoId: 'jNQXAC9IVRw',
  title: 'Player error test video',
  author: 'Test Channel',
  authorId: 'UC-test-channel-id',
  published: Date.now() - 86_400_000,
  description: '',
  viewCount: 1234,
  lengthSeconds: 600,
  watchProgress: 10,
  isWatched: false,
  timeWatched: Date.now(),
  isLive: false,
  type: 'video'
}

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

/**
 * Serves the watch page from fixtures with an unplayable video, so the Watch
 * view mounts without a real player emitting errors of its own.
 *
 * @param {import('./app.mjs').ElectronAppFixture} app
 * @param {import('@playwright/test').Page} page
 */
export async function mockUnplayableWatchPage(app, page) {
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })

  await page.route(/^https?:\/\//, (route) => route.abort())
  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

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
      json.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Video unavailable' }
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
}

/**
 * Returns a handle to the mounted Watch view, so tests can drive its methods
 * directly instead of going through a real player.
 *
 * @param {import('@playwright/test').Page} page
 */
export function watchViewHandle(page) {
  return page.evaluateHandle(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const find = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = find(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = find(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = find(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }
    return watchView
  })
}
