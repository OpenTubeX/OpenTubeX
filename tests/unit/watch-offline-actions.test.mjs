import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { ref } from 'vue'

for (const action of ['reloadCommentData', 'handleSortChange']) {
  test(`offline ${action} preserves loaded comments without starting a request`, async () => {
    const source = await readFile(new URL('../../src/renderer/components/CommentSection/CommentSection.vue', import.meta.url), 'utf8')
    const start = source.indexOf(`function ${action}(`)
    const end = source.indexOf('\n}\n', start) + 2
    const commentData = ref([{ id: 'loaded-comment' }])
    const sortNewest = ref(false)
    let requests = 0
    const run = vm.runInNewContext(`${source.slice(start, end)}\n${action}`, {
      props: { offline: true }, commentData, sortNewest, nextPageToken: ref('continuation'),
      localCommentsInstance: {}, replyTokens: new Map(),
      closeCommentMenus() {}, resetCommentsScroll() {}, getCommentData() { requests++ },
    })
    run('newest')
    assert.equal(commentData.value[0]?.id, 'loaded-comment')
    assert.equal(sortNewest.value, false)
    assert.equal(requests, 0)
  })
}

test('offline language changes preserve the loaded transcript', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoTranscript/WatchVideoTranscript.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function selectCaptionLanguage(')
  const end = source.indexOf('\n}\n', start) + 2
  const selectedCaptionIndex = ref('0')
  const run = vm.runInNewContext(`${source.slice(start, end)}\nselectCaptionLanguage`, {
    props: { offline: true }, selectedCaptionIndex, languageMenuOpen: ref(true),
  })
  run(1)
  assert.equal(selectedCaptionIndex.value, '0')
})

test('changing videos clears the previous video SponsorBlock segments', async () => {
  const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const start = source.indexOf('    resetVideoState: function (')
  const end = source.indexOf('\n    },', start)
  const reset = vm.runInNewContext(`({ ${source.slice(start, end)}\n} }).resetVideoState`, {
    MANIFEST_TYPE_DASH: 'dash', MUSIC_MEDIA_TYPE: { UNKNOWN: 'unknown' },
  })
  const watch = {
    sponsorBlockInfoSegments: [{ uuid: 'previous-video' }],
    playlistScrollPositions: {}, tabRoute: { query: {} },
    clearLiveReminderStartTimer() {}, updateTitle() {},
  }
  reset.call(watch)
  assert.equal(watch.sponsorBlockInfoSegments.length, 0)
})

test('offline chat filtering preserves loaded messages without requesting a replacement', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoLiveChat/WatchVideoLiveChat.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function applyChatFilter(')
  const end = source.indexOf('\n}\n', start) + 2
  let clears = 0
  let requests = 0
  const run = vm.runInNewContext(`${source.slice(start, end)}\napplyChatFilter`, {
    props: { offline: true }, canFilter: ref(true), isReplay: ref(false),
    liveChatInstance: { filter: 'TOP_CHAT', setFilter() { requests++ } },
    liveChatFilter: ref('LIVE_CHAT'), clearChat() { clears++ },
  })
  run()
  assert.equal(clears, 0)
  assert.equal(requests, 0)
})

test('offline replay seeks preserve messages and resume at the latest position on reconnect', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoLiveChat/WatchVideoLiveChat.vue', import.meta.url), 'utf8')
  const start = source.indexOf('watch([() => props.currentTime, () => props.seekRequest')
  const end = source.indexOf('\n})', start) + 3
  let callback
  let clears = 0
  const seeks = []
  const props = { offline: true }
  const context = {
    props, pendingReplaySeekSeconds: null, isReplay: ref(true),
    liveChatInstance: { seekTo(position) { seeks.push(position) } },
    watch: (_source, handler) => { callback = handler },
    clearChat() { clears++ }, releaseReplayComments() {}, requestMoreReplayComments() {},
  }
  vm.runInNewContext(source.slice(start, end), context)
  const seek = { seconds: 120 }
  callback([120, seek, true], [60, null, false])
  callback([150, seek, true], [120, seek, true])
  assert.equal(clears, 0)
  assert.deepEqual(seeks, [])
  props.offline = false
  callback([150, seek, false], [150, seek, true])
  assert.equal(clears, 1)
  assert.deepEqual(seeks, [150_000])
})

test('offline caption preference changes preserve the selection and apply after reconnect', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoTranscript/WatchVideoTranscript.vue', import.meta.url), 'utf8')
  const start = source.indexOf('watch(', source.indexOf('if (Number(selectedCaptionIndex.value) >= captions.length)'))
  const end = source.indexOf('\n})', start) + 3
  let callback
  let watched
  const props = { offline: true, preferredCaptionIndex: 1 }
  const selectedCaptionIndex = ref('0')
  vm.runInNewContext(source.slice(start, end), {
    props, selectedCaptionIndex, appliedPreferredCaptionIndex: 0, watch: (sources, handler) => { watched = sources; callback = handler },
  })
  callback(Array.isArray(watched) ? [1, true] : 1)
  assert.equal(selectedCaptionIndex.value, '0')
  assert.equal(Array.isArray(watched), true)
  props.offline = false
  callback([1, false])
  assert.equal(selectedCaptionIndex.value, '1')
})

test('reconnecting preserves a manually selected caption when the preference did not change', async () => {
  const source = await readFile(new URL('../../src/renderer/components/WatchVideoTranscript/WatchVideoTranscript.vue', import.meta.url), 'utf8')
  const start = source.indexOf('watch(', source.indexOf('if (Number(selectedCaptionIndex.value) >= captions.length)'))
  const end = source.indexOf('\n})', start) + 3
  let callback
  const props = { offline: true, preferredCaptionIndex: 0 }
  const selectedCaptionIndex = ref('1')
  vm.runInNewContext(source.slice(start, end), {
    props, selectedCaptionIndex, appliedPreferredCaptionIndex: 0,
    watch: (_sources, handler) => { callback = handler },
  })
  callback([0, true])
  props.offline = false
  callback([0, false])
  assert.equal(selectedCaptionIndex.value, '1')
})
