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
    getLocalVideoChannels: async () => channels,
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

test('left-clicking a byline that resolves to one channel opens it in the current tab', async () => {
  for (const electron of [true, false]) {
    const { opened, prompt } = await clickByline({ electron, event: { type: 'click', button: 0, shiftKey: false } })
    assert.equal(prompt, false)
    assert.equal(opened.length, 1)
    assert.equal(opened[0].doCreateNewTab, false)
    assert.equal(opened[0].makeActive, true)
  }
})
