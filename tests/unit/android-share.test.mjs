import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, ref } from 'vue'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../src/renderer/helpers/share.js'

test('chapter timestamp is placed before an external URL fragment', () => {
  assert.equal(appendTimestamp('https://media.example/watch?id=123#details', 42), 'https://media.example/watch?id=123&t=42#details')
  assert.equal(appendTimestamp('https://media.example/watch#details?tab=1', 42), 'https://media.example/watch?t=42#details?tab=1')
})

const shareComponent = readFileSync(new URL('../../src/renderer/components/FtShareButton/FtShareButton.vue', import.meta.url), 'utf8')
const setup = shareComponent.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')

function createShareActions(props = {}, userPlaylist = null) {
  const calls = []
  const bindings = {
    computed,
    ref,
    useId: () => 'share',
    useTemplateRef: () => ({ value: { hideDropdown: () => calls.push('close') } }),
    useI18n: () => ({ t: key => key }),
    defineProps: () => ({ shareTargetType: 'Video', id: 'video123', playlistId: '', getTimestamp: () => 42, ...props }),
    store: { getters: {
      getCurrentInvidiousInstanceUrl: 'https://invidious.example',
      getPlaylist: () => userPlaylist,
    } },
    appendTimestamp,
    getInvidiousVideoUrl,
    getYoutubeVideoShareUrl,
    shareLink: url => { calls.push(url) },
    process: { env: { IS_CAPACITOR: true } },
  }
  const actions = new Function(...Object.keys(bindings), `${setup}\nreturn { shareYoutube, shareInvidious, updateIncludeTimestamp }`)(...Object.values(bindings))
  return { ...actions, calls }
}

test('share panel closes and sends the public URL with the selected timestamp and playlist', () => {
  const actions = createShareActions({ playlistId: 'PL123' })
  actions.shareYoutube()
  actions.updateIncludeTimestamp()
  actions.shareYoutube()
  actions.shareInvidious()
  assert.deepEqual(actions.calls, [
    'close', 'https://youtu.be/video123?list=PL123',
    'close', 'https://youtu.be/video123?list=PL123&t=42',
    'close', 'https://invidious.example/watch?v=video123&list=PL123&t=42',
  ])
})

test('native sharing excludes local playlist IDs', () => {
  const actions = createShareActions({ playlistId: 'private-playlist' }, { id: 'private-playlist' })
  actions.shareYoutube()
  actions.shareInvidious()
  assert.deepEqual(actions.calls, [
    'close', 'https://youtu.be/video123',
    'close', 'https://invidious.example/watch?v=video123',
  ])
})

for (const [type, youtubePath, invidiousPath] of [
  ['Channel', 'www.youtube.com/channel/id123', 'channel/id123'],
  ['Playlist', 'youtube.com/playlist?list=id123', 'playlist?list=id123'],
]) {
  test(`native sharing preserves ${type} URLs without a timestamp`, () => {
    const actions = createShareActions({ shareTargetType: type, id: 'id123', getTimestamp: null })
    actions.updateIncludeTimestamp()
    actions.shareYoutube()
    actions.shareInvidious()
    assert.deepEqual(actions.calls, [
      'close', `https://${youtubePath}`,
      'close', `https://invidious.example/${invidiousPath}`,
    ])
  })
}

test('long-press sharing captures the public URL before dismissing the menu', async () => {
  const app = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const handler = app.match(/async function shareMobileContextLink\(\) \{[\s\S]*?\n\}/)[0]
  const calls = []
  const url = ref('https://youtu.be/video123?t=42')
  const run = new Function('mobileContextLinkCopyUrl', 'closeMobileLinkActions', 'shareLink', `${handler}\nreturn shareMobileContextLink`)(
    url,
    () => { calls.push('close'); url.value = null },
    async link => { calls.push(link) }
  )
  await run()
  await run()
  assert.deepEqual(calls, ['close', 'https://youtu.be/video123?t=42'])
})
