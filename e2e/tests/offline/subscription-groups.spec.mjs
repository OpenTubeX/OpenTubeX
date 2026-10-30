import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()
const HOUR = 3_600_000

const CHANNELS = [
  { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel' },
  { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel' },
  { id: 'UCcccccccccccccccccccccc', name: 'Gamma Channel' }
]
const [ALPHA, BETA, GAMMA] = CHANNELS.map(channel => channel.id)

function cacheEntry({ id, name }, index) {
  const timestamp = new Date(now - HOUR).toISOString()
  return {
    _id: id,
    videos: [{
      videoId: `video${index}`.padEnd(11, 'x'),
      title: `${name} upload`,
      author: name,
      authorId: id,
      published: now - (index + 2) * HOUR,
      premiereTimestamp: 0,
      viewCount: 1000,
      lengthSeconds: 120,
      liveNow: false,
      type: 'video'
    }],
    videosTimestamp: timestamp,
    shorts: [],
    shortsTimestamp: timestamp,
    liveStreams: [],
    liveStreamsTimestamp: timestamp,
    communityPosts: [],
    communityPostsTimestamp: timestamp
  }
}

function seed(settings = {}, subscriptions = CHANNELS) {
  return {
    settings: { fetchSubscriptionsAutomatically: false, ...settings },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: subscriptions.map(channel => ({ ...channel, thumbnail: '' }))
    }],
    subscriptionCache: CHANNELS.map(cacheEntry)
  }
}

const groups = page => page.getByRole('tablist', { name: 'Groups' })
const channelNames = page => page.locator('#subscribedChannelsList .channelName')
const storedGroups = page => page.evaluate(() => window.$store.getters.getSubscriptionGroupList)
const feedVideo = (page, title) => page.locator('#subscriptionsPanel .ft-list-video').filter({ hasText: title })

test.describe('creating subscription groups', () => {
  test.use({ seed: seed() })

  test('creates a group on the channels page that filters channels and the feed', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(groups(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'New Group' }).click()

    const editor = page.getByRole('dialog', { name: 'New Group' })
    await expect(editor.getByRole('textbox', { name: 'Group Name' })).toBeFocused()
    const create = editor.getByRole('button', { name: 'Create', exact: true })
    await expect(create).toBeDisabled()
    await editor.getByRole('textbox', { name: 'Group Name' }).fill('  Music  ')
    await editor.getByRole('checkbox', { name: 'Alpha Channel' }).click()
    await editor.getByRole('checkbox', { name: 'Gamma Channel' }).click()
    await expect(editor.getByText('2 selected')).toBeVisible()
    await create.click()
    await expect(editor).toBeHidden()

    // The new group is selected right away
    await expect(groups(page).getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Gamma Channel'])
    expect(await storedGroups(page)).toEqual([
      { id: expect.any(String), name: 'Music', channelIds: [ALPHA, GAMMA] }
    ])

    await goTo(page, 'subscriptions')
    await expect(groups(page).getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true')
    await expect(feedVideo(page, 'Alpha Channel upload')).toBeVisible()
    await expect(feedVideo(page, 'Gamma Channel upload')).toBeVisible()
    await expect(feedVideo(page, 'Beta Channel upload')).toBeHidden()

    await groups(page).getByRole('tab', { name: 'All' }).click()
    await expect(feedVideo(page, 'Beta Channel upload')).toBeVisible()

    // The selection is remembered on this device
    await groups(page).getByRole('tab', { name: 'Music' }).click()
    ;({ page } = await app.relaunch())
    await goTo(page, 'subscriptions')
    await expect(groups(page).getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true')
    await expect(feedVideo(page, 'Beta Channel upload')).toBeHidden()
  })
})

test.describe('saving subscription groups', () => {
  test.use({ seed: seed() })

  test('keeps the editor open when the group cannot be saved', async ({ page }) => {
    await page.evaluate(() => {
      window.$store._actions.updateSubscriptionGroups = [() => Promise.resolve(false)]
    })
    await goTo(page, 'subscribedchannels')
    await page.getByRole('button', { name: 'New Group' }).click()

    const editor = page.getByRole('dialog', { name: 'New Group' })
    await editor.getByRole('textbox', { name: 'Group Name' }).fill('Music')
    await editor.getByRole('checkbox', { name: 'Alpha Channel' }).click()
    await editor.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page.getByText('The group could not be saved.')).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Group Name' })).toHaveValue('Music')
    await expect(editor.getByRole('checkbox', { name: 'Alpha Channel' })).toHaveAttribute('aria-checked', 'true')
  })

  test.describe('with an empty profile', () => {
    test.use({
      seed: {
        ...seed(),
        profiles: [
          ...seed().profiles,
          { _id: 'empty-profile', name: 'Empty Profile', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] }
        ]
      }
    })

    test('can still create groups from every subscription', async ({ page }) => {
      await page.evaluate(() => window.$store.dispatch('updateActiveProfile', 'empty-profile'))
      await goTo(page, 'subscribedchannels')
      await expect(page.getByText('Your channel list is currently empty.')).toBeVisible()
      await page.getByRole('button', { name: 'New Group' }).click()
      await expect(page.getByRole('dialog', { name: 'New Group' }).getByRole('checkbox'))
        .toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])
    })
  })
})

