import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function video (index, kind) {
  return {
    videoId: `${kind}${String(index).padStart(6, '0')}`,
    title: `${kind} video ${String(index).padStart(3, '0')}`,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published: now - index * 3600000,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video'
  }
}

// Large feeds so that rendering a panel is expensive enough to stall the
// indicator animation when both happen in the same frame
const videos = Array.from({ length: 150 }, (_, index) => video(index, 'video'))
const shorts = Array.from({ length: 150 }, (_, index) => ({
  ...video(index, 'short'),
  thumbnailUrl: `https://i.ytimg.com/vi/short${index}/hq720_2.jpg?sqp=selected&rs=signature`
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString(),
        shorts,
        shortsTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

test.describe('subscriptions feed tab indicator', () => {
  test('only animates the transform, so it runs on the compositor', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.locator('.tabsIndicator')).toBeVisible()

    // The initial placement is intentionally not animated
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    await expect(page.locator('.tabsIndicator')).toHaveCSS('transition-property', 'transform')
  })

  test('starts moving before the new feed is rendered', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await expect(page.locator('.tabsIndicator')).toBeVisible()

    // Record whether the indicator is repositioned before or after the panel
    // with the new feed is put into the DOM
    await page.evaluate(() => {
      window.__mutations = []

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (mutation.target.classList.contains('tabsIndicator')) {
              window.__mutations.push('indicator')
            }
          } else if ([...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
            return node.nodeType === Node.ELEMENT_NODE &&
              (node.id === 'subscriptionsPanel' || node.classList.contains('ft-list-video'))
          })) {
            window.__mutations.push('panel')
          }
        }
      })

      observer.observe(document.querySelector('.subscriptionsPage'), {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style']
      })
    })

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('short video 000')).toBeVisible()

    const mutations = await page.evaluate(() => window.__mutations)

    expect(mutations.indexOf('indicator')).toBeGreaterThanOrEqual(0)
    expect(
      mutations.indexOf('indicator'),
      `mutation order: ${mutations.slice(0, 5).join(', ')}`
    ).toBeLessThan(mutations.indexOf('panel'))
  })

  test('ends up aligned with the selected tab', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('.tab.selectedTab')).toHaveText(/Shorts/)

    // Wait out the 200ms transition
    await page.waitForTimeout(400)

    const { indicator, tab } = await page.evaluate(() => {
      const toBox = (element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, width: rect.width, top: rect.top }
      }

      return {
        indicator: toBox(document.querySelector('.tabsIndicator')),
        tab: toBox(document.querySelector('[data-subscription-feed-tab="shorts"]'))
      }
    })

    expect(Math.abs(indicator.x - tab.x)).toBeLessThan(1)
    expect(Math.abs(indicator.width - tab.width)).toBeLessThan(1)
  })
})
