import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { selectSponsorBlockFullVideoLabel } from '../../src/renderer/helpers/player/sponsorBlockFullVideo.js'

const LABELS = {
  6161: [
    { videoID: 'aa-1', segments: [{ UUID: 'sponsor-1', category: 'sponsor', actionType: 'full', segment: [0, 0], votes: 3, locked: 0, videoDuration: 100 }] },
    { videoID: 'aa-2', segments: [] },
  ],
}

function loadSponsorBlock({ failures = 0 } = {}) {
  const requests = []
  const digests = []
  const code = readFileSync(new URL('../../src/renderer/helpers/sponsorblock.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
    .replace(/^export /gm, '')
  const api = vm.runInNewContext(`${code}\n;({ getSponsorBlockVideoLabel, deArrowData })`, {
    store: { getters: { getSponsorBlockUrl: 'https://sponsor.test' } },
    packageDetails: { productName: 'OpenTubeX', version: '0.0.0' },
    selectSponsorBlockFullVideoLabel,
    console: { error() {} },
    TextEncoder,
    crypto: {
      subtle: {
        // The first two characters stand in for the SHA-256 prefix so the test controls collisions.
        async digest(_algorithm, data) {
          const videoId = new TextDecoder().decode(data)
          digests.push(videoId)
          return Uint8Array.from([videoId.charCodeAt(0), videoId.charCodeAt(1)]).buffer
        },
      },
    },
    async fetch(url) {
      requests.push(url)
      if (failures-- > 0) return { status: 500, ok: false, text: async () => 'unavailable' }
      const prefix = url.slice(url.lastIndexOf('/') + 1)
      if (url.includes('/api/videoLabels/')) {
        return LABELS[prefix] ? { status: 200, ok: true, json: async () => LABELS[prefix] } : { status: 404, ok: false }
      }
      return { status: 200, ok: true, json: async () => ({ 'aa-1': { titles: [], thumbnails: [] } }) }
    },
  })
  return { ...api, requests, digests }
}

test('cards sharing a hash prefix share one request and one digest per video, and remounts reuse it', async () => {
  const sponsorBlock = loadSponsorBlock()
  const [first, second, duplicate] = await Promise.all([
    sponsorBlock.getSponsorBlockVideoLabel('aa-1'),
    sponsorBlock.getSponsorBlockVideoLabel('aa-2'),
    sponsorBlock.getSponsorBlockVideoLabel('aa-1'),
  ])
  assert.equal(first.UUID, 'sponsor-1')
  assert.equal(second, null)
  assert.equal(duplicate, first)
  assert.deepEqual(sponsorBlock.requests, ['https://sponsor.test/api/videoLabels/6161'])

  assert.equal(await sponsorBlock.getSponsorBlockVideoLabel('aa-2'), null)
  assert.equal(sponsorBlock.requests.length, 1, 'remounted cards must reuse the prefix response')

  assert.deepEqual(await sponsorBlock.deArrowData('aa-1'), { titles: [], thumbnails: [] })
  assert.equal(sponsorBlock.requests.at(-1), 'https://sponsor.test/api/branding/6161')
  assert.deepEqual(sponsorBlock.digests, ['aa-1', 'aa-2'], 'DeArrow must reuse the SponsorBlock digest')

  assert.equal(await sponsorBlock.getSponsorBlockVideoLabel('bb-1'), null)
  assert.equal(sponsorBlock.requests.length, 3)
})

test('a failed prefix request is retried by the next lookup', async () => {
  const sponsorBlock = loadSponsorBlock({ failures: 1 })
  await assert.rejects(sponsorBlock.getSponsorBlockVideoLabel('aa-1'))
  assert.equal((await sponsorBlock.getSponsorBlockVideoLabel('aa-1')).UUID, 'sponsor-1')
  assert.equal(sponsorBlock.requests.length, 2)
})
