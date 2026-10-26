import { test, expect } from '../../helpers/app.mjs'
import { mockWatchPage } from '../../helpers/watch.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'

const urlEndpoint = url => ({ urlEndpoint: { url, target: 'TARGET_NEW_WINDOW' } })
const TOPIC_URL = 'https://www.un.org/en/climatechange/what-is-climate-change'
const BROADCASTER_URL = 'https://en.wikipedia.org/wiki/Deutsche_Welle?wprov=yicw1'
const HEALTH_URL = 'https://support.google.com/youtube/answer/9795167'

// Shapes returned by signed-out /next requests.
const infoPanels = [{
  infoPanelContainerRenderer: {
    title: { runs: [{ text: 'Climate change' }] },
    content: {
      infoPanelContentRenderer: {
        sourceEndpoint: urlEndpoint(TOPIC_URL),
        attributedParagraphs: [{
          content: 'United Nations • Climate change refers to long-term shifts in temperatures and weather patterns. Human activities have been the main driver of climate change, primarily due to the burning of fossil fuels like coal, oil and gas.'
        }]
      }
    }
  }
}, {
  infoPanelContentRenderer: {
    paragraphs: [{ runs: [{ text: 'DW is a German public broadcast service.' }] }],
    sourceEndpoint: urlEndpoint(BROADCASTER_URL),
    inlineSource: { runs: [{ text: 'Wikipedia', navigationEndpoint: urlEndpoint(BROADCASTER_URL) }] }
  }
}, {
  infoPanelContentRenderer: {
    paragraphs: [{ runs: [{ text: 'From a doctor licensed in the US' }] }],
    sourceEndpoint: urlEndpoint(HEALTH_URL),
    disclaimer: { runs: [{ text: 'Learn more about how experts define health sources' }] }
  }
}]

test.use({
  seed: {
    settings: {
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      defaultVideoFormat: 'legacy',
      useSponsorBlock: false,
      externalLinkHandling: '',
    }
  }
})

test('shows info panels below the video and opens their sources externally', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ shell }) => {
    globalThis.infoPanelExternalUrls = []
    shell.openExternal = async url => {
      globalThis.infoPanelExternalUrls.push(url)
    }
  })
  await mockWatchPage(app, page, { playable: true, infoPanels })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const card = page.locator('.infoPanels:visible')
  await expect(card).toHaveCount(1)
  const panels = card.locator('.infoPanel')
  await expect(panels).toHaveCount(3)

  await expect(panels.nth(0).locator('.infoPanelTitle')).toHaveText('Climate change')
  await expect(panels.nth(0).locator('.infoPanelParagraph')).toHaveText(/^Climate change refers to long-term shifts/)
  await expect(panels.nth(0).locator('.infoPanelSource')).toHaveText('Source: United Nations')
  await expect(panels.nth(1).locator('.infoPanelTitle')).toHaveCount(0)
  await expect(panels.nth(1).locator('.infoPanelParagraph')).toHaveText('DW is a German public broadcast service.')
  await expect(panels.nth(1).locator('.infoPanelSource')).toHaveText('Source: Wikipedia')
  await expect(panels.nth(2).locator('.infoPanelSource')).toHaveText('Learn more about how experts define health sources')

  // The panels sit between the video information and the description.
  const order = await page.evaluate(() => {
    const [info, panelCard, description] = ['.watchVideoInfo', '.infoPanels', '.videoDescription']
      .map(selector => [...document.querySelectorAll(selector)].find(element => element.checkVisibility()))
    return [
      info.compareDocumentPosition(panelCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      panelCard.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ]
  })
  expect(order).toEqual([4, 4])

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toContainClass(theme)
    await card.screenshot({ path: testInfo.outputPath(`info-panels-${theme}.png`) })
  }

  await panels.nth(0).locator('.infoPanelSource').click()
  await panels.nth(1).locator('.infoPanelSource').click()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.infoPanelExternalUrls)).toEqual([TOPIC_URL, BROADCASTER_URL])
})
