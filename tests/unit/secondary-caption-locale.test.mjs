import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { findCaptionByLocale } from '../../src/captionLanguages.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function selectSecondaryCaption(')
const end = source.indexOf('    function isShownAsMainCaption(')
assert.ok(start > 0 && end > start)

const GERMAN = { url: 'https://captions.example/de', label: 'German', language: 'de', mimeType: 'text/vtt' }

/** The settings store commits a setting only once its write has finished. */
function fixture (storedLocale) {
  const writes = []
  const store = {
    getters: { get getSecondaryCaptionLocale () { return storedLocale } },
    dispatch: (action, value) => new Promise(resolve => writes.push(() => { storedLocale = value; resolve() }))
  }
  const context = vm.createContext({
    store, findCaptionByLocale, AbortController, console,
    fetch: () => new Promise(() => {}),
    getSubtitleRequestUrl: async url => url,
    player: { getTextTracks: () => [{ active: true, language: 'en', label: 'English' }], isLive: () => false },
    props: { captions: [GERMAN] }
  })
  vm.runInContext(`
    let secondaryCaption = null
    let secondaryCaptionCues = []
    let secondaryCaptionAbortController = null
    let pendingSecondaryCaptionLocale = null
    function updateSecondaryCaptionText () {}
    function isShownAsMainCaption (caption, activeTrack) {
      return activeTrack?.language === caption.language && activeTrack.label === caption.label
    }
    ${source.slice(start, end)}
    globalThis.api = { selectSecondaryCaption, restoreSecondaryCaption, current: () => secondaryCaption }
  `, context)
  return {
    ...context.api,
    stored: () => storedLocale,
    async finishWrites () {
      for (const write of writes.splice(0)) write()
      await new Promise(resolve => setImmediate(resolve))
    }
  }
}

test('secondary captions turned off stay off while the setting is still being written', async () => {
  const captions = fixture('de')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current()?.language, 'de')

  await captions.selectSecondaryCaption(null)
  assert.equal(captions.current(), null)
  // Toggling the main captions fires text track changes before the write has finished
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)

  await captions.finishWrites()
  assert.equal(captions.stored(), '')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)
})

test('a language picked again before its write finished is restored and remembered', async () => {
  const captions = fixture('de')
  await captions.selectSecondaryCaption(null)
  // Loading the picked captions never finishes here, like a slow network
  captions.selectSecondaryCaption(GERMAN)
  await captions.selectSecondaryCaption(null)
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)

  captions.selectSecondaryCaption(GERMAN)
  await captions.finishWrites()
  assert.equal(captions.stored(), 'de')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current()?.language, 'de')
})
