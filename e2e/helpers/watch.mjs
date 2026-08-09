import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { repoRoot } from './app.mjs'
import { fixtureKey, SHARED_PLAYER_SCRIPT } from './innertube.mjs'
import { demoPlayerResponse, routeDemoMedia, routeIframeApi, stubPoToken } from './media.mjs'

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
 * Serves the watch page for `jNQXAC9IVRw` from the committed Innertube
 * fixtures, without any network access.
 *
 * The recorded player responses are unusable (expired stream URLs, and CI
 * recordings are usually bot checks), so the player response is synthesized:
 * either playable — backed by the local demo video, see media.mjs — or
 * explicitly unplayable, which mounts the Watch view without a real player
 * emitting errors of its own.
 *
 * @param {import('./app.mjs').ElectronAppFixture} app
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {boolean} [options.playable] serve the demo video instead of an error
 */
export async function mockWatchPage(app, page, { playable = false } = {}) {
  await stubPoToken(app.electronApp)

  await page.route(/^https?:\/\//, (route) => route.abort())
  await routeIframeApi(page)

  if (playable) {
    await routeDemoMedia(page)
  }

  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

    if (url.includes('/img/desktop/unavailable/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' })
    }

    if (/\/s\/player\//.test(url) || /\/sw\.js_data/.test(url)) {
      const { pathname } = new URL(url)
      const name = `shared-${crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)}.gz`
      const body = await fixture(sharedDir, name) ??
        (url.includes('/s/player/') ? await fixture(sharedDir, `${SHARED_PLAYER_SCRIPT}.gz`) : null)
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
      const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
      const json = demoPlayerResponse(videoId)

      if (!playable) {
        json.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Video unavailable' }
        delete json.streamingData
      }

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

/** @see mockWatchPage */
export function mockUnplayableWatchPage(app, page) {
  return mockWatchPage(app, page, { playable: false })
}

/** @see mockWatchPage */
export function mockPlayableWatchPage(app, page) {
  return mockWatchPage(app, page, { playable: true })
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
