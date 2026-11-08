import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const lockup = JSON.parse(await readFile(new URL('../../fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const [publishedText, uploadedTime] of [['2d ago', '2 days ago'], ['57\u00a0min ago', '57 minutes ago']]) {
  test(`shows a recommendation channel whose name contains view and upload time ${uploadedTime}`, async ({ app, page }, testInfo) => {
    const recommendation = structuredClone(lockup)
    recommendation.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].metadataParts[1].text.content = publishedText
    await mockPlayableWatchPage(app, page)
    await page.route('**/youtubei/v1/next**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        contents: {
          twoColumnWatchNextResults: {
            secondaryResults: {
              secondaryResults: { results: [{ lockupViewModel: recommendation }] }
            }
          }
        }
      })
    }))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await openMockedVideo(page)

    const recommendations = page.locator(`${activeTab} .watchVideoRecommendations`).filter({ has: page.getByRole('heading', { name: 'Up Next', exact: true }) })
    await expect(recommendations.getByText('Sample recommendation', { exact: true })).toBeVisible()
    const channel = recommendations.locator('.channelName').filter({ hasText: 'StudioPreview' })
    await expect(channel).toBeVisible()
    await expect(channel).toHaveAttribute('href', /\/channel\/UC-sample-channel/)
    await expect(recommendations.locator('.viewCount')).toHaveText('12k views')
    await expect(recommendations.locator('.uploadedTime')).toHaveText(uploadedTime)
    await expectImagesLoaded(recommendations.locator('img'))
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      await recommendations.screenshot({ path: testInfo.outputPath(`recommendation-metadata-${colorScheme}.png`) })
    }
  })
}
