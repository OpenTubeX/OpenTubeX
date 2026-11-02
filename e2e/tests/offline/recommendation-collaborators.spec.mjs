import { readFile } from 'node:fs/promises'
import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const collaborationLockup = JSON.parse(await readFile(new URL('../../fixtures/innertube/watch/collaboration-lockup.json', import.meta.url), 'utf8'))
const channelLockup = JSON.parse(await readFile(new URL('../../fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

/**
 * Serves `recommendation` as the only Up Next video, and `secondaryInfo` as
 * the watch-next metadata of the recommended video itself.
 */
async function openWatchPageWithRecommendation(app, page, recommendation, secondaryInfo = null) {
  await mockPlayableWatchPage(app, page)
  // An aborted request counts as a lost connection, which would hold the
  // collaborator lookup in the network-recovery queue
  await page.route('https://www.youtube.com/oembed**', route => route.fulfill({ status: 404, body: '' }))
  await page.route('**/youtubei/v1/next**', (route) => {
    const isRecommendationLookup = route.request().postDataJSON()?.videoId === recommendation.contentId
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(isRecommendationLookup
        ? { contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ videoSecondaryInfoRenderer: secondaryInfo }] } } } } }
        : { contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: [{ lockupViewModel: recommendation }] } } } } })
    })
  })
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
  await openMockedVideo(page)

  return page.locator(`${activeTab} .watchVideoRecommendations`).filter({ has: page.getByRole('heading', { name: 'Up Next', exact: true }) })
}

async function backgroundTabRoute(page) {
  return page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })
}

test('Up Next names every collaborator and middle-clicking them offers the collaborators', async ({ app, page }, testInfo) => {
  const recommendations = await openWatchPageWithRecommendation(app, page, collaborationLockup)

  await expect(recommendations.getByText('Sample collaboration', { exact: true })).toBeVisible()
  const byline = recommendations.locator('.channelResolverButton')
  await expect(byline).toHaveText('Channel One and Channel Two')
  await recommendations.screenshot({ path: testInfo.outputPath('up-next-collaboration.png') })

  await byline.click({ button: 'middle' })

  const prompt = page.locator('.prompt').filter({ has: page.getByRole('heading', { name: 'Collaborators' }) })
  await expect(prompt.locator('.collaboratorName')).toHaveText(['Channel One', 'Channel Two'])
  await expect(page.locator(sel.tabs)).toHaveCount(1)

  await prompt.locator('.collaboratorLink').filter({ hasText: 'Channel Two' }).click({ button: 'middle' })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect.poll(() => backgroundTabRoute(page)).toBe('/channel/UC-sample-channel-two')
})

test('middle-clicking an Up Next byline that resolves to one channel opens it in a background tab', async ({ app, page }) => {
  const recommendation = structuredClone(channelLockup)
  // A single channel whose name reads like a collaboration needs a lookup
  recommendation.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content = 'Zach and Michelle'
  const recommendations = await openWatchPageWithRecommendation(app, page, recommendation, {
    owner: {
      videoOwnerRenderer: {
        title: {
          runs: [{
            text: 'Zach and Michelle',
            navigationEndpoint: { browseEndpoint: { browseId: 'UC-sample-channel' } }
          }]
        },
        navigationEndpoint: { browseEndpoint: { browseId: 'UC-sample-channel' } },
        thumbnail: { thumbnails: [] }
      }
    }
  })

  const byline = recommendations.locator('.channelResolverButton')
  await expect(byline).toHaveText('Zach and Michelle')

  await byline.click({ button: 'middle' })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page.locator('.prompt')).toHaveCount(0)
  await expect.poll(() => backgroundTabRoute(page)).toBe('/channel/UC-sample-channel')
})
