import { test, expect, goTo, sel, waitForAppReady } from '../../helpers/app.mjs'

const now = Date.now()
const HOUR = 3600000

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function feedVideo (videoId, title, published, extra = {}) {
  return {
    videoId,
    title,
    author: 'Channel A',
    authorId: CHANNEL_A,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

const collaborators = [
  { id: CHANNEL_A, name: 'Channel A', thumbnail: '', subtitle: '' },
  { id: 'UCcccccccccccccccccccccc', name: 'Channel C', thumbnail: '', subtitle: '' },
  { id: 'UCdddddddddddddddddddddd', name: 'Channel D', thumbnail: '', subtitle: '' }
]

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_A, name: 'Channel A', thumbnail: '' }
        ]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_A,
        videos: [
          feedVideo('aaaaaaaaaa1', 'Collab video', now - 1 * HOUR, {
            author: 'Channel A and 2 more',
            hasCollaborators: true,
            collaborators
          }),
          ...Array.from({ length: 11 }, (_, i) =>
            feedVideo(`aaaaaaaaa${i.toString(16)}2`, `Filler video ${i}`, now - (i + 2) * HOUR)
          )
        ],
        videosTimestamp: new Date(now - 2 * HOUR).toISOString()
      }
    ]
  }
})

function defineCase () {
  test('opening the collaborators prompt keeps the sticky app header visible', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    // Offscreen cards mount lazily; wait for their layout wrappers instead.
    await expect(page.locator('[data-feed-item-key]')).toHaveCount(12)
    const rootOverflowBefore = await page.evaluate(() => {
      document.documentElement.style.overflow = 'auto'
      window.scrollTo(0, 300)
      return document.documentElement.style.overflow
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    const topNav = page.locator('.topNav')
    const topBefore = await topNav.evaluate(element => element.getBoundingClientRect().top)
    await page.locator('.channelResolverButton').evaluate(element => element.click())
    await expect(page.locator('.prompt')).toBeVisible()

    await expect.poll(() => topNav.evaluate(element => element.getBoundingClientRect().top))
      .toBeCloseTo(topBefore, 0)
    await expect(topNav).toBeInViewport()
    await attachScreenshot('collaborators prompt over the scrolled feed')

    const scrollBefore = await page.evaluate(() => window.scrollY)
    await page.mouse.move(10, 200)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)

    await page.keyboard.press('Escape')
    await expect(page.locator('.prompt')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow))
      .toBe(rootOverflowBefore)
  })
}

test('middle-clicking a collaborator opens its channel in a background tab', async ({ app, page }) => {
  // A finished load publishes the channel's own name, or a fallback offline.
  // Hold the request so the tab keeps the name taken from the link.
  const heldRequests = []
  await app.electronApp.context().route('**/youtubei/v1/browse**', route => { heldRequests.push(route) })
  await goTo(page, 'subscriptions')

  await page.locator('.channelResolverButton').click()
  const prompt = page.locator('.prompt')
  await expect(prompt).toBeVisible()

  await prompt.getByRole('link', { name: 'Channel C' }).click({ button: 'middle' })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(prompt).toBeVisible()
  await expect(prompt.locator('.collaboratorName')).toHaveText(['Channel A', 'Channel C', 'Channel D'])
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/channel/UCcccccccccccccccccccccc')
  await expect.poll(() => heldRequests.length).toBeGreaterThan(0)
  await expect(page.locator(sel.tabs).nth(1)).toContainText('Channel C')
  await Promise.all(heldRequests.map(route => route.abort()))
})

test('Ctrl+Alt+middle-clicking a feed video leaves its background tab unloaded', async ({ page }) => {
  await goTo(page, 'subscriptions')

  await page.locator('.ft-list-video .title').filter({ hasText: 'Collab video' })
    .click({ button: 'middle', modifiers: ['Control', 'Alt'] })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/unloaded/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/watch/aaaaaaaaaa1')
})

