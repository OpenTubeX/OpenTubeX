import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'

import { test as baseAppTest, expect, setPlayerFullscreen } from './app.mjs'

const fixturesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'innertube')

// Request body fields that change between runs (session data, tokens,
// timestamps) and must not influence the fixture key.
const VOLATILE_BODY_KEYS = new Set([
  'context',
  'playbackContext',
  'serviceIntegrityDimensions',
  'attestationRequest',
  'botguardResponse'
])

// Non-Innertube resources youtubei.js needs to bootstrap a session and
// decipher stream URLs. Shared between tests, keyed by URL path.
const SHARED_RESOURCE_PATTERNS = [
  /\/s\/player\//,
  /\/sw\.js_data/
]

/**
 * Innertube `params` values are base64 protobufs that can contain a few
 * session-variable bytes (e.g. the channel tab probes). Reduce them to
 * their printable content (the stable discriminator, like "shorts") so
 * recorded and replayed requests produce the same fixture key.
 */
function normalizeParams(value) {
  if (typeof value !== 'string') {
    return value
  }
  try {
    const decoded = Buffer.from(decodeURIComponent(value), 'base64')
    const printable = decoded.toString('latin1').match(/[\x20-\x7e]{3,}/g)
    return printable ? printable.join('.') : value
  } catch {
    return value
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Derives a stable fixture key from an Innertube request.
 * e.g. POST https://www.youtube.com/youtubei/v1/search -> "search-<hash>"
 */
export function fixtureKey(url, postData) {
  const endpoint = new URL(url).pathname.replace(/^.*\/youtubei\/v1\//, '').replaceAll('/', '_')

  let body = {}
  if (postData) {
    try {
      body = JSON.parse(postData)
    } catch {
      body = { raw: postData }
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => !VOLATILE_BODY_KEYS.has(key))
      .map(([key, value]) => [key, key === 'params' ? normalizeParams(value) : value])
  )
  const hash = crypto.createHash('sha1').update(stableStringify(normalized)).digest('hex').slice(0, 12)
  return `${endpoint}-${hash}`
}

function sharedResourceKey(url) {
  const { pathname } = new URL(url)
  const hash = crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)
  return `shared-${hash}`
}

function isSharedResource(url) {
  return SHARED_RESOURCE_PATTERNS.some((pattern) => pattern.test(url))
}

function slugify(text) {
  return text.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 80)
}

function fixtureDirFor(testInfo) {
  return path.join(fixturesRoot, slugify(path.basename(testInfo.file, '.spec.mjs')), slugify(testInfo.title))
}

async function readFixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, `${name}.gz`)))
  } catch {
    return null
  }
}

async function writeFixture(dir, name, body) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${name}.gz`), gzipSync(body))
}

/**
 * Sets up Innertube record/replay on the given page.
 *
 * Modes:
 * - passthrough (default): requests hit the real YouTube servers untouched.
 * - record (E2E_RECORD=1): real network, responses are saved as fixtures.
 * - replay (E2E_USE_FIXTURES=1, or automatically on Playwright retry):
 *   Innertube requests are answered from fixtures and all other external
 *   network is blocked, so the run is deterministic. Media streams
 *   (googlevideo.com) are not recorded — playback assertions must be
 *   skipped in replay mode.
 */
export async function setupInnertube(page, testInfo) {
  const record = !!process.env.E2E_RECORD
  const replay = !record && (!!process.env.E2E_USE_FIXTURES || testInfo.retry > 0)
  const fixtureDir = fixtureDirFor(testInfo)
  const sharedDir = path.join(fixturesRoot, 'shared')
  // Serves repeated identical requests (e.g. continuations) in recorded order.
  const counters = new Map()

  if (replay) {
    // Registered first = lowest priority: blocks all external requests
    // that the more specific routes below don't handle.
    await page.route(/^https?:\/\//, (route) => route.abort())

    await page.route(/^https?:\/\//, async (route, request) => {
      const url = request.url()

      if (isSharedResource(url)) {
        const body = await readFixture(sharedDir, sharedResourceKey(url))
        if (body) {
          const contentType = url.includes('/s/player/') ? 'text/javascript' : 'application/json'
          return route.fulfill({ status: 200, contentType, body })
        }
        return route.abort()
      }

      if (url.includes('/youtubei/v1/')) {
        const key = fixtureKey(url, request.postData())
        const index = counters.get(key) ?? 0
        counters.set(key, index + 1)

        for (const candidate of [`${key}.${index}.json`, `${key}.0.json`]) {
          const body = await readFixture(fixtureDir, candidate)
          if (body) {
            return route.fulfill({ status: 200, contentType: 'application/json', body })
          }
        }
        // eslint-disable-next-line no-console
        console.warn(`[e2e] Missing Innertube fixture: ${key} (${fixtureDir})`)
        return route.abort()
      }

      return route.fallback()
    })
  } else if (record) {
    await page.route(/^https?:\/\//, async (route, request) => {
      const url = request.url()
      const recordable = isSharedResource(url) || url.includes('/youtubei/v1/')
      if (!recordable) {
        return route.fallback()
      }

      // Recording must never fail the test itself: late background
      // requests can race test teardown, so tolerate disposed contexts.
      let response
      try {
        response = await route.fetch()
      } catch {
        return route.abort().catch(() => {})
      }
      let body = null
      if (response.ok()) {
        body = await response.body().catch(() => null)
      }
      await route.fulfill({ response }).catch(() => {})

      if (body) {
        if (isSharedResource(url)) {
          await writeFixture(sharedDir, sharedResourceKey(url), body)
        } else {
          const key = fixtureKey(url, request.postData())
          const index = counters.get(key) ?? 0
          counters.set(key, index + 1)
          await writeFixture(fixtureDir, `${key}.${index}.json`, body)
        }
      }
    })
  }

  return {
    record,
    replay,
    // Media playback needs real googlevideo.com streams and is impossible
    // in replay mode. Live tests detect the app's explicit IP-block error
    // and skip only the affected playback assertion.
    playback: !replay
  }
}

/**
 * App test extended with an `innertube` fixture. Reference it in network
 * tests to get record/replay behaviour; gate playback assertions on
 * `innertube.playback` and data-hydration assertions on `innertube.replay`.
 */
export const test = baseAppTest.extend({
  innertube: [async ({ app }, use, testInfo) => {
    const mode = await setupInnertube(app.page, testInfo)
    await use(mode)
  }, { auto: true }]
})

export { expect, setPlayerFullscreen }
