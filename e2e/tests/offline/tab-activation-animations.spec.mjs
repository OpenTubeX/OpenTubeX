import { abortUnmockedRequest, expect, goTo, sel, setWindowSize, test } from '../../helpers/app.mjs'
import { mockWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const now = Date.now()
const video = {
  videoId: 'aaaaaaaaaa1',
  title: 'Cached subscription video',
  author: 'Example Channel',
  authorId: channelId,
  published: now,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  type: 'video'
}

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      reducedMotion: 'off',
      animationSpeed: 25,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      showNewSubscriptionFeed: false,
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: channelId, name: 'Example Channel', thumbnail: '' }]
    }],
    subscriptionCache: [{
      _id: channelId,
      videos: [video],
      videosTimestamp: new Date(now).toISOString(),
      shorts: [{ ...video, videoId: 'aaaaaaaaaa2', title: 'Cached subscription short', type: 'shortVideo' }],
      shortsTimestamp: new Date(now).toISOString()
    }]
  }
})

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
})

async function settleSidebarHighlightTransitions(page) {
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/)
  await page.locator('.sideNav').evaluate(async nav => {
    // getAnimations flushes styles; wait for any highlight transition to finish
    // and give its queued transitionrun event a rendering opportunity.
    await Promise.all(nav.getAnimations({ subtree: true })
      .filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

async function expectNavigationAfterFailedPresentation(page) {
  await page.mouse.move(800, 60)
  await settleSidebarHighlightTransitions(page)
  await page.locator(sel.sideNavLink('subscriptions')).first().evaluate(element => {
    window.__outgoingHighlightTransitions = []
    element.addEventListener('transitionrun', event => {
      if (event.pseudoElement === '::before') window.__outgoingHighlightTransitions.push(event.propertyName)
    })
  })
  await goTo(page, 'userplaylists')
  await expect.poll(() => page.evaluate(() => window.__outgoingHighlightTransitions)).toContain('transform')
}

test('returning to a cached subscription feed does not replay its entrance', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await expect(page.locator('#subscriptionsPanel .ft-list-video')).toBeVisible()
  const retainedGrid = await page.locator('#subscriptionsPanel .autoGrid').elementHandle()
  await page.evaluate(() => {
    window.__feedActivationAnimations = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      if (this.matches('.autoGrid')) window.__feedActivationAnimations.push(args[0])
      return animate.apply(this, args)
    }
  })

  for (const scale of [100, 95, 125]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('Cached subscription short', { exact: true })).toBeVisible()
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.getByText(video.title, { exact: true })).toBeVisible()
    expect(await retainedGrid.evaluate(element => element.isConnected)).toBe(true)
    expect(await page.evaluate(() => window.__feedActivationAnimations)).toEqual([])
  }
})

test('returning to subscription tabs preserves their highlight without replaying its entrance', async ({ app, page }) => {
  await goTo(page, 'subscriptions')
  const tabs = page.getByRole('tablist', { name: /^Subscriptions tabs$/i, includeHidden: true })
  const indicator = tabs.locator('.tabsIndicator')
  await expect(indicator).toBeVisible()
  const retainedIndicator = await indicator.elementHandle()
  await tabs.evaluate(element => {
    window.__tabHighlightEntrances = []
    new MutationObserver(records => {
      for (const record of records) {
        const elements = record.type === 'childList' ? [...record.addedNodes] : [record.target]
        for (const node of elements) {
          if (node instanceof Element && node.classList.contains('tabFade-enter-from')) {
            window.__tabHighlightEntrances.push(node.className)
          }
        }
      }
    }).observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  })
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await expect(page.locator(sel.tabs)).toHaveCount(2)

  for (const [scale, width] of [[100, 1600], [95, 1000], [125, 600]]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    if (width !== 1600) await setWindowSize(app, page, { width, height: width === 1000 ? 800 : 780 })
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.locator(sel.tabs).first().click()
      await expect(indicator).toBeVisible()
      await tabs.evaluate(async element => {
        element.getAnimations({ subtree: true })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      expect(await page.evaluate(() => window.__tabHighlightEntrances)).toEqual([])
      expect(await retainedIndicator.evaluate(element => element.isConnected)).toBe(true)
      await expect(indicator).toHaveCSS('opacity', '1')
      await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
      await expect.poll(() => tabs.evaluate(element => {
        const highlight = element.querySelector('.tabsIndicator').getBoundingClientRect()
        const selected = element.querySelector('[aria-selected="true"]').getBoundingClientRect()
        return Math.max(Math.abs(highlight.left - selected.left), Math.abs(highlight.right - selected.right), Math.abs(highlight.bottom - selected.bottom))
      })).toBeLessThan(0.2)
      await page.locator(sel.tabs).nth(1).click()
      await expect(tabs).toBeHidden()
    }
  }

  // Selecting a different feed still crossfades after presentation is restored.
  await page.locator(sel.tabs).first().click()
  await tabs.locator('[data-subscription-feed-tab="shorts"]').click()
  await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(1)
  await expect.poll(() => indicator.evaluate(element => element.getAnimations().some(animation => animation.playState === 'running'))).toBe(true)
  await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
})

test('hidden subscription tabs clear their highlight when every feed is removed', async ({ page }) => {
  await goTo(page, 'subscriptions')
  const tabs = page.getByRole('tablist', { name: /^Subscriptions tabs$/i, includeHidden: true })
  await expect(tabs.locator('.tabsIndicator')).toBeVisible()
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await expect(tabs).toBeHidden()
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateUiScale', 95)
    await Promise.all(['Videos', 'Shorts', 'Live', 'Community']
      .map(feed => store.dispatch(`updateHideSubscriptions${feed}`, true)))
  })
  await expect(tabs.locator('[role="tab"]')).toHaveCount(0)
  // Clear while hidden, rather than starting a visible leave on activation.
  await expect(tabs.locator('.tabsIndicator')).toHaveCount(0)
  await page.locator(sel.tabs).first().click()
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect(page.locator('.subscriptionsHeader')).toBeVisible()
  expect(await tabs.evaluate(element => [...element.querySelectorAll('.tabsIndicator, .tabsIndicatorOutgoing')]
    .filter(pill => pill.getClientRects().length && Number(getComputedStyle(pill).opacity) > 0).length)).toBe(0)
  await expect(tabs.locator('.tabsIndicator, .tabsIndicatorOutgoing')).toHaveCount(0)
})

