import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

/**
 * @param {string} path
 * @param {string} startText
 * @param {string} endText
 */
async function extract(path, startText, endText) {
  const source = await readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start) + endText.length
  assert.ok(start >= 0 && end > start, `Update the harness after changing ${path}`)
  return source.slice(start, end)
}

const localApiFetchSource = await extract('renderer/helpers/api/local.js', 'async function localApiFetch(', '\n}\n')
const instancesFromFileSource = await extract('renderer/store/modules/invidious.js', 'async fetchInvidiousInstancesFromFile(', '\n  },\n')

test('the web build requests YouTube without cookies or a script User-Agent', async () => {
  const requests = []
  const localApiFetch = vm.runInNewContext(`${localApiFetchSource}; localApiFetch`, {
    Headers,
    Request,
    process: { env: { SUPPORTS_LOCAL_API: true } },
    fetch: async (input, init) => {
      requests.push({ input, init })
      return new Response('{}')
    }
  })

  const request = new Request('https://www.youtube.com/youtubei/v1/browse', {
    method: 'POST',
    headers: { 'user-agent': 'com.google.android.youtube/1.0', 'x-goog-visitor-id': 'visitor' }
  })
  // youtubei.js passes its headers both on the request and in init
  await localApiFetch(request, { headers: request.headers, credentials: 'include' })
  await localApiFetch('https://www.youtube.com/sw.js_data')

  for (const { init } of requests) {
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers.has('user-agent'), false)
  }
  assert.equal(requests[0].init.headers.get('x-goog-visitor-id'), 'visitor')
})

test('the web build only offers Invidious instances that allow CORS, even with the local API', async () => {
  const instances = await new Promise(resolve => {
    const actions = vm.runInNewContext(`({ ${instancesFromFileSource} })`, {
      process: { env: { SUPPORTS_LOCAL_API: true } },
      createWebURL: path => path,
      fetch: async () => ({
        json: async () => [
          { url: 'https://cors.example', cors: true },
          { url: 'https://no-cors.example', cors: false }
        ]
      })
    })
    actions.fetchInvidiousInstancesFromFile({ commit: (_name, list) => resolve(list) })
  })

  assert.deepEqual([...instances], ['https://cors.example'])
})

test('a saved local API preference falls back to Invidious while the web app has no local API', async () => {
  const getterSource = await extract('renderer/store/modules/settings.js', 'getBackendPreference: (state) =>', 'state.backendPreference,\n')
  const getBackendPreference = supportsLocalApi => vm.runInNewContext(`({ ${getterSource} })`, {
    process: { env: { SUPPORTS_LOCAL_API: supportsLocalApi } }
  }).getBackendPreference

  assert.equal(getBackendPreference(false)({ backendPreference: 'local' }), 'invidious')
  assert.equal(getBackendPreference(false)({ backendPreference: 'yattee' }), 'yattee')
  assert.equal(getBackendPreference(true)({ backendPreference: 'local' }), 'local')
})
