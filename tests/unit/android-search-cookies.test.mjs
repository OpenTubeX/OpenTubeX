import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../src/renderer/helpers/restricted-playback.js'
import { buildYtDlpSearchArguments, normalizeYtDlpSearchResults } from '../../src/ytDlpSearch.js'

const pageSource = await readFile(new URL('../../src/renderer/views/SearchPage/SearchPage.vue', import.meta.url), 'utf8')
const adapterSource = (await readFile(new URL('../../src/renderer/helpers/ytDlp.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')
const getters = { getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: '/private/yt-dlp-cookies.txt' }

function searchSupport(env, settings = getters) {
  const start = pageSource.indexOf('const supportsCookieSearch =')
  const end = pageSource.indexOf('let searchRequestId', start)
  return vm.runInNewContext(`${pageSource.slice(start, end)}\n;({ supportsCookieSearch, configured: cookiesConfigured.value })`, {
    process: { env },
    store: { getters: settings },
    computed: callback => ({ get value() { return callback() } }),
    hasConfiguredRestrictedPlaybackAuthentication: (settings, supported) => hasConfiguredRestrictedPlaybackAuthentication(settings, supported, !!env.IS_CAPACITOR)
  })
}

test('Android search offers the cookie retry with a saved session', () => {
  const result = searchSupport({ IS_CAPACITOR: true })
  assert.equal(result.supportsCookieSearch, true, 'Android must support the search notice cookie retry')
  assert.equal(result.configured, true, 'A saved Android session must enable the retry')
})

test('cookie search remains enabled on Electron and unavailable on iOS and the web', () => {
  assert.equal(searchSupport({ IS_ELECTRON: true }).configured, true)
  for (const env of [{}, { IS_CAPACITOR: true, IS_IOS: true }]) {
    assert.equal(searchSupport(env).supportsCookieSearch, false)
    assert.equal(searchSupport(env).configured, false)
  }
  assert.equal(searchSupport({ IS_CAPACITOR: true }, {}).configured, false)
  assert.equal(searchSupport({ IS_CAPACITOR: true }, { getYtDlpPlaybackAuthMode: 'browser', getYtDlpPlaybackCookiesBrowser: 'firefox' }).configured, false)
})

function adapter(settings, extract) {
  return new Function('process', 'registerPlugin', 'store', 'buildYtDlpSearchArguments', 'normalizeYtDlpSearchResults', 'chooseAndroidDirectory', `${adapterSource}\nreturn ytDlp`)(
    { env: { IS_CAPACITOR: true } }, () => ({ extract }), { getters: settings }, buildYtDlpSearchArguments, normalizeYtDlpSearchResults, () => {})
}

test('Android cookie search uses the saved session, filters and requested page', async () => {
  const entries = Array.from({ length: 20 }, () => ({ id: 'dQw4w9WgXcQ', title: 'Authenticated search result' }))
  const bridge = adapter(getters, async request => {
    assert.equal(request.cookies, getters.getYtDlpPlaybackCookiesPath)
    const args = request.args
    assert.equal(args.includes('--ignore-config'), false)
    assert.equal(args.includes('--'), false)
    assert.ok(args.includes('--flat-playlist'))
    assert.ok(args.includes('--dump-single-json'))
    assert.equal(args[args.indexOf('--playlist-start') + 1], '21')
    assert.equal(args[args.indexOf('--playlist-end') + 1], '40')
    const url = new URL(args.at(-1))
    assert.equal(url.origin, 'https://www.youtube.com')
    assert.equal(url.pathname, '/results')
    assert.equal(url.searchParams.get('search_query'), 'age restricted search')
    assert.equal(url.searchParams.get('sp'), 'test=')
    assert.equal(request.externalMedia, false)
    return { stdout: JSON.stringify({ entries }) }
  })
  const result = await bridge.ytDlpSearch('age restricted search', 'test%3D', 2)
  assert.equal(result.results.length, 20)
  assert.equal(result.results[0].title, 'Authenticated search result')
  assert.equal(result.hasMoreResults, true)
})

test('Android cookie search rejects unavailable authentication and invalid requests before extraction', async () => {
  for (const settings of [{}, { getYtDlpPlaybackAuthMode: 'browser' }, { ...getters, getYtDlpPlaybackCookiesPath: '' }]) {
    const result = await adapter(settings, () => assert.fail('Unexpected native extraction')).ytDlpSearch('query')
    assert.ok(result.error)
  }
  for (const args of [[''], ['x'.repeat(101)], ['query', '', 0]]) {
    const result = await adapter(getters, () => assert.fail('Unexpected native extraction')).ytDlpSearch(...args)
    assert.ok(result.error)
  }
})

test('Android cookie search reports extraction and malformed-response failures', async () => {
  for (const extract of [async () => { throw new Error('Search failed') }, async () => ({ stdout: '{}' })]) {
    const result = await adapter(getters, extract).ytDlpSearch('query')
    assert.ok(result.error)
  }
})