test('retained subscription highlights stay aligned in the Watch minimize preview after layout changes', async ({ app, page }) => {
  await mockWatchPage(app, page)
  await goTo(page, 'subscriptions')
  const tabs = page.locator('.subscriptionsHeader .tabs')
  await tabs.locator('[data-subscription-feed-tab="shorts"]').click()
  await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
  const retainedIndicator = await tabs.locator('.tabsIndicator').elementHandle()
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${watchHistoryEntry.videoId}`)
  await page.locator(sel.searchInput).press('Enter')
  const preview = page.locator('.watchPreviewHost.watchRouteActive')
  await expect(preview.locator('.videoLayout')).toBeVisible()
  const watch = await watchViewHandle(page)
  const navigation = await watch.evaluateHandle(component => {
    const provides = component.$.parent.provides
    const key = Object.getOwnPropertySymbols(provides).find(key => key.description === 'watch-navigation')
    return provides[key]
  })
  await watch.dispose()

  for (const [scale, width, height] of [[95, 600, 800], [125, 900, 600]]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    await setWindowSize(app, page, { width, height })
    // Drive the same preview entry point as the downward minimize gesture.
    await navigation.evaluate(navigation => navigation.beginMinimizePreview())
    await expect(preview).toHaveClass(/watchPreviewing/)
    await expect(tabs).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#/watch/${watchHistoryEntry.videoId}`))
    await expect.poll(() => tabs.evaluate(element => {
      const highlight = element.querySelector('.tabsIndicator').getBoundingClientRect()
      const selected = element.querySelector('[aria-selected="true"]').getBoundingClientRect()
      return Math.max(Math.abs(highlight.left - selected.left), Math.abs(highlight.right - selected.right), Math.abs(highlight.bottom - selected.bottom))
    })).toBeLessThan(0.2)
    expect(await retainedIndicator.evaluate(element => element.isConnected)).toBe(true)
    await expect(tabs.locator('.tabsIndicator')).toHaveCSS('opacity', '1')
    await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
    await navigation.evaluate(navigation => navigation.clearMinimizePreview())
    await expect(preview).not.toHaveClass(/watchPreviewing/)
  }
  // A laid-out browsing page must clear its highlight if settings remove every
  // feed, even while Watch still owns presentation.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all(['Videos', 'Shorts', 'Live', 'Community']
      .map(feed => store.dispatch(`updateHideSubscriptions${feed}`, true)))
  })
  await navigation.evaluate(navigation => navigation.beginMinimizePreview())
  await expect(preview).toHaveClass(/watchPreviewing/)
  await expect(tabs.locator('[role="tab"]')).toHaveCount(0)
  await expect(tabs.locator('.tabsIndicator, .tabsIndicatorOutgoing')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`#/watch/${watchHistoryEntry.videoId}`))
  await navigation.evaluate(navigation => navigation.clearMinimizePreview())
  await navigation.dispose()
})

