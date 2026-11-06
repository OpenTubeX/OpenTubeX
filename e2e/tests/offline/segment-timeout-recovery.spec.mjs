import { readFileSync } from 'node:fs'
import path from 'node:path'

import { test, expect, repoRoot } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const MANIFEST_URL = 'https://media.test/segment-timeout.mpd'
const SEGMENT_URL = 'https://media.test/segment-timeout.webm'
const MEDIA = readFileSync(path.join(repoRoot, 'e2e', 'fixtures', 'media', 'dash-demo-video.webm'))
const FIRST_CLUSTER = MEDIA.indexOf(Buffer.from([0x1F, 0x43, 0xB6, 0x75]))
// The demo stream's Cues come right before its first cluster, the SeekHead also mentions their ID
const CUES = MEDIA.lastIndexOf(Buffer.from([0x1C, 0x53, 0xBB, 0x6B]), FIRST_CLUSTER)

const MANIFEST = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT6S" minBufferTime="PT0.1S">
  <Period>
    <AdaptationSet mimeType="video/webm" codecs="vp9">
      <Representation id="demo" bandwidth="300000" width="640" height="360">
        <BaseURL>${SEGMENT_URL}</BaseURL>
        <SegmentBase indexRange="${CUES}-${FIRST_CLUSTER - 1}">
          <Initialization range="0-${CUES - 1}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`

// High-latency networks answered segment requests after Shaka's connection timeout,
// which dropped the video to the legacy formats and reloaded it in a loop (#2604)
test('keeps streaming after a segment request times out', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  /** The media segment left unanswered, and how often the player asked for it */
  let timedOutRange = null
  let timedOutRangeRequests = 0
  await page.route(SEGMENT_URL, async route => {
    const [, rawStart, rawEnd] = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range)
    const start = Number(rawStart)
    // The last segment runs to the end of the file
    const end = rawEnd === '' ? MEDIA.length - 1 : Number(rawEnd)
    // Leave the first media segment unanswered once, like a server that's too slow to respond.
    // Playback resumes where the previous player stopped, so it doesn't have to be the first one.
    if (start >= FIRST_CLUSTER) {
      timedOutRange ??= start
      if (start === timedOutRange && ++timedOutRangeRequests === 1) return
    }
    await route.fulfill({
      status: 206,
      contentType: 'video/webm',
      headers: { 'content-range': `bytes ${start}-${end}/${MEDIA.length}` },
      body: MEDIA.subarray(start, end + 1)
    })
  })

  let releaseManifest
  const manifestReady = new Promise(resolve => { releaseManifest = resolve })
  let manifestRequested
  const requested = new Promise(resolve => { manifestRequested = resolve })
  await page.route(MANIFEST_URL, async route => {
    manifestRequested()
    await manifestReady
    await route.fulfill({ contentType: 'application/dash+xml', body: MANIFEST })
  })

  try {
    const watch = await page.evaluateHandle(findWatchComponent)
    await watch.evaluate((component, url) => {
      component.proxy.manifestMimeType = 'application/dash+xml'
      component.proxy.manifestSrc = url
      component.proxy.activeFormat = 'dash'
      component.proxy.playerLoadGeneration++
    }, MANIFEST_URL)
    await requested

    // Time out within the test instead of after Shaka's 10 seconds, and without its own retry
    await page.locator(`${activeTab} .ftVideoPlayer`).evaluate(element => {
      element.ui.getControls().getPlayer().configure('streaming.retryParameters', {
        maxAttempts: 1,
        baseDelay: 100,
        backoffFactor: 1,
        fuzzFactor: 0,
        timeout: 0,
        stallTimeout: 0,
        connectionTimeout: 1000,
      })
    })
    releaseManifest()

    await waitForPlayback(page)
    expect(timedOutRangeRequests).toBeGreaterThan(1)
    expect(await watch.evaluate(component => component.proxy.activeFormat)).toBe('dash')
  } finally {
    releaseManifest()
  }
})
