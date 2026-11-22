import { mockPlayableWatchPage } from './watch.mjs'
import { demoPlayerResponse } from './media.mjs'
import { fulfillVisualFixture } from './visual-fixtures.mjs'

// These used to live in the network suite, gated on the live API. They all use
// "Me at the zoo", whose page and comment pages are recorded, so they run
// against the mocked watch page and the local demo video instead. See
// e2e/README.md, "Playing a video without YouTube".

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and leaves a fallback toast over the page. The migration
// marker stops the store from switching the engine back on launch.
export const WATCH_PAGE_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

export async function mockMusicMediaType(app, page, musicVideoType) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const requestBody = JSON.parse(request.postData() ?? '{}')
    const videoId = requestBody.videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.microformat.playerMicroformatRenderer.category = 'Music'
    if (requestBody.context?.client?.clientName === 'WEB_REMIX' && musicVideoType !== undefined) {
      response.videoDetails.musicVideoType = musicVideoType
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })
}

export async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), width: targetWidth })
  }, width)
}