test('switching application tabs snaps the active sidebar highlight', async ({ app, page }) => {
  await goTo(page, 'subscriptions')
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator('.sideNav a[href="#/history"]').first()).toHaveClass(/router-link-active/)
  await page.locator('.sideNav').evaluate(async nav => {
    await Promise.all(nav.getAnimations({ subtree: true })
      .filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(() => {})))
    window.__sidebarHighlightTransitions = []
    nav.addEventListener('transitionrun', event => {
      if (event.pseudoElement === '::before') {
        window.__sidebarHighlightTransitions.push({ property: event.propertyName, href: event.target.getAttribute('href') })
      }
    })
  })

  for (const [scale, width] of [[100, 1600], [95, 1000], [125, 600]]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    if (width !== 1600) await setWindowSize(app, page, { width, height: width === 1000 ? 800 : 780 })
    for (const index of [0, 1, 0]) {
      await page.locator(sel.tabs).nth(index).click()
      await expect(page.locator(sel.tabs).nth(index)).toHaveClass(/active/)
      const route = index === 0 ? 'subscriptions' : 'history'
      await expect(page.locator(`.sideNav a[href="#/${route}"]`).first()).toHaveClass(/router-link-active/)
      await settleSidebarHighlightTransitions(page)
      expect(await page.evaluate(() => window.__sidebarHighlightTransitions)).toEqual([])
    }
  }

  // A selection reversed before presentation must still restore transitions.
  await page.evaluate(async () => {
    const tabs = await window.ftElectron.tabs.getState()
    await window.ftElectron.tabs.activate(tabs.tabs[1].id)
    await window.ftElectron.tabs.activate(tabs.tabs[0].id)
  })
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/)
})

test('sidebar navigation still animates the active highlight', async ({ page }) => {
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await page.locator(sel.tabs).first().click()
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/)
  await page.mouse.move(800, 60)
  await page.locator('.sideNav').evaluate(nav => {
    window.__sidebarHighlightTransitions = []
    nav.addEventListener('transitionrun', event => {
      if (event.pseudoElement === '::before') window.__sidebarHighlightTransitions.push(event.propertyName)
    })
  })
  await goTo(page, 'history')
  await expect.poll(() => page.evaluate(() => window.__sidebarHighlightTransitions)).toContain('transform')
})

test('switching application tabs snaps the mobile More highlight for overflow routes', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 600, height: 800 })
  await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), 95)
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/subscribedchannels', makeActive: true }))
  const more = page.locator('.sideNav .moreOptionNav')
  await expect(more).toBeVisible()
  await expect(more).toHaveClass(/router-link-active/)
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/)
  await expect.poll(() => more.evaluate(element => getComputedStyle(element, '::before').transitionProperty)).toContain('transform')
  await more.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(() => {})))
    window.__moreHighlightTransitions = []
    element.addEventListener('transitionrun', event => {
      if (event.pseudoElement === '::before') window.__moreHighlightTransitions.push(event.propertyName)
    })
  })
  for (const index of [0, 1, 0]) {
    await page.locator(sel.tabs).nth(index).click()
    await expect(page.locator(sel.tabs).nth(index)).toHaveClass(/active/)
    await expect.poll(() => more.evaluate(element => element.classList.contains('router-link-active'))).toBe(index === 1)
    await settleSidebarHighlightTransitions(page)
    expect(await page.evaluate(() => window.__moreHighlightTransitions)).toEqual([])
  }
})

test('restores sidebar highlight transitions when the selected tab fails to mount', async ({ page }) => {
  await goTo(page, 'subscriptions')
  const presentedTabId = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)
  const failedTab = await page.evaluate(async () => {
    const app = document.querySelector('#app').__vue_app__
    // Hold route projection so the previous tab is still presented when the
    // main process receives the real mount-failure notification.
    app.config.globalProperties.$router.beforeEach(to => {
      if (to.path === '/history') {
        window.__tabPresentationBlocked = true
        return new Promise(() => {})
      }
    })
    return window.ftElectron.tabs.create({ route: '/history', makeActive: true })
  })
  await expect.poll(() => page.evaluate(() => window.__tabPresentationBlocked)).toBe(true)
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/, { timeout: 2000 })
  await page.mouse.move(800, 60)
  const history = page.locator(sel.sideNavLink('history')).first()
  await history.hover()
  await expect.poll(() => history.evaluate(element => element.getAnimations({ subtree: true })
    .some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'transform'))).toBe(true)
  await page.evaluate(id => {
    const tab = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabById(id)
    window.ftElectron.tabs.mountFailed(id, tab.mountRevision)
  }, failedTab.id)
  await expect.poll(() => page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabById(id)?.loadState, failedTab.id)).toBe('unloaded')
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { active: store.getters.getActiveTabId, presented: store.getters.getPresentedTabId }
  })).toEqual({ active: failedTab.id, presented: presentedTabId })
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/)
  await expectNavigationAfterFailedPresentation(page)
})

test('restores sidebar highlight transitions when route projection is rejected', async ({ page }) => {
  await goTo(page, 'subscriptions')
  const presentedTabId = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)
  const failedTab = await page.evaluate(async () => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$router.beforeEach(to => {
      if (to.path === '/history') throw new Error('Expected route projection failure')
    })
    return window.ftElectron.tabs.create({ route: '/history', makeActive: true })
  })
  await expect.poll(() => page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabById(id)?.loadState, failedTab.id)).toBe('loaded')
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { active: store.getters.getActiveTabId, presented: store.getters.getPresentedTabId }
  })).toEqual({ active: failedTab.id, presented: presentedTabId })
  await expect(page.locator('.sideNav')).not.toHaveClass(/highlightTransitionsDisabled/, { timeout: 2000 })
  await expectNavigationAfterFailedPresentation(page)
})
