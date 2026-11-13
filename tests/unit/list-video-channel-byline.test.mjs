import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const card = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const openChannelByline = card.slice(card.indexOf('async function openChannelByline'), card.indexOf('\nfunction handleExtraThumbnailAction'))

async function clickByline({ electron, event, channels = [{ id: 'UC-one', name: 'Zach and Michelle' }] }) {
  const opened = []
  const context = {
    process: { env: { IS_ELECTRON: electron } },
    disableChannelLinks: { value: false },
    isFetchingCollaborators: { value: false },
    channelCollaborators: { value: [] },
    showCollaboratorsPrompt: { value: false },
    id: { value: 'video' },
    setCollaboratorsLoading: () => {},
    getVideoChannels: async () => channels,
    openInternalPath: options => opened.push(options),
    isUnloadedBackgroundTabClick: () => false,
    showToast: () => {},
    t: key => key,
    console,
    event
  }
  await runInNewContext(`${openChannelByline}; openChannelByline(event)`, context)
  return { opened, prompt: context.showCollaboratorsPrompt.value }
}

const middleClick = { type: 'auxclick', button: 1, shiftKey: false }

test('middle-clicking a byline that resolves to one channel opens a background tab in Electron', async () => {
  const { opened, prompt } = await clickByline({ electron: true, event: middleClick })
  assert.equal(prompt, false)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].path, '/channel/UC-one')
  assert.equal(opened[0].doCreateNewTab, true)
  assert.equal(opened[0].makeActive, false)
})

test('middle-clicking a byline that resolves to one channel never navigates the current tab outside Electron', async () => {
  const { opened, prompt } = await clickByline({ electron: false, event: middleClick })
  assert.deepEqual(opened, [])
  assert.equal(prompt, true)
})

const getVideoChannels = card.slice(card.indexOf('async function getVideoChannels'), card.indexOf('\n/**\n * Opens the collaborators prompt'))

/**
 * @param {string} backend
 * @param {boolean} fallback
 */
async function lookUpChannels(backend, fallback = false) {
  const calls = []
  const context = {
    backendPreference: { value: backend },
    store: { getters: { getBackendFallback: fallback } },
    // Mirrors fallback.js for a build with the local API
    requestWithFallback: async (requests, options) => {
      const order = options.backend === 'local' ? ['local', 'invidious'] : ['invidious', 'local']
      try {
        return { result: await requests[order[0]]() }
      } catch (error) {
        if (!options.fallback) throw error
        return { result: await requests[order[1]]() }
      }
    },
    getLocalVideoChannels: async id => { calls.push(`local ${id}`); return [{ id: 'UC-local', name: 'Local' }] },
    invidiousGetVideoInformation: async id => {
      calls.push(`invidious ${id}`)
      return { author: 'Creator', authorId: 'UC-creator', authorThumbnails: [{ url: 'https://images.test/small.jpg' }, { url: 'https://images.test/large.jpg' }] }
    }
  }
  const channels = await runInNewContext(`${getVideoChannels}; getVideoChannels('video')`, context)
  return { channels, calls }
}

test('bylines look channels up with the local API only when it is the preferred backend', async () => {
  assert.deepEqual((await lookUpChannels('local')).calls, ['local video'])

  for (const backend of ['invidious', 'yattee']) {
    const { channels, calls } = await lookUpChannels(backend, true)
    assert.deepEqual(calls, ['invidious video'], `${backend} must not contact YouTube directly`)
    assert.deepEqual(JSON.parse(JSON.stringify(channels)), [{ id: 'UC-creator', name: 'Creator', thumbnail: 'https://images.test/large.jpg', subtitle: '' }])
  }
})
