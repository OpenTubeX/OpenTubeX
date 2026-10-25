import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { findCaptionByLocale } from '../../src/captionLanguages.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useSecondaryCaptions.js', import.meta.url), 'utf8')
const start = source.indexOf('  async function selectSecondaryCaption(')
const end = source.indexOf('  function isShownAsMainCaption(')
assert.ok(start > 0 && end > start)
assert.ok(source.includes('\nlet pendingSecondaryCaptionLocale = null\n') && source.includes('\nlet secondaryCaptionLocalePicks = 0\n'), 'The pending choice is shared by every player instance')

const GERMAN = { url: 'https://captions.example/de', label: 'German', language: 'de', mimeType: 'text/vtt' }

/**
 * Players share the module state, like instances of the component. The settings
 * store commits a setting only once its write has finished, and skips the commit
 * when a newer value has been queued in the meantime.
 */
function fixture (storedLocale) {
  const writes = []
  let latest = null
  const store = {
    getters: { get getSecondaryCaptionLocale () { return storedLocale } },
    dispatch: (action, value) => new Promise(resolve => {
      const write = () => {
        if (latest === write) storedLocale = value
        resolve()
      }
      latest = write
      writes.push(write)
    })
  }
  const context = vm.createContext({
    store, findCaptionByLocale, AbortController, console,
    fetch: () => new Promise(() => {}),
    getSubtitleRequestUrl: async url => url,
    getPlayer: () => ({ getTextTracks: () => [{ active: true, language: 'en', label: 'English' }], isLive: () => false }),
    props: { captions: [GERMAN] }
  })
  vm.runInContext(`
    let pendingSecondaryCaptionLocale = null
    let secondaryCaptionLocalePicks = 0
    globalThis.createPlayer = () => {
      let secondaryCaption = null
      let secondaryCaptionCues = []
      let secondaryCaptionAbortController = null
      function updateSecondaryCaptionText () {}
      function isShownAsMainCaption (caption, activeTrack) {
        return activeTrack?.language === caption.language && activeTrack.label === caption.label
      }
      ${source.slice(start, end)}
      return { selectSecondaryCaption, restoreSecondaryCaption, current: () => secondaryCaption }
    }
  `, context)
  return {
    createPlayer: context.createPlayer,
    stored: () => storedLocale,
    async finishWrites (count = writes.length) {
      for (const write of writes.splice(0, count)) write()
      await new Promise(resolve => setImmediate(resolve))
    }
  }
}

test('secondary captions turned off stay off while the setting is still being written', async () => {
  const settings = fixture('de')
  const captions = settings.createPlayer()
  captions.restoreSecondaryCaption()
  assert.equal(captions.current()?.language, 'de')

  await captions.selectSecondaryCaption(null)
  assert.equal(captions.current(), null)
  // Toggling the main captions fires text track changes before the write has finished
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)

  await settings.finishWrites()
  assert.equal(settings.stored(), '')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)
})

test('a player that replaces another one keeps a choice that is still being written', async () => {
  const settings = fixture('de')
  const previous = settings.createPlayer()
  previous.restoreSecondaryCaption()
  await previous.selectSecondaryCaption(null)

  const replacement = settings.createPlayer()
  replacement.restoreSecondaryCaption()
  assert.equal(replacement.current(), null)

  await settings.finishWrites()
  replacement.restoreSecondaryCaption()
  assert.equal(replacement.current(), null)
})

test('an earlier write of the same choice settling first does not end a later pending pick', async () => {
  const settings = fixture('de')
  const captions = settings.createPlayer()
  await captions.selectSecondaryCaption(null)
  // Loading the picked captions never finishes here, like a slow network
  captions.selectSecondaryCaption(GERMAN)
  await captions.selectSecondaryCaption(null)

  // The first "off" write settles, but the store skips its commit as newer picks are queued
  await settings.finishWrites(1)
  assert.equal(settings.stored(), 'de')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)

  await settings.finishWrites()
  assert.equal(settings.stored(), '')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)
})

test('a language picked again before its write finished is restored and remembered', async () => {
  const settings = fixture('de')
  const captions = settings.createPlayer()
  await captions.selectSecondaryCaption(null)
  // Loading the picked captions never finishes here, like a slow network
  captions.selectSecondaryCaption(GERMAN)
  await captions.selectSecondaryCaption(null)
  captions.restoreSecondaryCaption()
  assert.equal(captions.current(), null)

  captions.selectSecondaryCaption(GERMAN)
  await settings.finishWrites()
  assert.equal(settings.stored(), 'de')
  captions.restoreSecondaryCaption()
  assert.equal(captions.current()?.language, 'de')
})
