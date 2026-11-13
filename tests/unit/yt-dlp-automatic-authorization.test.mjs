import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { AUTOMATIC_NUMBER_LIMITS, automaticNumber, ID_REGEX } from '../../src/ytDlpArguments.js'

const source = readFileSync(new URL('../../src/main/ytDlpAutomaticDownloads.js', import.meta.url), 'utf8')
const start = source.indexOf('function automaticTitleTerms(')
assert.ok(start !== -1, 'authorizeAutomaticDownload should be found in ytDlpAutomaticDownloads.js')

const channelId = 'UCabcdefghijklmnopqrstuv'
const videoId = 'abcdefghijk'

function authorize (templateOptions, rule = {}) {
  const settingValues = {
    ytDlpAutomaticDownloadRules: JSON.stringify({ [channelId]: { template: 'template:Custom', maxDurationSeconds: 600, ...rule } }),
    ytDlpDownloadTemplates: JSON.stringify([{ name: 'Custom', options: templateOptions }])
  }
  const context = vm.createContext({
    AUTOMATIC_NUMBER_LIMITS,
    automaticNumber,
    ID_REGEX,
    CHANNEL_ID_REGEX: /^UC[\w-]{22}$/,
    AUTOMATIC_TITLE_TERM_LIMIT: 20,
    AUTOMATIC_TITLE_TERM_LENGTH_LIMIT: 100,
    BUILT_IN_AUTOMATIC_TEMPLATE_OPTIONS: new Map(),
    settings: { _findOne: async key => ({ value: settingValues[key] }) },
    structuredClone
  })
  vm.runInContext(`${source.slice(start).replaceAll('export async function', 'async function')}\nglobalThis.authorizeAutomaticDownload = authorizeAutomaticDownload`, context)
  return context.authorizeAutomaticDownload({
    videoId,
    channelId,
    template: 'template:Custom',
    automaticMediaType: 'video'
  }, true)
}

test('custom template options keep their download format settings', async () => {
  const payload = await authorize({ mode: 'audio', audioFormat: 'mp3', customArgs: '--no-mtime' })
  assert.equal(payload.mode, 'audio')
  assert.equal(payload.audioFormat, 'mp3')
  assert.equal(payload.customArgs, '--no-mtime')
})

test('custom template options cannot replace the authorized video or rule constraints', async () => {
  const payload = await authorize({
    mode: 'video',
    videoId: 'zzzzzzzzzzz',
    channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz',
    videoIds: ['zzzzzzzzzzz'],
    isPlaylist: true,
    playlistId: 'PLzzzzzzzzzzzzzzzz',
    maxDurationSeconds: null,
    titleExcludes: [],
    automatic: false
  }, { titleExcludes: 'Trailer' })
  assert.equal(payload.videoId, videoId)
  assert.equal(payload.channelId, channelId)
  assert.equal(payload.videoIds, undefined)
  assert.equal(payload.isPlaylist, undefined)
  assert.equal(payload.playlistId, undefined)
  assert.equal(payload.maxDurationSeconds, 600)
  assert.deepEqual([...payload.titleExcludes], ['Trailer'])
  assert.equal(payload.automatic, true)
})
