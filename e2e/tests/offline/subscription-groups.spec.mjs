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

  test('keeps the channel picker scroll range valid while searching', async ({ page }) => {
    const manyChannels = Array.from({ length: 60 }, (_, index) => ({
      id: `UC${String(index).padStart(22, '0')}`,
      name: `Channel ${index}`,
      thumbnail: ''
    }))
    await page.evaluate(subscriptions => {
      window.$store.commit('setProfileList', [{
        ...window.$store.getters.getProfileList[0],
        subscriptions
      }])
    }, manyChannels)
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
    await groups(page).getByRole('tab', { name: 'All' }).dispatchEvent('keydown', { key: 'ArrowRight', altKey: true })
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
    expect(await page.evaluate(() => window.subscriptionRefreshStarted)).toBe(false)
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

  test('wraps groups and their actions within the bar @scale', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 520, height: 820 })
    await goTo(page, 'subscribedchannels')
    await groups(page).getByRole('tab', { name: 'Science' }).click()

    const bar = await page.locator('.subscriptionGroupBar').boundingBox()
    const tabs = await groups(page).getByRole('tab').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    const actions = await page.locator('.subscriptionGroupBar .groupActions').boundingBox()
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