test.describe('picking channels for a group', () => {
  const MANY_CHANNELS = Array.from({ length: 60 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${index}`
  }))
  test.use({ seed: seed({}, MANY_CHANNELS) })

  test('keeps the channel picker scroll range valid while searching', { tag: '@scale' }, async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await page.getByRole('button', { name: 'New Group' }).click()

    const editor = page.getByRole('dialog', { name: 'New Group' })
    const scroller = editor.locator('.promptContentScroller')
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    // The name and search fields stay outside the scrolling channel list.
    await expect(scroller.getByRole('textbox')).toHaveCount(0)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await editor.getByRole('searchbox', { name: 'Search Channels' }).fill('Channel 59')
    await expect(editor.getByRole('checkbox')).toHaveCount(1)
    await expect.poll(() => scroller.evaluate(element => ({
      scrollTop: element.scrollTop,
      overflows: element.scrollHeight > element.clientHeight + 1
    }))).toEqual({ scrollTop: 0, overflows: false })
  })
})

test.describe('picking from many channels', () => {
  const MANY_CHANNELS = Array.from({ length: 250 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${String(index).padStart(3, '0')}`
  }))
  test.use({ seed: seed({}, MANY_CHANNELS) })

  test('only mounts the channels of the loaded pages', { tag: '@performance' }, async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await page.getByRole('button', { name: 'New Group' }).click()

    const editor = page.getByRole('dialog', { name: 'New Group' })
    const checkboxes = editor.getByRole('checkbox')
    await expect(checkboxes).toHaveCount(100)
    await expect(checkboxes.last()).toHaveText('Channel 099')

    const scroller = editor.locator('.promptContentScroller')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(checkboxes).toHaveCount(200)

    // Searching covers the channels past the loaded pages.
    await editor.getByRole('searchbox', { name: 'Search Channels' }).fill('Channel 249')
    await expect(checkboxes).toHaveText(['Channel 249'])
    await checkboxes.click()
    await editor.getByRole('searchbox', { name: 'Search Channels' }).fill('')
    await expect(checkboxes).toHaveCount(100)
    await expect(editor.getByText('1 selected')).toBeVisible()

    await editor.getByRole('textbox', { name: 'Group Name' }).fill('Music')
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(editor).toBeHidden()
    expect(await storedGroups(page)).toEqual([
      { id: expect.any(String), name: 'Music', channelIds: [MANY_CHANNELS[249].id] }
    ])
  })

  test.describe('without automatic loading', () => {
    test.use({ seed: seed({ generalAutoLoadMorePaginatedItemsEnabled: false }, MANY_CHANNELS) })

    test('keeps focus in the editor when loading more channels by hand', async ({ page }) => {
      await goTo(page, 'subscribedchannels')
      await page.getByRole('button', { name: 'New Group' }).click()

      const editor = page.getByRole('dialog', { name: 'New Group' })
      await expect(editor.getByRole('checkbox')).toHaveCount(100)
      const loadMore = editor.getByRole('button', { name: 'Load More Channels' })
      await loadMore.focus()
      await page.keyboard.press('Enter')
      await expect(editor.getByRole('checkbox')).toHaveCount(200)
      await expect(editor.getByRole('checkbox', { name: 'Channel 100' })).toBeFocused()
    })
  })
})

