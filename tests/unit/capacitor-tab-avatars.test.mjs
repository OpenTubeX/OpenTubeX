import assert from 'node:assert/strict'
import test from 'node:test'
import { Capacitor } from '@capacitor/core'
import { reactive } from 'vue'
import { createFilesystem, filesystemPluginHeader } from '../helpers/capacitor-filesystem.mjs'

globalThis.androidBridge = {}
Capacitor.PluginHeaders = [filesystemPluginHeader]
Capacitor.nativePromise = async () => {}
const {
  clearCapacitorTabAvatars,
  getCapacitorTabAvatar,
  initializeCapacitorTabAvatars,
} = await import('../../src/renderer/tabs/capacitorTabAvatars.js')
delete globalThis.androidBridge

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const remote = 'https://yt3.ggpht.com/avatar=s900'
const channelTab = { id: 'tab', route: { path: `/channel/${channelId}/videos` } }
const settle = () => new Promise(setImmediate)

function setup(t, filesystem = createFilesystem()) {
  clearCapacitorTabAvatars()
  const originalNative = process.env.IS_CAPACITOR
  process.env.IS_CAPACITOR = 'true'
  t.mock.method(Capacitor, 'nativePromise', (plugin, method, options) => {
    assert.equal(plugin, 'Filesystem')
    return filesystem.call(method, options)
  })
  const drawImage = t.mock.fn()
  const globals = {
    Image: class {
      naturalWidth = 900
      naturalHeight = 900
      async decode() {}
    },
    document: {
      createElement: () => ({
        getContext: () => ({ drawImage }),
        toDataURL(type) { return `data:${type};base64,${this.width}x${this.height}` },
      }),
    },
  }
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  t.after(() => {
    for (const name of Object.keys(globals)) delete globalThis[name]
    if (originalNative === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = originalNative
  })

  const thumbnails = reactive({ [channelId]: remote })
  const store = {
    getters: reactive({
      getTabs: [channelTab],
      getPresentedTabId: channelTab.id,
      getChannelThumbnail: id => thumbnails[id] ?? null,
      getVideoAvatar: () => null,
    }),
  }
  const fetchAvatar = t.mock.fn(async source => `data:image/jpeg;base64,${source}`)
  const start = () => initializeCapacitorTabAvatars(store, Promise.resolve(), fetchAvatar)
  return { filesystem, store, thumbnails, fetchAvatar, drawImage, start }
}

test('channel avatars are stored small and restored after a restart without downloading', async t => {
  const state = setup(t)
  let dispose = state.start()
  await settle()
  assert.deepEqual(state.fetchAvatar.mock.calls.map(call => call.arguments[0]), [remote])
  assert.equal(getCapacitorTabAvatar(channelTab), 'data:image/jpeg;base64,176x176')
  assert.deepEqual([...state.filesystem.files.keys()], [`tab-previews/avatar-channel-${channelId}.json`])

  dispose()
  clearCapacitorTabAvatars()
  assert.equal(getCapacitorTabAvatar(channelTab), null)
  dispose = state.start()
  await settle()
  assert.equal(getCapacitorTabAvatar(channelTab), 'data:image/jpeg;base64,176x176')
  assert.equal(state.fetchAvatar.mock.callCount(), 1)
  dispose()
})

test('a new avatar replaces the stored one and closed tabs release theirs', async t => {
  const state = setup(t)
  const dispose = state.start()
  await settle()
  state.thumbnails[channelId] = 'https://yt3.ggpht.com/new-avatar=s176'
  await settle()
  assert.equal(state.fetchAvatar.mock.callCount(), 2)
  const stored = JSON.parse(state.filesystem.files.get(`tab-previews/avatar-channel-${channelId}.json`))
  assert.equal(stored.source, 'https://yt3.ggpht.com/new-avatar=s176')

  state.store.getters.getTabs = []
  await settle()
  assert.equal(getCapacitorTabAvatar(channelTab), null)
  assert.equal(state.filesystem.files.size, 0)
  dispose()
})

test('a failed download is not retried until the source changes', async t => {
  const state = setup(t)
  state.fetchAvatar.mock.mockImplementation(async () => null)
  const dispose = state.start()
  await settle()
  state.store.getters.getTabs = [channelTab, { id: 'other', route: { path: '/watch/aaaaaaaaaaa' } }]
  await settle()
  assert.equal(state.fetchAvatar.mock.callCount(), 1)
  assert.equal(getCapacitorTabAvatar(channelTab), null)
  assert.equal(state.filesystem.files.size, 0)
  dispose()
})

test('clearing waits for tab use before downloading avatars again', async t => {
  const state = setup(t)
  const dispose = state.start()
  await settle()
  clearCapacitorTabAvatars()
  await settle()
  assert.equal(state.fetchAvatar.mock.callCount(), 1)
  assert.equal(getCapacitorTabAvatar(channelTab), null)

  state.store.getters.getPresentedTabId = 'other'
  await settle()
  assert.equal(state.fetchAvatar.mock.callCount(), 2, 'switching tabs refills the cache')
  assert.equal(getCapacitorTabAvatar(channelTab), 'data:image/jpeg;base64,176x176')
  dispose()
})

test('clearing during startup keeps stored avatars from coming back', async t => {
  const filesystem = createFilesystem()
  filesystem.files.set(`tab-previews/avatar-channel-${channelId}.json`, JSON.stringify({ source: remote, image: 'data:image/jpeg;base64,old' }))
  const state = setup(t, filesystem)
  state.fetchAvatar.mock.mockImplementation(async () => null)
  const dispose = state.start()
  clearCapacitorTabAvatars()
  await settle()
  assert.equal(getCapacitorTabAvatar(channelTab), null)
  dispose()
})

test('a failed clear is reported even when the folder cannot be listed', async t => {
  const filesystem = createFilesystem()
  setup(t, filesystem)
  const call = filesystem.call
  filesystem.call = async (method, options) => {
    if (filesystem.files.size > 0 && (method === 'rmdir' || method === 'readdir')) throw new Error('I/O error')
    return call(method, options)
  }
  const { clearStoredTabImages, getStoredTabImagesSize } = await import('../../src/renderer/tabs/capacitorTabImageStorage.js')
  filesystem.files.clear()
  await clearStoredTabImages()
  assert.equal(await getStoredTabImagesSize(), 0, 'a missing folder is an empty cache')
  filesystem.files.set('tab-previews/preview-tab.json', '{}')
  await assert.rejects(clearStoredTabImages(), /I\/O error/)
  await assert.rejects(getStoredTabImagesSize(), /I\/O error/)
})
