import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const readSource = source.match(/export async function readClipboard\(\) \{[\s\S]*?^\}/m)[0]
const writeSource = source.match(/export async function copyToClipboard\([\s\S]*?^\}/m)[0]

function loadClipboard(clipboard, toasts = [], overrides = {}) {
  return vm.runInNewContext(`${readSource}\n${writeSource}\n({ readClipboard, copyToClipboard })`.replace(/^export /gm, ''), {
    Clipboard: clipboard,
    process: { env: { IS_CAPACITOR: true } },
    navigator: {},
    Blob,
    showToast: toast => toasts.push(toast),
    console: { error() {} },
    ERROR_TOAST_ICON: 'error',
    i18n: { global: { t: key => key } },
    blobToDataUrl: async blob => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
    ...overrides,
  })
}

test('copies screenshots as images through the cross-platform native clipboard', async () => {
  const image = new Blob(['screenshot'], { type: 'image/png' })
  const writes = []
  const toasts = []
  const { copyToClipboard } = loadClipboard({ write: async options => writes.push({ ...options }) }, toasts)
  await copyToClipboard(image, { messageOnSuccess: 'Screenshot copied', messageOnError: 'Copy failed' })
  assert.deepEqual(writes, [{ image: 'data:image/png;base64,c2NyZWVuc2hvdA==', label: 'OpenTubeX' }])
  assert.equal(toasts[0].message, 'Screenshot copied')
})

test('reports native screenshot clipboard failures without showing success', async () => {
  const toasts = []
  const { copyToClipboard } = loadClipboard({ write: async () => { throw new Error('Image write failed') } }, toasts)
  await copyToClipboard(new Blob(['screenshot'], { type: 'image/png' }), {
    messageOnSuccess: 'Screenshot copied', messageOnError: 'Copy failed',
  })
  assert.deepEqual(toasts.map(toast => toast.message), ['Copy failed: Error: Image write failed'])
})

test('desktop screenshots continue to use the browser image clipboard', async () => {
  const image = new Blob(['PNG bytes'], { type: 'image/png' })
  const writes = []
  const { copyToClipboard } = loadClipboard({}, [], {
    process: { env: { IS_CAPACITOR: false } },
    window: { isSecureContext: true },
    navigator: { clipboard: { write: async items => writes.push(...items) } },
    ClipboardItem: class { constructor(data) { this.data = data } },
  })

  await copyToClipboard(image)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].data['image/png'], image)
})

test('copies text through Capacitor without requiring the WebView clipboard API', async () => {
  const writes = []
  const toasts = []
  const { copyToClipboard } = loadClipboard({ write: async options => writes.push({ ...options }) }, toasts)

  await copyToClipboard('https://www.youtube.com/watch?v=abcdefghijk', { messageOnSuccess: 'Copied' })

  assert.deepEqual(writes, [{ text: 'https://www.youtube.com/watch?v=abcdefghijk', label: 'OpenTubeX' }])
  assert.equal(toasts[0].message, 'Copied')
})

test('reads text from the Capacitor result and ignores image data', async () => {
  const { readClipboard } = loadClipboard({ read: async () => ({ type: 'TEXT', value: 'Copied text' }) })
  assert.equal(await readClipboard(), 'Copied text')

  const images = loadClipboard({ read: async () => ({ type: 'IMAGE', value: 'data:image/png;base64,AA==' }) })
  assert.equal(await images.readClipboard(), '')
})

test('propagates native read failures and shows native write failures', async () => {
  const error = new Error('Clipboard access denied')
  const toasts = []
  const clipboard = loadClipboard({
    read: async () => { throw error },
    write: async () => { throw error },
  }, toasts)

  await assert.rejects(clipboard.readClipboard(), error)
  await clipboard.copyToClipboard('test', { messageOnError: 'Copy failed' })
  assert.equal(toasts[0].message, 'Copy failed: Error: Clipboard access denied')
})

test('reads native URL clipboard entries as text', async () => {
  const { readClipboard } = loadClipboard({ read: async () => ({ type: 'URL', value: 'https://youtu.be/example' }) })
  assert.equal(await readClipboard(), 'https://youtu.be/example')
})