test.describe('custom order across pages', () => {
  const MANY_CHANNELS = Array.from({ length: 60 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${index}`
  }))
  test.use({ seed: seed({ subscribedChannelsSortBy: 'custom' }, MANY_CHANNELS) })

  test('keeps a channel moved past the loaded page rendered and focused', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(channelNames(page)).toHaveCount(50)

    const handle = page.locator('#subscribedChannelsList .channel')
      .filter({ has: page.locator('.channelName', { hasText: /^\s*Channel 0\s*$/ }) })
      .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
    await handle.focus()
    await page.keyboard.press('End')
    await expect(channelNames(page).last()).toHaveText('Channel 0')
    await expect(handle).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(channelNames(page).nth(-2)).toHaveText('Channel 0')
    await expect(handle).toBeFocused()
  })
})

test.describe('editing subscription groups', () => {
  test.use({
    seed: seed({
      subscriptionGroups: [
        { id: 'music', name: 'Music', channelIds: [ALPHA, GAMMA, 'UCnotsubscribedhere00000'] },
        { id: 'empty', name: 'Empty', channelIds: [] }
      ]
    })
  })

  test('renames a group, changes its channels and deletes it', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(groups(page).getByRole('tab')).toHaveText(['All', 'Empty', 'Music'])
    await expect(page.getByRole('button', { name: 'Edit Group' })).toHaveCount(0)

    await groups(page).getByRole('tab', { name: 'Empty' }).click()
    await expect(page.getByText('This group has no channels in the current profile.')).toBeVisible()

    await groups(page).getByRole('tab', { name: 'Music' }).click()
    await page.getByRole('button', { name: 'Edit Group' }).click()
    const editor = page.getByRole('dialog', { name: 'Edit Group' })
    // Members come first
    await expect(editor.getByRole('checkbox')).toHaveText(['Alpha Channel', 'Gamma Channel', 'Beta Channel'])
    await expect(editor.getByText('2 selected')).toBeVisible()
    await editor.getByRole('textbox', { name: 'Group Name' }).fill('Songs')
    await editor.getByRole('checkbox', { name: 'Alpha Channel' }).click()
    await editor.getByRole('checkbox', { name: 'Beta Channel' }).click()
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toBeHidden()

    await expect(groups(page).getByRole('tab')).toHaveText(['All', 'Empty', 'Songs'])
    await expect(channelNames(page)).toHaveText(['Beta Channel', 'Gamma Channel'])
    // Channels this device isn't subscribed to stay in the group for other devices
    expect((await storedGroups(page)).find(group => group.id === 'music')).toEqual({
      id: 'music',
      name: 'Songs',
      channelIds: [GAMMA, 'UCnotsubscribedhere00000', BETA]
    })

    await page.getByRole('button', { name: 'Edit Group' }).click()
    await editor.getByRole('button', { name: 'Delete Group' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete the group "Songs"? Its channels stay subscribed.' })
    await confirmation.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(editor).toBeHidden()
    await expect(groups(page).getByRole('tab')).toHaveText(['All', 'Empty'])
    await expect(groups(page).getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])
  })

  test('keeps the editor open when the group cannot be deleted', async ({ page }) => {
    await page.evaluate(() => {
      window.$store._actions.updateSubscriptionGroups = [() => Promise.resolve(false)]
    })
    await goTo(page, 'subscribedchannels')
    await groups(page).getByRole('tab', { name: 'Music' }).click()
    await page.getByRole('button', { name: 'Edit Group' }).click()

    const editor = page.getByRole('dialog', { name: 'Edit Group' })
    await editor.getByRole('button', { name: 'Delete Group' }).click()
    await page.getByRole('dialog', { name: 'Delete the group "Music"? Its channels stay subscribed.' })
      .getByRole('button', { name: 'Yes, Delete' }).click()

    await expect(page.getByText('The group could not be deleted.')).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(groups(page).getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true')
  })

  test('reports a group membership that cannot be saved', async ({ page }) => {
    await page.evaluate(() => {
      window.$store._actions.updateSubscriptionGroups = [() => Promise.resolve(false)]
    })
    await goTo(page, 'subscribedchannels')
    await page.locator('.channel', { hasText: 'Beta Channel' }).locator('.profileDropdownToggle').click()
    const music = page.locator('.profileDropdown').getByRole('group', { name: 'Groups' }).getByRole('checkbox', { name: 'Music' })
    await music.click()
    await expect(page.getByText('The group could not be saved.')).toBeVisible()
    await expect(music).toHaveAttribute('aria-checked', 'false')
  })

  test('switches groups with the arrow keys', async ({ page }) => {
    await goTo(page, 'subscriptions')
    const tabs = groups(page).getByRole('tab')
    await tabs.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('This group has no channels in the current profile.')).toBeVisible()
    await page.keyboard.press('End')
    await expect(groups(page).getByRole('tab', { name: 'Music' })).toBeFocused()
    await expect(feedVideo(page, 'Alpha Channel upload')).toBeVisible()
    await expect(feedVideo(page, 'Beta Channel upload')).toBeHidden()
    await page.keyboard.press('ArrowRight')
    await expect(groups(page).getByRole('tab', { name: 'All' })).toBeFocused()
    await expect(feedVideo(page, 'Beta Channel upload')).toBeVisible()

    // Alt+Left and Alt+Right stay with back and forward navigation
    await page.keyboard.press('Alt+ArrowRight')
    await expect(groups(page).getByRole('tab', { name: 'All' })).toBeFocused()
    await expect(groups(page).getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  test('adds a channel to a group from its subscription settings', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await page.locator('.channel', { hasText: 'Beta Channel' }).locator('.profileDropdownToggle').click()

    const dropdown = page.locator('.profileDropdown')
    const groupList = dropdown.getByRole('group', { name: 'Groups' })
    await expect(groupList.getByRole('checkbox')).toHaveText(['Empty', 'Music'])
    const music = groupList.getByRole('checkbox', { name: 'Music' })
    await expect(music).toHaveAttribute('aria-checked', 'false')
    await music.click()
    await expect(music).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => (await storedGroups(page)).find(group => group.id === 'music').channelIds)
      .toEqual([ALPHA, GAMMA, 'UCnotsubscribedhere00000', BETA])
    await music.press('Space')
    await expect(music).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await storedGroups(page)).find(group => group.id === 'music').channelIds)
      .toEqual([ALPHA, GAMMA, 'UCnotsubscribedhere00000'])
  })
})

test.describe('subscription groups with automatic fetching', () => {
  test.use({
    seed: seed({
      fetchSubscriptionsAutomatically: true,
      subscriptionGroups: [{ id: 'empty', name: 'Empty', channelIds: [] }]
    })
  })

  test('selecting a group without channels does not refresh the whole profile', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscriptionFeedRefreshInProgress)).toBe(false)
    await page.evaluate(() => {
      window.subscriptionRefreshStarted = false
      window.$store.watch(
        (_state, getters) => getters.getSubscriptionFeedRefreshInProgress,
        inProgress => { if (inProgress) window.subscriptionRefreshStarted = true }
      )
    })

    await groups(page).getByRole('tab', { name: 'Empty' }).click()
    await expect(page.getByText('This group has no channels in the current profile.')).toBeVisible()
    // A refresh would start from the watchers of this update, before the next frames
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => window.subscriptionRefreshStarted)).toBe(false)
  })
})

test.describe('subscription groups in the tabbed New feed', () => {
  test.use({
    seed: seed({
      newSubscriptionFeedView: 'tabbed',
      subscriptionGroups: [{ id: 'music', name: 'Music', channelIds: [ALPHA] }]
    })
  })

  test('share the row of the New feed tabs while they fit beside them @scale', async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 1300, height: 820 })
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    const header = page.locator('.subscriptionsHeader')
    const tabs = page.getByRole('tablist', { name: 'New content tabs' })
    const groupBar = page.locator('.subscriptionGroups')
    await expect(groups(page).getByRole('tab')).toHaveText(['All', 'Music'])

    const bounds = () => Promise.all([header, tabs, groupBar].map(locator => locator.boundingBox()))
    await expect.poll(async () => {
      const [headerBounds, tabsBounds, groupsBounds] = await bounds()
      return groupsBounds.x + groupsBounds.width <= tabsBounds.x &&
        Math.abs(groupsBounds.y + groupsBounds.height / 2 - (tabsBounds.y + tabsBounds.height / 2)) < 1 &&
        Math.abs(tabsBounds.x + tabsBounds.width / 2 - (headerBounds.x + headerBounds.width / 2)) < 1
    }).toBe(true)
    await attachScreenshot('groups beside the New feed tabs')

    // Without room beside the centered tabs, they move below them
    await setWindowSize(app, page, { width: 760, height: 700 })
    await expect.poll(async () => {
      const [, tabsBounds, groupsBounds] = await bounds()
      return groupsBounds.y >= tabsBounds.y + tabsBounds.height
    }).toBe(true)
    await attachScreenshot('groups below the New feed tabs')
  })
})

test.describe('custom channel order', () => {
  test.use({
    seed: seed({
      subscribedChannelsSortBy: 'custom',
      subscriptionGroups: [{ id: 'odd', name: 'Odd', channelIds: [ALPHA, GAMMA] }]
    })
  })

  const handleOf = (page, name) => page.locator('#subscribedChannelsList .channel', { hasText: name })
    .getByRole('button', { name: 'Drag or use the arrow keys to reorder' })
  const sideNavChannels = page => page.locator('.sideNav .navChannel.channelLink')
    .evaluateAll(links => links.map(link => link.title))

  test('reorders channels by keyboard and drag and drop, and the side navigation follows', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')
    // Channels without a saved position start by name
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])

    await handleOf(page, 'Gamma Channel').focus()
    await page.keyboard.press('ArrowUp')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Gamma Channel', 'Beta Channel'])
    await expect(handleOf(page, 'Gamma Channel')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(channelNames(page)).toHaveText(['Gamma Channel', 'Alpha Channel', 'Beta Channel'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([GAMMA, ALPHA, BETA])
    await expect.poll(() => sideNavChannels(page)).toEqual(['Gamma Channel', 'Alpha Channel', 'Beta Channel'])

    await handleOf(page, 'Beta Channel').dragTo(handleOf(page, 'Gamma Channel'))
    await expect(channelNames(page)).toHaveText(['Beta Channel', 'Gamma Channel', 'Alpha Channel'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([BETA, GAMMA, ALPHA])

    // Moving within a group keeps the position of the channels it hides
    await groups(page).getByRole('tab', { name: 'Odd' }).click()
    await expect(channelNames(page)).toHaveText(['Gamma Channel', 'Alpha Channel'])
    await handleOf(page, 'Alpha Channel').focus()
    await page.keyboard.press('ArrowUp')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Gamma Channel'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([BETA, ALPHA, GAMMA])

    // Reordering is unavailable while the list is filtered or sorted by name
    await page.getByRole('searchbox', { name: 'Search Channels' }).fill('Channel')
    await expect(page.locator('#subscribedChannelsList .grabBar')).toHaveCount(0)
    await page.getByRole('searchbox', { name: 'Search Channels' }).fill('')
    await expect(page.locator('#subscribedChannelsList .grabBar')).toHaveCount(2)
    await page.getByRole('combobox', { name: 'Sort By' }).click()
    await page.getByRole('option', { name: 'A-Z' }).click()
    await expect(page.locator('#subscribedChannelsList .grabBar')).toHaveCount(0)
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Gamma Channel'])
    await expect.poll(() => sideNavChannels(page)).toEqual(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])

    await page.getByRole('combobox', { name: 'Sort By' }).click()
    await page.getByRole('option', { name: 'Custom' }).click()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsSortBy)).toBe('custom')
    ;({ page } = await app.relaunch())
    await goTo(page, 'subscribedchannels')
    await groups(page).getByRole('tab', { name: 'All' }).click()
    await expect(channelNames(page)).toHaveText(['Beta Channel', 'Alpha Channel', 'Gamma Channel'])
  })

  /** Runs native drag events on the channel cards, named by part of their text */
  async function nativeDrag(page, steps) {
    await page.evaluate(async steps => {
      const card = name => [...document.querySelectorAll('#subscribedChannelsList .channel')]
        .find(element => element.textContent.includes(name))
      const dataTransfer = new DataTransfer()
      const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
      let source
      for (const [type, name, wait] of steps) {
        if (type === 'dragstart') source = card(name)
        // A drag can end in a later call, which names its source again
        fire(type === 'dragend' ? source ?? card(name) : card(name), type)
        // The cards receive the dragged channel on the next render
        if (type === 'dragstart') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
      }
    }, steps)
  }

  test('moves onto the previous target again after returning to the dragged card', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])

    // Waits pass the move throttle, so only the target guard can skip a move
    await nativeDrag(page, [
      ['dragstart', 'Gamma'],
      ['dragenter', 'Alpha', 150],
      ['dragenter', 'Gamma', 150],
      ['dragenter', 'Alpha'],
      ['dragend']
    ])

    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Gamma Channel', 'Beta Channel'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([ALPHA, GAMMA, BETA])
  })

  test('previews the last target skipped by the move throttle before the drop', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])

    await nativeDrag(page, [
      ['dragstart', 'Alpha'],
      ['dragenter', 'Beta'],
      ['dragenter', 'Gamma', 300]
    ])
    await expect(channelNames(page)).toHaveText(['Beta Channel', 'Gamma Channel', 'Alpha Channel'])

    await nativeDrag(page, [['dragend', 'Alpha']])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([BETA, GAMMA, ALPHA])
  })

  test('keeps a drag move when the cursor enters the gliding target again', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await expect(channelNames(page)).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])

    // After Gamma takes Alpha's place, Alpha glides away beneath the cursor and
    // fires dragenter again once the move throttle has passed.
    await page.evaluate(async () => {
      const card = name => [...document.querySelectorAll('#subscribedChannelsList .channel')]
        .find(element => element.textContent.includes(name))
      const dataTransfer = new DataTransfer()
      const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
      const source = card('Gamma')
      fire(source, 'dragstart')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      fire(card('Alpha'), 'dragenter')
      await new Promise(resolve => setTimeout(resolve, 150))
      fire(card('Alpha').querySelector('.channelName'), 'dragenter')
      fire(source, 'dragend')
    })

    await expect(channelNames(page)).toHaveText(['Gamma Channel', 'Alpha Channel', 'Beta Channel'])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscribedChannelsCustomOrder))
      .toEqual([GAMMA, ALPHA, BETA])
  })
})

test.describe('subscription group bar layout', () => {
  test.use({
    seed: seed({
      subscriptionGroups: ['Music', 'Gaming', 'Programming', 'Cooking', 'Travel', 'Science', 'History'].map(name => ({
        id: name.toLowerCase(),
        name,
        channelIds: [ALPHA]
      }))
    })
  })

  test('wraps groups and their actions within the bar', { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 520, height: 820 })
    await goTo(page, 'subscribedchannels')
    await groups(page).getByRole('tab', { name: 'Science' }).click()

    const barLocator = page.locator('.subscriptionGroupBar')
    const actionsLocator = barLocator.locator('.groupActions')
    await expect(barLocator).toBeVisible()
    await expect(actionsLocator).toBeVisible()
    const bar = await barLocator.boundingBox()
    const tabs = await groups(page).getByRole('tab').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    const actions = await actionsLocator.boundingBox()
    const lastTab = tabs.at(-1)
    expect(lastTab.y).toBeGreaterThan(tabs[0].y + tabs[0].height)
    for (const box of [...tabs, actions]) {
      expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
    }

    // The actions only start a new row when they don't fit after the last group
    const center = box => box.y + box.height / 2
    if (Math.abs(center(actions) - center(lastTab)) >= 1) {
      expect(lastTab.x + lastTab.width + 4 + actions.width).toBeGreaterThan(bar.x + bar.width)
    }
    await expect(page.getByRole('button', { name: 'Edit Group' })).toBeVisible()
  })
})

test.describe('subscription group touch targets', () => {
  test.use({ seed: seed({ subscriptionGroups: [{ id: 'music', name: 'Music', channelIds: [ALPHA] }] }) })

  test('group actions keep touch-sized targets on coarse pointers', { tag: '@scale' }, async ({ page }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await expect.poll(() => page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
    await goTo(page, 'subscribedchannels')
    await groups(page).getByRole('tab', { name: 'Music' }).click()

    for (const name of ['Edit Group', 'New Group']) {
      const button = page.locator('.subscriptionGroupBar').getByRole('button', { name })
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      expect(box.width).toBeGreaterThanOrEqual(47.75)
      expect(box.height).toBeGreaterThanOrEqual(47.75)
    }
    await session.detach()
  })
})

test.describe('refresh errors in a group', () => {
  test.use({
    seed: seed({
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://feeds.example',
      useRssFeeds: true,
      subscriptionGroups: [{ id: 'music', name: 'Music', channelIds: [ALPHA, GAMMA] }]
    })
  })

  test('only lists the errors of the channels in the selected group', async ({ page }) => {
    await page.route('https://feeds.example/**', route => route.fulfill({ status: 404, body: 'Not found' }))
    await goTo(page, 'subscriptions')
    await page.getByRole('button', { name: /Refresh Videos/ }).click()

    const errorChannels = page.getByRole('heading', { name: 'Channels with Errors', level: 3 })
      .locator('xpath=..').locator('.channelName')
    await expect(errorChannels).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])
    await groups(page).getByRole('tab', { name: 'Music' }).click()
    await expect(errorChannels).toHaveText(['Alpha Channel', 'Gamma Channel'])
    await groups(page).getByRole('tab', { name: 'All' }).click()
    await expect(errorChannels).toHaveText(['Alpha Channel', 'Beta Channel', 'Gamma Channel'])
  })
})
