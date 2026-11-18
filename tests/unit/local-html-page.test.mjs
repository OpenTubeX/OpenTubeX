import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')

function extract(name) {
  const start = source.indexOf(`async function ${name}(`)
  return source.slice(start, source.indexOf('\n}\n', start) + 2)
}

const HTML_PAGE = '<script>ytcfg.set({"INNERTUBE_CONTEXT":{}});window.ytAtN({"challenge":"c"})</script>'

/**
 * Following YouTube's rate limit redirect loops between the captcha and the
 * exemption page, which Chromium reports as a generic fetch error.
 * @param {Record<string, boolean>} redirectedPages
 */
function loader(redirectedPages) {
  const storage = new Map()
  const requests = []
  const fetchFunc = async (url, init) => {
    requests.push({ url, redirect: init.redirect })
    if (!redirectedPages[url]) return new Response(HTML_PAGE)
    if (init.redirect !== 'manual') throw new TypeError('Failed to fetch')
    return { type: 'opaqueredirect', status: 0, ok: false, url: '' }
  }
  const dependencies = {
    process: { env: { IS_ELECTRON: true } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    parseLooseJSON: JSON.parse,
    buildSessionFromYtConfig: () => ({}),
    console: { warn() {}, error() {} },
  }
  const load = compileFunction(
    `${extract('getHTMLPage')}\n${extract('getWatchHTMLWatchPage')}\nreturn getWatchHTMLWatchPage`,
    Object.keys(dependencies)
  )(...Object.values(dependencies))
  return { load: videoId => load(videoId, fetchFunc), requests, storage }
}

const WATCH_URL = 'https://www.youtube.com/watch?v=testVideo01&bpctr=9999999999&has_verified=1'
const HOME_URL = 'https://www.youtube.com'

test('a redirected home page is reported as an IP block instead of a fetch error', async () => {
  const { load, requests, storage } = loader({ [HOME_URL]: true })
  storage.set('playerHtmlHomepageFallback', '1')

  await assert.rejects(load('testVideo01'), error => error.isIpBlock === true)
  assert.deepEqual(requests, [{ url: HOME_URL, redirect: 'manual' }])
})

test('a redirected watch page falls back to the home page and reports its redirect as an IP block', async () => {
  const { load, requests, storage } = loader({ [WATCH_URL]: true, [HOME_URL]: true })

  await assert.rejects(load('testVideo01'), error => error.isIpBlock === true)
  assert.equal(storage.get('playerHtmlHomepageFallback'), '1')
  assert.deepEqual(requests.map(request => request.url), [WATCH_URL, HOME_URL])
})

test('the home page fallback loads the challenge when only the watch page is redirected', async () => {
  const { load } = loader({ [WATCH_URL]: true })

  const result = await load('testVideo01')
  assert.deepEqual(result.initialAttestationData, { challenge: 'c' })
})
