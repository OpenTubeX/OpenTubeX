import { test, expect, sel, setWindowSize } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const channel = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Example Channel', thumbnail: 'https://invidious.test/ggpht/avatar' }

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      fetchSubscriptionsAutomatically: false,
      generalAutoLoadMorePaginatedItemsEnabled: false
    },
    profiles: [{ _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [channel] }]
  }
})

function video(videoId) {
  return {
    type: 'video',
    videoId,
    title: `Video ${videoId}`,
    author: 'Other Channel',
    authorId: 'UCbbbbbbbbbbbbbbbbbbbbbb',
    videoThumbnails: [],
    lengthSeconds: 600,
    viewCount: 1000,
    published: 1600000000,
    publishedText: '5 years ago'
  }
}

test('keeps the subscribe buttons inside a channel card in a two-column phone grid', async ({ app, page }) => {
  await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://invidious.test/api/v1/search**', route => route.fulfill({
    json: new URL(route.request().url()).searchParams.get('page') === '1'
      ? [video('aaaaaaaaaaa'), {
          type: 'channel',
          authorId: channel.id,
          author: channel.name,
          authorThumbnails: [{ url: channel.thumbnail }],
          channelHandle: '@example',
          subCount: 157000,
          description: ''
        }, video('bbbbbbbbbbb')]
      : []
  }))
  await page.locator(sel.searchInput).fill('example')
  await page.locator(sel.searchInput).press('Enter')

  const card = page.locator('.ft-list-channel')
  await expect(card).toBeVisible()
  await setWindowSize(app, page, { width: 412, height: 860 })

  const subscribeButton = card.getByRole('button', { name: 'Unsubscribe' })
  await expect(subscribeButton).toHaveClass(/compact/)
  await expect.poll(() => card.evaluate(element => {
    const cardBox = element.getBoundingClientRect()
    const buttonsBox = element.querySelector('.buttonList').getBoundingClientRect()
    return buttonsBox.left >= cardBox.left - 0.5 && buttonsBox.right <= cardBox.right + 0.5
  })).toBe(true)

  await setWindowSize(app, page, { width: 1600, height: 900 })
  await expect(subscribeButton).not.toHaveClass(/compact/)
  await expect(subscribeButton).toContainText('Unsubscribe')
})