test('shift-middle-clicking a collaborator opens its channel in a new window', async ({ app, page }) => {
  await goTo(page, 'subscriptions')

  await page.locator('.channelResolverButton').click()
  const prompt = page.locator('.prompt')
  await expect(prompt).toBeVisible()

  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    prompt.getByRole('link', { name: 'Channel C' }).click({ button: 'middle', modifiers: ['Shift'] })
  ])
  await waitForAppReady(newWindow)

  await expect(newWindow).toHaveURL(/#\/channel\/UCcccccccccccccccccccccc$/)
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect(prompt).toBeVisible()
})

test.describe('at 100% display scale', () => {
  defineCase()
})

// Fractional display scaling makes scrollbar-width measurements inexact,
// which must still not cause a visible feed animation.
test.describe('at 125% display scale', () => {
  test.use({ launchArgs: ['--force-device-scale-factor=1.25'] })
  defineCase()
})

test.describe('while collaborators are loading', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        showNewSubscriptionFeed: true,
        // Install request interception before avatars can prefetch collaborators.
        landingPage: 'history'
      },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [
            { id: CHANNEL_A, name: 'Channel A', thumbnail: '' }
          ]
        }
      ],
      subscriptionCache: [
        {
          _id: CHANNEL_A,
          videos: [
            feedVideo('bbbbbbbbbb1', 'Uncached collab video', now - HOUR, {
              author: 'Channel A and others',
              hasCollaborators: true,
              isNewInSubscriptionFeed: true
            })
          ],
          videosTimestamp: new Date(now - 2 * HOUR).toISOString()
        }
      ]
    }
  })

  for (const refreshedCollaborators of [undefined, []]) {
    test(`keeps fetched collaborators when a background channel refresh ${refreshedCollaborators ? 'returns an empty list' : 'omits the list'}`, async ({ app, page }) => {
      await app.electronApp.context().route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
        json: {
          author: 'Updated Channel A',
          authorId: CHANNEL_A,
          authorThumbnails: [],
          authorBanners: [],
          description: '',
          subCount: 0,
          totalViews: 0,
          joined: 0,
          tabs: ['videos'],
          relatedChannels: [],
          videos: [feedVideo('bbbbbbbbbb1', 'Uncached collab video', now - HOUR, {
            author: 'Updated Channel A',
            collaborators: refreshedCollaborators
          })],
          continuation: null
        }
      }))
      await page.route('**/youtubei/v1/next**', route => route.fulfill({
        json: {
          contents: {
            twoColumnWatchNextResults: {
              results: {
                results: {
                  contents: [{
                    videoSecondaryInfoRenderer: {
                      owner: {
                        videoOwnerRenderer: {
                          navigationEndpoint: {
                            showDialogCommand: {
                              panelLoadingStrategy: {
                                inlineContent: {
                                  dialogViewModel: {
                                    customContent: {
                                      listViewModel: {
                                        listItems: collaborators.map(({ id, name }) => ({
                                          listItemViewModel: {
                                            title: { content: name },
                                            rendererContext: {
                                              commandContext: {
                                                onTap: { innertubeCommand: { browseEndpoint: { browseId: id } } }
                                              }
                                            }
                                          }
                                        }))
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }]
                }
              }
            }
          }
        }
      }))
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="all"]').click()
      await page.locator('.channelResolverButton').click()
      const prompt = page.locator('.prompt')
      await expect(prompt.locator('.collaboratorName')).toHaveText(['Channel A', 'Channel C', 'Channel D'])
      const feedUrl = page.url()
      // Only the local API looks collaborators up, so the channel refreshes through Invidious afterwards
      await page.evaluate(async () => {
        await window.$store.dispatch('updateBackendPreference', 'invidious')
        await window.$store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
      })

      await prompt.getByRole('link', { name: 'Channel A' }).click({ button: 'middle' })

      await expect(page.locator(sel.tabs)).toHaveCount(2)
      await expect(page.locator(sel.tabs).nth(1)).toContainText('Updated Channel A')
      await expect(page.locator(sel.tabs).nth(1)).not.toHaveClass(/loading/)
      await expect(page.locator('.ft-list-video:visible .channelName')).toHaveText('Updated Channel A')
      await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
      await expect(prompt).toBeVisible()
      await expect(prompt.locator('.collaboratorName')).toHaveText(['Channel A', 'Channel C', 'Channel D'])
      await expect(page).toHaveURL(feedUrl)
    })
  }
})
