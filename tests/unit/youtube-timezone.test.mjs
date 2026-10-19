import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const mainSource = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const localSource = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')

function requestHook(name) {
  const start = mainSource.indexOf(`session.defaultSession.webRequest.${name}(`)
  const end = mainSource.indexOf('\n    })', start) + '\n    })'.length
  let hook
  vm.runInNewContext(mainSource.slice(start, end), {
    session: { defaultSession: { webRequest: { [name]: (_filter, callback) => { hook = callback } } } },
    onBeforeSendHeadersRequestFilter: {},
    httpRequestFilter: {},
    rendererCors: { rememberRequest() {}, allowResponse: () => ({}) },
    Headers,
    URL
  })
  return details => {
    let result
    hook(details, value => { result = value })
    return result
  }
}

for (const url of ['https://www.youtube.com/watch?v=example', 'https://www.youtube.com/', 'https://www.youtube.com/?hl=en']) {
  test(`applies the renderer timezone cookie without leaking X-Cookie: ${url}`, () => {
    const hook = requestHook('onBeforeSendHeaders')
    for (const cookie of [undefined, 'SOCS=value']) {
      const headers = { 'X-Cookie': 'PREF=tz=Europe.Warsaw', Origin: 'app://bundle' }
      if (cookie) headers.Cookie = cookie
      const { requestHeaders } = hook({ url, requestHeaders: headers })
      assert.equal(requestHeaders.Cookie, cookie ? `${cookie};PREF=tz=Europe.Warsaw` : 'PREF=tz=Europe.Warsaw')
      assert.equal(requestHeaders['X-Cookie'], undefined)
      assert.equal(requestHeaders['Sec-Fetch-Mode'], 'navigate')
    }
  })

  test(`removes tracking cookies from the HTML response: ${url}`, () => {
    const responseHeaders = { 'set-cookie': ['tracking=value'], 'content-type': ['text/html'] }
    requestHook('onHeadersReceived')({ url, responseHeaders })
    assert.equal(responseHeaders['set-cookie'], undefined)
    assert.deepEqual(responseHeaders['content-type'], ['text/html'])
  })
}

for (const timeZone of ['Europe/Warsaw', undefined]) {
  test(`HTML fetching handles the renderer timezone ${timeZone}`, async () => {
    const start = localSource.indexOf('async function getHTMLPage(')
    const end = localSource.indexOf('\n/**', start)
    const getHTMLPage = vm.runInNewContext(`(${localSource.slice(start, end)})`, {
      process: { env: { IS_ELECTRON: true } },
      Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) }
    })
    const stop = new Error('stop after capturing headers')
    let headers
    await assert.rejects(getHTMLPage('https://www.youtube.com/', 'homepage', (_url, init) => {
      headers = init.headers
      throw stop
    }), error => error === stop)
    assert.equal(headers['X-Cookie'], timeZone ? 'PREF=tz=Europe.Warsaw' : undefined)
  })
}
