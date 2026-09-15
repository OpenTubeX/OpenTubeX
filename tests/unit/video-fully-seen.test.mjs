import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('function markAsWatched('), source.indexOf('\nasync function unmarkAsWatched'))
const eligibility = source.slice(source.indexOf('const canMarkAsFullySeen ='), source.indexOf('\nconst watchProgress ='))

function mark({ fullySeen = false, entry, allowed = true, length = 120 } = {}) {
  const updates = []
  const context = {
    canMarkAsWatched: { value: allowed },
    historyEntry: { value: entry },
    props: { data: { lengthSeconds: '' } },
    store: { dispatch: (action, data) => updates.push({ action, data }) },
    showToast() {},
    t: key => key
  }
  for (const [key, value] of Object.entries({
    id: 'video', title: 'Title', channelName: 'Channel', channelId: 'channel',
    published: 123, description: '', viewCount: 42, lengthSeconds: length,
    isMembersOnly: false, toastThumbnail: ''
  })) context[key] = { value }
  vm.runInNewContext(handler + '\nmarkAsWatched(' + fullySeen + ')', context)
  return updates
}

test('fully seen creates completed history and completes partial or already-watched history', () => {
  for (const entry of [undefined, { watchProgress: 30, isWatched: false, timeWatched: 123 }, { watchProgress: 60, isWatched: true, timeWatched: 456 }]) {
    const [{ action, data }] = mark({ fullySeen: true, entry })
    assert.equal(action, 'updateHistory')
    assert.equal(data.watchProgress, 120)
    assert.equal(data.lengthSeconds, 120)
    assert.equal(data.isWatched, true)
    if (entry) assert.equal(data.timeWatched, entry.timeWatched)
  }
})

test('ordinary watched action preserves playback progress', () => {
  assert.equal(mark()[0].data.watchProgress, 0)
  assert.equal(mark({ entry: { watchProgress: 30 } })[0].data.watchProgress, 30)
  assert.equal(mark({ fullySeen: true, allowed: false }).length, 0)
})

test('fully seen requires a watchable video with a finite positive duration', () => {
  for (const allowed of [true, false]) {
    for (const length of [undefined, '', 0, -1, Infinity, NaN, 120]) {
      const actual = vm.runInNewContext(eligibility + '\ncanMarkAsFullySeen.value', {
        computed: fn => ({ value: fn() }),
        canMarkAsWatched: { value: allowed },
        lengthSeconds: { value: length }
      })
      assert.equal(actual, allowed && length === 120)
    }
  }
})

test('fully seen thumbnail action shows only for eligible videos and invokes completion', () => {
  const button = source.slice(source.indexOf('const extraThumbnailActionButton ='), source.indexOf('\nconst inHistory ='))
  const click = source.slice(source.indexOf('function handleExtraThumbnailAction()'), source.indexOf('\nfunction updateUploadedTime()'))
  const options = source.slice(source.indexOf('function handleOptionsClick(option)'), source.indexOf('\nfunction addToWatchQueue('))
  for (const allowed of [true, false]) {
    const calls = []
    const context = {
      computed: fn => ({ value: fn() }),
      extraThumbnailAction: { value: 'markAsFullySeen' },
      canMarkAsFullySeen: { value: allowed },
      markAsWatched: fullySeen => calls.push(fullySeen),
      t: key => key
    }
    const result = vm.runInNewContext(button + '\nextraThumbnailActionButton.value', context)
    assert.equal(result?.title ?? null, allowed ? 'Video.Mark as fully seen' : null)
    vm.runInNewContext(options + '\n' + click + '\nhandleExtraThumbnailAction()', context)
    assert.deepEqual(calls, allowed ? [true] : [])
  }
})

test('thumbnail action setting pairs the fully seen label with its saved value', async () => {
  const settings = await readFile(new URL('../../src/renderer/components/GeneralSettings/GeneralSettings.vue', import.meta.url), 'utf8')
  const choices = settings.slice(settings.indexOf('const extraThumbnailActionValues ='), settings.indexOf('\n/**', settings.indexOf('const extraThumbnailActionNames =')))
  for (const downloads of [true, false]) {
    const result = vm.runInNewContext(choices + '\n;({ values: extraThumbnailActionValues.value, names: extraThumbnailActionNames.value })', {
      computed: fn => ({ value: fn() }),
      supportsYtDlp: downloads,
      enableDownloads: { value: downloads },
      t: key => key
    })
    assert.equal(result.values.length, result.names.length)
    assert.equal(result.names[result.values.indexOf('markAsFullySeen')], 'Video.Mark as fully seen')
  }
})
