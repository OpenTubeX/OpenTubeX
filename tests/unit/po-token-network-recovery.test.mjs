import assert from 'node:assert/strict'
import test from 'node:test'

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

let generate
globalThis.window = Object.assign(new EventTarget(), {
  ftElectron: { generatePoToken: (...args) => generate(...args) }
})
globalThis.location = { href: 'https://localhost/', origin: 'https://localhost' }
process.env.IS_ELECTRON = 'true'

const { generateContentPoToken } = await import('../../src/renderer/helpers/api/local-api-platform.js')
const { getWaitingOrigins } = await import('../../src/renderer/helpers/networkRecovery.js')

test('a BotGuard run that cannot reach YouTube waits in its recovery queue instead of failing the load', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // The PoToken plugins reject with the BotGuard view's error as a string. iOS
  // adds URLSession's localized description, here a request timeout.
  for (const failure of [
    'TypeError: Failed to fetch',
    'TypeError: Failed to fetch: The request timed out.',
    'TypeError: Failed to fetch: Zeitüberschreitung bei der Anforderung.',
  ]) {
    let attempts = 0
    generate = async () => { if (++attempts === 1) throw new Error(failure); return 'token' }
    const token = generateContentPoToken('testVideo01', {}, {}, {})
    await flush()
    assert.deepEqual(getWaitingOrigins(), ['https://www.youtube.com'], failure)
    t.mock.timers.tick(5000)
    await flush()
    assert.equal(await token, 'token')
    assert.equal(attempts, 2)
    assert.deepEqual(getWaitingOrigins(), [])
  }
})

test('a BotGuard timeout while the internet is reachable fails instead of waiting forever', async () => {
  let attempts = 0
  generate = async () => { attempts++; throw new Error('PO token generation timed out') }
  await assert.rejects(generateContentPoToken('testVideo01', {}, {}, {}), /timed out/)
  assert.equal(attempts, 1)
  assert.deepEqual(getWaitingOrigins(), [])
})
