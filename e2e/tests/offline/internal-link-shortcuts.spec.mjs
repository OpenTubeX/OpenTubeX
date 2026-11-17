import { test, expect, goTo, goToSettingsSection, sel, waitForAppReady } from '../../helpers/app.mjs'

const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function historyLinkLabel(page) {
  await goTo(page, 'subscriptions')
  return page.locator(`${sel.sideNavLink('history')}:visible`).first().locator('.navLabel')
}

test.describe('YouTube links', () => {
  test.use({
    seed: {
      settings: { externalLinkHandling: 'openLinkAfterPrompt' }
    }
  })

  test('opens mobile video links in the app', async ({ page }) => {
    const link = page.locator('body').getByRole('link', { name: 'Mobile YouTube video' })
    await page.locator('body').evaluate((body) => {
      body.insertAdjacentHTML(
        'beforeend',
        '<a href="https://m.youtube.com/watch?v=jNQXAC9IVRw">Mobile YouTube video</a>'
      )
    })

    await link.click()

    await expect(page.getByText('Are you sure you want to open this link?')).not.toBeVisible()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  })
})

test('middle-clicking an internal link opens it in a background tab', async ({ page }) => {
  const linkLabel = await historyLinkLabel(page)

  await linkLabel.click({ button: 'middle' })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/history')
})

test('Ctrl+Alt+middle-clicking an internal link leaves its background tab unloaded', async ({ page }) => {
  const linkLabel = await historyLinkLabel(page)

  await linkLabel.click({ button: 'middle', modifiers: ['Control', 'Alt'] })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/unloaded/)
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/history')

  await page.locator(sel.tabs).nth(1).click()
  await expect(page).toHaveURL(/#\/history$/)
  await expect(page.locator(sel.tabs).nth(1)).not.toHaveClass(/unloaded/)
})

test.describe('unloaded YouTube video tabs', () => {
  const instanceUrl = 'https://invidious.test'

  test.use({
    seed: {
      settings: { backendPreference: 'invidious', defaultInvidiousInstance: instanceUrl }
    }
  })

  test('look up the title of a video link that only shows its URL', async ({ page }) => {
    const videoId = 'abcdefghijk'
    await page.route(`${instanceUrl}/api/v1/videos/**`, route => route.fulfill({
      json: { videoId, title: 'Linked video', author: 'Channel', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa', lengthSeconds: 60, published: 1, liveNow: false }
    }))
    await goTo(page, 'subscriptions')
    const url = `https://www.youtube.com/watch?v=${videoId}`
    await page.locator('body').evaluate((body, url) => {
      body.insertAdjacentHTML('beforeend', `<a href="${url}">${url}</a>`)
    }, url)

    await page.locator('body').getByRole('link', { name: url }).click({ button: 'middle', modifiers: ['Control', 'Alt'] })

    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/unloaded/)
    await expect(page.locator(sel.tabs).nth(1).locator('.tabTitleText')).toHaveText('Linked video')
  })
})

test('Ctrl or Cmd-clicking an internal link opens it in an active tab', async ({ page }) => {
  const linkLabel = await historyLinkLabel(page)

  await linkLabel.click({ modifiers: [shortcutModifier] })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
  await expect(page).toHaveURL(/#\/history$/)
})

test('shift-middle-clicking an internal link opens it in a new window', async ({ app, page }) => {
  const linkLabel = await historyLinkLabel(page)

  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window', { timeout: 5000 }),
    linkLabel.click({ button: 'middle', modifiers: ['Shift'] })
  ])
  await waitForAppReady(newWindow)

  await expect(newWindow).toHaveURL(/#\/history$/)
  await expect(page.locator(sel.tabs)).toHaveCount(1)
  await expect(page).toHaveURL(/#\/subscriptions$/)
})

test.describe('channel About links', () => {
  const instanceUrl = 'https://invidious.test'
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const featuredChannelId = 'UCbbbbbbbbbbbbbbbbbbbbbb'

  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: instanceUrl
      }
    }
  })

  test('middle-clicking a featured channel keeps the channel tab active', async ({ page }) => {
    await page.route(`${instanceUrl}/api/v1/channels/**`, route => route.fulfill({
      // Invidious leaves About out of `tabs`, so the channel's first tab is Videos
      json: new URL(route.request().url()).pathname.split('/')[5]
        ? { videos: [], continuation: null }
        : {
            author: 'Source channel',
            authorId: channelId,
            authorBanners: [],
            authorThumbnails: [],
            subCount: 1,
            totalViews: 2,
            joined: 1_700_000_000,
            autoGenerated: false,
            isFamilyFriendly: true,
            description: '',
            descriptionHtml: '',
            allowedRegions: [],
            tabs: ['videos'],
            latestVideos: [],
            relatedChannels: [{
              author: 'Featured channel',
              authorId: featuredChannelId,
              authorThumbnails: []
            }]
          }
    }))

    const sourceTab = await page.evaluate(id => window.ftElectron.tabs.create({
      route: `/channel/${id}`,
      makeActive: true
    }), channelId)

    await page.getByRole('tab', { name: 'About' }).click()
    await page.getByRole('link', { name: 'Featured channel' }).click({ button: 'middle' })

    await expect(page.locator(sel.tabs)).toHaveCount(3)
    await expect(page.locator(`.tab[data-tab-id="${sourceTab.id}"]`)).toHaveClass(/active/)
    await expect(page).toHaveURL(new RegExp(`#/channel/${channelId}/about$`))
  })
})

test('middle and Ctrl clicks open watched comments in new tabs', async ({ page }) => {
  const now = Date.now()
  await page.evaluate(threads => localStorage.setItem('commentReplyThreads', JSON.stringify(threads)),
    ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map((videoId, index) => ({
      videoId,
      threadId: `UgThread${index}`,
      commentId: `UgThread${index}`,
      channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      handle: '@commenter',
      postedAt: now - index * 1000,
      replyCount: 0,
      seen: [],
      text: `Comment ${index}`,
      videoTitle: `Video ${index}`
    })))
  const general = await goToSettingsSection(page, 'general')
  await general.getByRole('button', { name: 'Watched comments', exact: true }).click()
  const entries = page.getByRole('link').filter({ has: page.locator('.watchedCommentBody') })
  await expect(entries).toHaveCount(2)
  const startUrl = page.url()

  // Ctrl+Alt leaves the tab unloaded, so it shows the video's title instead of its route.
  await entries.nth(1).click({ button: 'middle', modifiers: ['Control', 'Alt'] })
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page.locator(sel.tabs).nth(1).locator('.tabTitleText')).toHaveText('Video 1')
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/watch/bbbbbbbbbbb?commentId=UgThread1')
  expect(page.url()).toBe(startUrl)
  // The list stays open for more background tabs.
  await expect(entries).toHaveCount(2)

  await entries.nth(0).click({ modifiers: [shortcutModifier] })
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  await expect(page.locator(sel.tabs).nth(2)).toHaveClass(/active/)
  await expect(page).toHaveURL(/#\/watch\/aaaaaaaaaaa\?commentId=UgThread0$/)
  await expect(page.locator('.settingsWindow')).toBeHidden()
})
