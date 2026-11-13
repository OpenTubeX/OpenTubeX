import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { test, expect, goTo, repoRoot, setWindowSize } from '../../helpers/app.mjs'
import { expectTabHighlightAligned } from '../../helpers/tabs.mjs'
import { findWatchComponent, openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { readScopedStyles } from '../../../tests/helpers/component-styles.mjs'
import {
  encryptSyncServerDeviceInfo,
  randomSyncServerDeviceId,
} from '../../../src/renderer/helpers/sync-server-sessions.js'

async function enablePhoneTabSwitcher(page) {
  await page.evaluate(() => {
    const seen = new Set()
    let switcher = null
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      if (vnode.component) {
        const component = vnode.component
        if (component.type?.__name === 'CapacitorPhoneTabSwitcher') switcher = component
        visit(component.subTree)
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
      if (Array.isArray(vnode.dynamicChildren)) vnode.dynamicChildren.forEach(visit)
    }

    visit(document.querySelector('#app')._vnode)
    if (!switcher) throw new Error('Phone tab switcher component was not mounted')
    switcher.props.enabled = true
  })
  await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeVisible()
}

async function phoneTabScrollState(page, contentSelector) {
  return await page.locator('.capacitorPhoneTabDialog').evaluate((dialog, selector) => {
    const content = dialog.querySelector(selector)
    const viewport = content.closest('[data-overlayscrollbars-viewport]')
    const scrollbar = viewport.querySelector(':scope > .os-scrollbar-vertical')
    const paddingBottom = Number.parseFloat(getComputedStyle(viewport).paddingBottom) || 0
    const maximum = Math.max(0, content.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top +
      viewport.scrollTop + paddingBottom - viewport.clientHeight)
    return {
      scrollTop: viewport.scrollTop,
      maximum,
      scrollbarUnusable: scrollbar?.classList.contains('os-scrollbar-unusable') ?? false,
    }
  }, contentSelector)
}

for (const theme of ['dark']) {
  test(`phone organizer covers navigation and keeps themed safe areas in ${theme} mode`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await page.evaluate(async baseTheme => {
      const store = window.$store
      await store.dispatch('updateBaseTheme', baseTheme)
      document.documentElement.style.setProperty('--safe-area-inset-top', '28px')
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    }, theme)
    await enablePhoneTabSwitcher(page)
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const overlay = page.locator('.capacitorPhoneTabOverlay')
    await expect(overlay).toBeVisible()
    for (const size of [{ width: 375, height: 760 }, { width: 760, height: 375 }]) {
      if (size.width !== 375) await setWindowSize(app, page, size)
      const metrics = await overlay.evaluate(element => {
        const dialog = element.querySelector('.capacitorPhoneTabDialog')
        const header = element.querySelector('.capacitorPhoneTabHeader')
        const bounds = dialog.getBoundingClientRect()
        return {
          top: bounds.top,
          bottom: innerHeight - bounds.bottom,
          left: bounds.left,
          right: innerWidth - bounds.right,
          background: getComputedStyle(element).backgroundColor,
          headerBackground: getComputedStyle(header).backgroundColor,
        }
      })
      expect(metrics.background).toBe(metrics.headerBackground)
      expect(metrics.top).toBeCloseTo(28, 0)
      expect(metrics.bottom).toBeCloseTo(24, 0)
      expect(metrics.left).toBeCloseTo(0, 0)
      expect(metrics.right).toBeCloseTo(0, 0)
    }
  })
}

test('phone organizer clamps its grid after column and viewport changes', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 400 })
  await page.evaluate(async () => {
    await window.ftElectron.setZoomFactor(0.95)
    const store = window.$store
    for (let index = 0; index < 6; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const panel = page.locator('#capacitor-phone-open-tabs-panel')
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeGreaterThan(100)
  const portrait = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
  await setWindowSize(app, page, { width: 760, height: 401 })
  await expect.poll(async () => {
    const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
    return state.maximum < portrait.maximum && state.scrollTop <= state.maximum + 1
  }).toBe(true)
  await expect.poll(() => panel.evaluate(viewport => {
    const track = viewport.querySelector('.os-scrollbar-vertical .os-scrollbar-track')
    const handle = track.querySelector('.os-scrollbar-handle')
    const actual = handle.getBoundingClientRect().height / track.getBoundingClientRect().height
    const expected = viewport.clientHeight / viewport.scrollHeight
    return Math.abs(actual - expected)
  })).toBeLessThan(0.02)
  await setWindowSize(app, page, { width: 375, height: 400 })
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await setWindowSize(app, page, { width: 376, height: 950 })
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
})

for (const theme of ['light']) {
  test(`phone organizer shows a responsive thumbnail grid in ${theme} mode`, async ({ app, page }, testInfo) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#216a83"/><circle cx="220" cy="70" r="40" fill="#f7c76a"/></svg>'
    await page.route('https://i.ytimg.com/vi/grid-video/*', route => route.fulfill({
      contentType: 'image/svg+xml', body: thumbnail,
    }))
    await page.evaluate(async baseTheme => {
      const store = window.$store
      await store.dispatch('updateBaseTheme', baseTheme)
      for (const [route, title] of [
        ['/watch/grid-video', 'A walk along the coast at sunset'],
        ['/channel/grid-channel', 'Travel channel'],
        ['/history', 'History'],
        ['/playlists', 'Playlists'],
      ]) {
        await store.dispatch('createTab', { route, title, makeActive: false, lazyLoad: true })
      }
      store.commit('setChannelThumbnail', {
        channelId: 'grid-channel',
        thumbnail: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#6b4596"/></svg>'),
      })
      await store.dispatch('setTabPinned', { tabId: store.getters.getActiveTabId, isPinned: true })
    }, theme)
    await enablePhoneTabSwitcher(page)
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const grid = page.locator('.capacitorPhoneOpenTabs')
    const cards = grid.locator('.capacitorPhoneTabRow')
    await expect(cards).toHaveCount(5)
    await expect(grid.locator('.capacitorPhoneTabDragHandle')).toHaveCount(0)
    // The loading shimmer shares the thumbnail class until the image loads.
    await expect(cards.nth(1).locator('img.capacitorTabThumbnail')).toBeVisible()
    await expect.poll(() => cards.nth(1).locator('img').evaluate(image => image.naturalWidth)).toBe(320)
    await expect(cards.nth(2).locator('.capacitorTabPreviewAvatar')).toBeVisible()
    await expect(cards.first().locator('.capacitorTabPreviewPin')).toBeVisible()
    await expect(cards.nth(3).locator('.capacitorTabPreview [data-icon="clock-rotate-left"]')).toBeVisible()
    await expect(cards.first().locator('[role="tab"]')).toHaveAttribute('aria-selected', 'true')

    for (const scenario of [
      { width: 375, height: 760, scale: 1, direction: 'ltr', columns: 2 },
      { width: 760, height: 375, scale: 0.95, direction: 'rtl', columns: 5 },
      { width: 375, height: 760, scale: 1.1, direction: 'ltr', columns: 2 },
    ]) {
      if (scenario.scale !== 1) await setWindowSize(app, page, scenario)
      await page.evaluate(({ scale, direction }) => {
        window.ftElectron.setZoomFactor(scale)
        document.body.dir = direction
      }, scenario)
      await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length))
        .toBe(scenario.columns)
      const geometry = await cards.evaluateAll(elements => elements.map(element => {
        const card = element.getBoundingClientRect()
        const preview = element.querySelector('.capacitorTabPreview').getBoundingClientRect()
        const close = element.querySelector('.capacitorPhoneTabClose').getBoundingClientRect()
        return {
          inside: card.left >= 0 && card.right <= innerWidth,
          ratio: preview.width / preview.height,
          closeInside: close.left >= card.left && close.right <= card.right && close.bottom <= card.bottom,
          targets: [close.width, close.height],
        }
      }))
      for (const card of geometry) {
        expect(card.inside).toBe(true)
        expect(card.ratio).toBeCloseTo(16 / 9, 1)
        expect(card.closeInside).toBe(true)
        expect(Math.min(...card.targets)).toBeGreaterThanOrEqual(47.9)
      }
      if (scenario.scale === 1) {
        const screenshot = testInfo.outputPath(`phone-tab-grid-${theme}.png`)
        await page.locator('.capacitorPhoneTabDialog').screenshot({ path: screenshot })
        await testInfo.attach('Phone tab thumbnail grid', { path: screenshot, contentType: 'image/png' })
      }
    }
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setThumbnailPreference', 'hidden')
    })
    await expect(cards.nth(1).locator('.capacitorTabThumbnail')).toHaveCount(0)
    await expect(cards.nth(1).locator('[data-icon="clapperboard"]')).toBeVisible()
  })
}

test('phone cards open actions while held and dismiss them when dragging', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const card = page.locator('.capacitorPhoneTabRow').first()
  const target = card.locator('.capacitorPhoneTabTarget')
  const bounds = await target.boundingBox()
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + 24

  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  const actions = page.locator('.capacitorTabActions')
  await expect(actions).toBeVisible()
  await page.mouse.up()
  await expect(actions.getByRole('menuitem', { name: 'Pin Tab', exact: true })).toBeVisible()
  await page.locator('.capacitorTabActionsBackdrop').click({ position: { x: 5, y: 5 } })
  await expect(actions).toBeHidden()

  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  await page.mouse.move(x + 24, y + 24, { steps: 4 })
  await expect(card).toHaveClass(/dragging/)
  await page.mouse.up()
  await expect(actions).toBeHidden()
  await expect(card).not.toHaveClass(/holding|dragging/)
  await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()

  await target.click({ button: 'right' })
  await expect(actions).toBeVisible()
})

test('phone dragged cards follow the pointer and slide neighbors into their new slots', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(async () => {
    const store = window.$store
    for (let index = 0; index < 3; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const cards = page.locator('.capacitorPhoneTabRow')
  const source = cards.first()
  const neighbor = cards.nth(1)
  const initial = await source.boundingBox()
  const adjacent = await neighbor.boundingBox()
  const x = initial.x + initial.width / 2
  const y = initial.y + 30
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(source).toHaveClass(/holding/)
  await page.mouse.move(x + 24, y + 18, { steps: 3 })
  await expect.poll(async () => {
    const rect = await source.boundingBox()
    return { x: Math.round(rect.x - initial.x), y: Math.round(rect.y - initial.y) }
  }).toEqual({ x: 24, y: 18 })
  await page.mouse.move(adjacent.x + adjacent.width / 2, y + 18, { steps: 6 })
  await expect.poll(async () => (await neighbor.boundingBox()).x).toBeCloseTo(initial.x, 0)
  await expect(source).toHaveCSS('transition-duration', '0s')
  await expect(neighbor).not.toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.capacitorTabActions')).toBeHidden()
  // Cancelling returns to the committed order without activating a tab.
  await source.dispatchEvent('pointercancel')
  await page.mouse.up()
  await expect.poll(async () => (await source.boundingBox()).x).toBeCloseTo(initial.x, 0)
  await expect.poll(async () => (await neighbor.boundingBox()).x).toBeCloseTo(adjacent.x, 0)
})

test('phone card dragging keeps its finger offset while scrolling and stops at the content end', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 450 })
  await page.evaluate(async () => {
    window.ftElectron.setZoomFactor(0.95)
    const store = window.$store
    for (let index = 0; index < 7; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const card = page.locator('.capacitorPhoneTabRow').first()
  const panel = page.locator('.capacitorPhoneTabList')
  const bounds = await card.boundingBox()
  const viewport = await panel.boundingBox()
  const x = bounds.x + bounds.width / 2
  const edgeY = viewport.y + viewport.height - 12
  await page.mouse.move(x, bounds.y + 30)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  await page.mouse.move(x, edgeY, { steps: 5 })
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  await expect.poll(async () => (await card.boundingBox()).y).toBeCloseTo(edgeY - 30, 0)
  await expect.poll(async () => {
    const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
    return Math.abs(state.scrollTop - state.maximum)
  }).toBeLessThan(2)
  // Keep holding at the edge after reaching the end; the translated card
  // must not continually extend the scroll range beneath itself.
  await page.waitForTimeout(300)
  const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
  expect(state.scrollTop).toBeLessThanOrEqual(state.maximum + 1)
  await card.dispatchEvent('pointercancel')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/holding|dragging/)
})

test('fits synced-device tabs in the phone tab organizer', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await enablePhoneTabSwitcher(page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [
      {
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session',
        tabs: [
          { id: 'history', title: 'History', url: '/history' },
          { id: 'subscriptions', title: 'Subscriptions', url: '/subscriptions' },
        ]
      },
      {
        syncDeviceId: 'mobile-e2e',
        syncPlatform: 'mobile',
        sessionId: 'mobile-session',
        tabs: [
          { id: 'home', title: 'Home', url: '/home' },
        ]
      },
    ])
  })
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await page.getByRole('tab', { name: 'Tabs from other devices' }).click()

  const dialog = page.locator('.capacitorPhoneTabDialog')
  await expect.poll(() => dialog.evaluate(element => (
    element.scrollWidth <= element.clientWidth + 1
  ))).toBe(true)

  const touchTargetHeights = await dialog.getByRole('button').evaluateAll(buttons => (
    buttons.map(button => button.getBoundingClientRect().height)
  ))
  expect(touchTargetHeights.every(height => height >= 48)).toBe(true)
  const actionAlignment = await dialog.locator('.capacitorPhoneSyncedSessionHeader')
    .evaluate(header => {
      const headerBounds = header.getBoundingClientRect()
      const openAllBounds = header.querySelector('.capacitorPhoneSyncedOpenAll').getBoundingClientRect()
      const deleteBounds = header.querySelector('.capacitorPhoneSyncedDelete').getBoundingClientRect()
      return {
        openAllStartOffset: Math.abs(openAllBounds.left - headerBounds.left),
        deleteEndOffset: Math.abs(deleteBounds.right - headerBounds.right),
      }
    })
  expect(actionAlignment.openAllStartOffset).toBeLessThanOrEqual(1)
  expect(actionAlignment.deleteEndOffset).toBeLessThanOrEqual(1)
  await expectTabHighlightAligned(dialog.locator('.capacitorPhoneTabViewTabs [aria-selected="true"]'))

  await setWindowSize(app, page, { width: 760, height: 375 })
  await expect.poll(() => dialog.evaluate(element => (
    element.scrollWidth <= element.clientWidth + 1 &&
    element.scrollHeight <= element.clientHeight + 1
  ))).toBe(true)
})

for (const layout of ['phone', 'desktop']) {
  test(`confirms opening all synced tabs in the ${layout} organizer`, async ({ app, page }) => {
    if (layout === 'phone') {
      await setWindowSize(app, page, { width: 375, height: 760 })
      await enablePhoneTabSwitcher(page)
    }
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setSyncServerEnabled', true)
      store.commit('setSyncServerToken', 'e2e-token')
      store.commit('setSyncServerPrivacyMode', 'enhanced')
      store.commit('setSyncServerSyncSessions', true)
      store.commit('setSyncServerSharedTabs', false)
      store.commit('setSyncServerOtherDeviceSessions', [{
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session',
        tabs: [
          { id: 'history', title: 'History', url: '/history' },
          { id: 'playlists', title: 'Playlists', url: '/playlists' },
        ],
      }])
    })
    const initialTabIds = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id)))
    await page.locator(layout === 'phone' ? '.capacitorPhoneTabSwitcherButton' : '.tabBar .tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    if (layout === 'phone') await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()
    const openAll = organizer.getByRole('button', { name: 'Open all tabs' })
    const confirmation = page.getByRole('dialog', { name: 'Open all tabs?', exact: true })
    // A single synced tab must still open directly, without the bulk confirmation.
    await organizer.locator(layout === 'phone' ? '.capacitorPhoneSyncedTabTarget' : '.syncedTabTarget')
      .filter({ hasText: 'History' }).click()
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.length)))
      .toBe(initialTabIds.length + 1)
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.at(-1).route.fullPath)))
      .toBe('/history')
    await expect(confirmation).toHaveCount(0)
    if (layout === 'phone') {
      await expect(organizer).toHaveCount(0)
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()
    }
    const tabIdsBefore = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id)))
    await page.evaluate(() => {
      const store = window.$store
      const openSession = store._actions.openSyncServerSession[0]
      window.__syncOpen = { calls: 0 }
      store._actions.openSyncServerSession[0] = async session => {
        window.__syncOpen.calls += 1
        await new Promise((resolve, reject) => {
          window.__syncOpen.release = fail => fail ? reject(new Error('Test opening failure')) : resolve()
        })
        return openSession(session)
      }
    })
    for (const dismiss of ['cancel', 'escape', 'backdrop']) {
      await openAll.click()
      await expect(confirmation).toContainText('Desktop · 2 tabs')
      await expect(organizer).toHaveAttribute('inert', '')
      if (layout === 'phone') {
        expect(await confirmation.evaluate(element => getComputedStyle(element.closest('.prompt')).zIndex)).toBe('1200')
      }
      if (dismiss === 'cancel') await confirmation.getByRole('button', { name: 'Cancel' }).click()
      else if (dismiss === 'escape') await page.keyboard.press('Escape')
      else await page.locator('.prompt:not([inert])').click({ position: { x: 5, y: 5 } })
      await expect(confirmation).toHaveCount(0)
      await expect(organizer).not.toHaveAttribute('inert')
      await expect(openAll).toBeFocused()
      expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id))))
        .toEqual(tabIdsBefore)
    }
    for (const [index, fail] of [true, false].entries()) {
      await openAll.click()
      await confirmation.getByRole('button', { name: 'Open all tabs', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.__syncOpen.calls)).toBe(index + 1)
      await expect(confirmation).toBeVisible()
      await expect(organizer).toHaveAttribute('inert', '')
      await expect(confirmation).toHaveAttribute('inert', '')
      // Synthetic clicks exercise the handler guard even when native inert filtering is bypassed.
      await confirmation.getByRole('button', { name: 'Open all tabs', exact: true }).dispatchEvent('click')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).dispatchEvent('click')
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 5)
      await expect(organizer).toBeVisible()
      await expect(confirmation).toBeVisible()
      expect(await page.evaluate(() => window.__syncOpen.calls)).toBe(index + 1)
      await page.evaluate(fail => window.__syncOpen.release(fail), fail)
      await expect(confirmation).toHaveCount(0)
      if (fail) {
        await expect(organizer).not.toHaveAttribute('inert')
        await expect(openAll).toBeFocused()
        expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id))))
          .toEqual(tabIdsBefore)
      }
    }
    if (layout === 'phone') await expect(organizer).toHaveCount(0)
    else await expect(organizer).not.toHaveAttribute('inert')
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => (
      state.tabs.slice(-2).map(tab => tab.route.fullPath)
    )))).toEqual(['/history', '/playlists'])
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.length)))
      .toBe(tabIdsBefore.length + 2)
  })
}

test('shows remote tab sets as tabs and confirms deletion in the phone organizer', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await enablePhoneTabSwitcher(page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [
      {
        syncDeviceId: 'phone-e2e',
        syncPlatform: 'mobile',
        sessionId: 'mobile-session-e2e',
        tabs: Array.from({ length: 30 }, (_, index) => ({
          id: `mobile-${index}`,
          title: `Mobile tab ${index}`,
          url: `/watch/mobile-${index}`,
        })),
      },
      {
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session-e2e',
        tabs: [{ id: 'desktop-subscriptions', title: 'Desktop subscriptions', url: '/subscriptions' }],
      },
      ...Array.from({ length: 7 }, (_, sessionIndex) => ({
        syncDeviceId: `extra-desktop-${sessionIndex}`,
        syncPlatform: 'desktop',
        sessionId: `extra-session-${sessionIndex}`,
        tabs: Array.from({ length: sessionIndex + 2 }, (_, tabIndex) => ({
          id: `extra-${sessionIndex}-${tabIndex}`,
          title: `Extra tab ${sessionIndex}-${tabIndex}`,
          url: `/watch/extra-${sessionIndex}-${tabIndex}`,
        })),
      })),
    ])
    store._actions.deleteSyncServerSession = [session => {
      store.commit(
        'setSyncServerOtherDeviceSessions',
        store.getters.getSyncServerOtherDeviceSessions.filter(candidate => (
          candidate.syncDeviceId !== session.syncDeviceId ||
          candidate.sessionId !== session.sessionId
        ))
      )
      return Promise.resolve(true)
    }]
  })

  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const organizer = page.locator('.capacitorPhoneTabDialog')
  await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()

  const sessionTabs = organizer.locator('.capacitorPhoneSyncedSessionTabs')
  const mobileTab = sessionTabs.getByRole('tab', { name: 'Mobile · 30 tabs', exact: true })
  const desktopTab = sessionTabs.getByRole('tab', { name: 'Desktop · 1 tab', exact: true })
  const syncedPanel = organizer.locator('.capacitorPhoneSyncedTabs')
  const syncedSet = organizer.locator('.capacitorPhoneSyncedSession[role="tabpanel"]')
  await expect(sessionTabs).toHaveAttribute('data-overlayscrollbars-viewport')
  const sessionTablist = sessionTabs.getByRole('tablist', { name: 'Tabs from other devices' })
  await expect(sessionTablist).toHaveCount(1)
  await expect(sessionTablist.locator(':scope > [role="tab"]')).toHaveCount(9)
  await expect(sessionTabs.getByRole('tab')).toHaveCount(9)
  await expect.poll(() => sessionTabs.evaluate(element => ({
    horizontallyScrollable: element.scrollWidth > element.clientWidth,
    selectedSetVisible: document.querySelector('.capacitorPhoneSyncedTabs').clientHeight > 0,
  }))).toEqual({ horizontallyScrollable: true, selectedSetVisible: true })
  await expect(mobileTab).toHaveAttribute('aria-selected', 'true')
  await expect(desktopTab).toHaveAttribute('aria-selected', 'false')
  await expect(syncedSet).toContainText('Mobile tab 0')
  await expect(syncedSet).not.toContainText('Desktop subscriptions')

  await mobileTab.press('ArrowRight')
  await expect(desktopTab).toBeFocused()
  await expect(desktopTab).toHaveAttribute('aria-selected', 'true')
  await expect(syncedSet).toContainText('Desktop subscriptions')
  await expect(syncedSet).not.toContainText('Mobile tab 0')

  await desktopTab.press('Home')
  await expect(mobileTab).toBeFocused()
  await expect(mobileTab).toHaveAttribute('aria-selected', 'true')
  await syncedPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => (
    await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')
  ).scrollTop).toBeGreaterThan(0)

  const deleteSet = syncedSet.getByRole('button', { name: 'Delete: Mobile · 30 tabs' })
  await deleteSet.click()
  let confirmation = page.getByRole('dialog', { name: 'Delete' })
  await expect(confirmation).toContainText('Mobile · 30 tabs')
  await expect(organizer).toHaveAttribute('inert', '')
  await expect.poll(async () => ({
    confirmation: Number.parseInt(await confirmation.evaluate(element => getComputedStyle(element.closest('.prompt')).zIndex)),
    organizer: Number.parseInt(await organizer.evaluate(element => getComputedStyle(element.closest('.capacitorPhoneTabOverlay')).zIndex)),
  })).toEqual({ confirmation: 1200, organizer: 1100 })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(organizer).not.toHaveAttribute('inert')
  await expect(syncedSet).toBeVisible()

  await deleteSet.click()
  confirmation = page.getByRole('dialog', { name: 'Delete' })
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(mobileTab).toHaveCount(0)
  await expect(desktopTab).toBeFocused()
  await expect(desktopTab).toHaveAttribute('aria-selected', 'true')
  await expect(syncedSet).toContainText('Desktop subscriptions')
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSyncServerOtherDeviceSessions', store.getters.getSyncServerOtherDeviceSessions.slice(0, 1))
  })
  await syncedSet.getByRole('button', { name: 'Delete: Desktop · 1 tab' }).click()
  await page.getByRole('dialog', { name: 'Delete' })
    .getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(sessionTabs).toHaveCount(0)
  await expect(organizer.locator('.capacitorPhoneTabTarget[aria-selected="true"]')).toBeFocused()
})

test('restores and clamps the real phone tab organizer viewports', async ({ app, page }) => {
  const privacyKey = randomBytes(32).toString('base64')
  const desktopDeviceId = randomSyncServerDeviceId()
  const encryptedDeviceInfo = await encryptSyncServerDeviceInfo({
    name: 'Living room PC',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }, privacyKey, desktopDeviceId)
  let accountSessionRequests = 0
  let healthRequests = 0
  await page.route('https://sync.opentubex.org/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/health') {
      healthRequests++
      await route.fulfill({ status: 200, json: { capabilities: { account_sessions: 1 } } })
    } else if (pathname === '/v1/account/sessions') {
      accountSessionRequests++
      await route.fulfill({
        status: 200,
        json: {
          sessions: [{
            device_id: desktopDeviceId,
            encrypted_device_info: encryptedDeviceInfo,
          }],
        },
      })
    } else {
      await route.fulfill({ status: 500, body: 'Unexpected sync request' })
    }
  })
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await enablePhoneTabSwitcher(page)
  await page.evaluate(async ({ desktopDeviceId, privacyKey }) => {
    const store = window.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyKey', privacyKey)
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [
      {
        syncDeviceId: desktopDeviceId,
        syncPlatform: 'desktop',
        sessionId: 'long-session-e2e',
        tabs: Array.from({ length: 30 }, (_, index) => ({
          id: `synced-${index}`,
          title: `Synced tab ${index}`,
          url: `/watch/synced-${index}`,
        })),
      },
      {
        syncDeviceId: desktopDeviceId,
        syncPlatform: 'desktop',
        sessionId: 'short-session-e2e',
        tabs: [{ id: 'short-synced', title: 'Short synced tab', url: '/subscriptions' }],
      },
    ])
    for (let index = 0; index < 30; index++) {
      await store.dispatch('createTab', { route: `/watch/local-${index}`, makeActive: false, isUnloaded: true })
    }
  }, { desktopDeviceId, privacyKey })
  await expect.poll(() => page.locator('.capacitorPhoneTabCount').textContent()).toBe('31')
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await expect.poll(() => accountSessionRequests).toBe(1)
  expect(healthRequests).toBe(0)

  const openPanel = page.locator('#capacitor-phone-open-tabs-panel')
  await expect(openPanel).toHaveAttribute('data-overlayscrollbars-viewport')
  await openPanel.evaluate(element => { element.scrollTop = 240 })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeCloseTo(240, 0)
  await page.getByRole('tab', { name: 'Tabs from other devices' }).click()

  const syncedPanel = page.locator('.capacitorPhoneSyncedTabs')
  await expect(page.getByRole('tab', { name: 'Living room PC · 30 tabs', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(syncedPanel).toHaveAttribute('data-overlayscrollbars-viewport')
  await syncedPanel.evaluate(element => { element.scrollTop = 360 })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).scrollTop)
    .toBeCloseTo(360, 0)
  await page.getByRole('tab', { name: /open tabs/ }).click()
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeCloseTo(240, 0)

  await openPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(async () => {
    const store = window.$store
    const ids = store.getters.getTabs.slice(0, -2).map(tab => tab.id)
    for (const id of ids) await store.dispatch('closeTab', id)
  })
  await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(2)
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })

  await page.getByRole('tab', { name: 'Tabs from other devices' }).click()
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).scrollTop)
    .toBeCloseTo(360, 0)
  await syncedPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(desktopDeviceId => {
    const store = window.$store
    store.commit('setSyncServerDevices', { [desktopDeviceId]: { name: 'Desk PC', platform: 'linux' } })
  }, desktopDeviceId)
  await page.getByRole('tab', { name: 'Desk PC · 1 tab', exact: true }).click()
  await expect(page.locator('.capacitorPhoneSyncedTabTarget')).toHaveCount(1)
  await expect(page.locator('.capacitorPhoneSyncedSessionTab[aria-selected="true"]'))
    .toHaveText('Desk PC · 1 tab')
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
})

test('collapsed description footer stays clickable below its faded text', async ({ page }) => {
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/WatchVideoDescription/WatchVideoDescription.css'
    )
  })
  await page.evaluate(() => {
    const card = document.createElement('div')
    const more = document.createElement('button')
    const scroll = document.createElement('div')
    const description = document.createElement('div')

    card.className = 'videoDescription short'
    card.style.backgroundColor = 'var(--card-bg-color)'
    card.style.inset = '300px auto auto 300px'
    card.style.padding = '16px'
    card.style.position = 'fixed'
    card.style.width = '300px'
    card.style.zIndex = '10000'
    more.className = 'descriptionStatus'
    more.textContent = 'Show more'
    scroll.className = 'descriptionScroll'
    description.className = 'description'
    description.textContent = Array.from(
      { length: 20 },
      (_, index) => `Long description segment ${index + 1}`
    ).join(' ')

    scroll.append(description)
    card.append(scroll, more)
    document.body.append(card)
  })

  const description = page.locator('.videoDescription.short').first()
  const more = description.locator('.descriptionStatus')
  await expect(more).toBeVisible()
  await expect.poll(async () => more.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    ) === element
  })).toBe(true)
})

test('keeps Android player notices and end cards clear of visible controls', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 800, height: 480 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await page.evaluate(async () => {
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    const app = document.querySelector('.app')
    const store = window.$store
    await store.dispatch('updateShowFullscreenActionsWhenPaused', true)
    app.classList.add('capacitorTabs')
  })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await page.locator('.full-window-button').first().dispatchEvent('click')
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
  await page.evaluate(() => {
    const player = document.querySelector('.ftVideoPlayer')
    const controls = player.querySelector('.shaka-controls-container')
    const seekBar = controls.querySelector('.shaka-seek-bar-container')
    const actionDock = player.querySelector('.fullscreenActions')
    const notice = document.createElement('div')
    const noticeAction = document.createElement('button')
    const annotations = document.createElement('div')
    const endCard = document.createElement('button')

    player.dir = 'rtl'
    controls.setAttribute('shown', 'true')
    window.__keepTestControlsShown = new MutationObserver(() => {
      if (controls.getAttribute('shown') !== 'true') controls.setAttribute('shown', 'true')
    })
    window.__keepTestControlsShown.observe(controls, {
      attributeFilter: ['shown'],
      attributes: true,
    })

    notice.className = 'skippedSegmentsWrapper'
    for (const { name } of actionDock.attributes) {
      if (name.startsWith('data-v-')) {
        notice.setAttribute(name, '')
        noticeAction.setAttribute(name, '')
      }
    }
    noticeAction.className = 'skippedSegment'
    noticeAction.textContent = 'SponsorBlock action'
    noticeAction.addEventListener('click', (event) => {
      event.stopPropagation()
      window.__sponsorBlockActionClicked = true
    })
    notice.append(noticeAction)

    annotations.className = 'videoAnnotations'
    Object.assign(annotations.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '2',
      pointerEvents: 'none',
    })
    endCard.className = 'annotation'
    endCard.textContent = 'End card'
    Object.assign(endCard.style, {
      position: 'absolute',
      inlineSize: '220px',
      blockSize: '180px',
      pointerEvents: 'auto',
    })
    annotations.append(endCard)
    player.append(notice, annotations)

    const playerBounds = player.getBoundingClientRect()
    const seekBounds = seekBar.getBoundingClientRect()
    endCard.style.left = 'calc(50% - 110px)'
    endCard.style.top = `${seekBounds.top - playerBounds.top - 90}px`
  })

  const player = page.locator('.ftVideoPlayer')
  const controls = player.locator('.shaka-controls-container')
  const bottomControls = controls.locator('.shaka-bottom-controls')
  const seekBar = controls.locator('.shaka-seek-bar-container')
  const actionDock = player.locator('.fullscreenActions')
  const notice = player.locator('.skippedSegmentsWrapper')
  const endCard = player.locator('.annotation')

  const alignEndCardWithSeekBar = () => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const seekBounds = element.querySelector('.shaka-seek-bar-container').getBoundingClientRect()
    element.querySelector('.annotation').style.top = `${seekBounds.top - playerBounds.top - 90}px`
  })
  await expect(controls).toHaveAttribute('shown', 'true')
  await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
  await expect(player).toHaveAttribute('data-player-controls-shown', 'true')

  const verticalGap = () => player.evaluate((element) => {
    const dockBounds = element.querySelector('.fullscreenActions').getBoundingClientRect()
    const noticeBounds = element.querySelector('.skippedSegmentsWrapper').getBoundingClientRect()
    return dockBounds.top - noticeBounds.bottom
  })
  // Allow DOMRect floating-point rounding at fractional UI scales.
  const minimumGap = 8 - 0.01
  const noticeBottom = () => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const noticeBounds = element.querySelector('.skippedSegmentsWrapper').getBoundingClientRect()
    return playerBounds.bottom - noticeBounds.bottom
  })
  const hitOwnership = () => player.evaluate((element) => {
    const seekBar = element.querySelector('.shaka-seek-bar-container')
    const endCard = element.querySelector('.annotation')
    const seekBounds = seekBar.getBoundingClientRect()
    const cardBounds = endCard.getBoundingClientRect()
    const seekHit = document.elementFromPoint(
      seekBounds.left + seekBounds.width / 2,
      seekBounds.top + seekBounds.height / 2
    )
    const cardHit = document.elementFromPoint(
      element.dir === 'rtl' ? cardBounds.right - 20 : cardBounds.left + 20,
      cardBounds.top + 20
    )

    return {
      cardOwnsClearArea: endCard.contains(cardHit),
      controlsOwnSeekBar: seekBar.contains(seekHit),
    }
  })

  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await expect(notice).toHaveCSS('bottom', '164px')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(minimumGap)
  await expect.poll(() => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const dockBounds = element.querySelector('.fullscreenActions').getBoundingClientRect()
    return playerBounds.bottom - dockBounds.bottom
  })).toBeCloseTo(106, 0)
  const raisedNoticeBottom = await noticeBottom()

  await expect(controls).toHaveCSS('z-index', 'auto')
  await expect(bottomControls).toHaveCSS('z-index', '3')
  const [seekBounds, cardBounds] = await Promise.all([
    seekBar.boundingBox(),
    endCard.boundingBox(),
  ])
  expect(seekBounds.y).toBeLessThan(cardBounds.y + cardBounds.height)
  expect(seekBounds.y + seekBounds.height).toBeGreaterThan(cardBounds.y)
  await expect.poll(async () => {
    const ownership = await hitOwnership()
    return {
      cardOwnsClearArea: ownership.cardOwnsClearArea,
      controlsOwnSeekBar: ownership.controlsOwnSeekBar,
    }
  }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: true })
  await notice.getByRole('button', { name: 'SponsorBlock action' }).click()
  await expect.poll(() => page.evaluate(() => window.__sponsorBlockActionClicked)).toBe(true)

  await seekBar.evaluate((element) => {
    window.__seekDragEvents = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      element.addEventListener(type, () => window.__seekDragEvents.push(type), {
        capture: true,
      })
    }
  })
  const dragBounds = await seekBar.boundingBox()
  await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 40, dragBounds.y + dragBounds.height / 2)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__seekDragEvents)).toEqual([
    'pointermove',
    'pointerdown',
    'pointermove',
    'pointerup',
  ])

  for (const { width, height, direction, zoom } of [
    { width: 480, height: 800, direction: 'ltr', zoom: 1 },
    { width: 1024, height: 768, direction: 'rtl', zoom: 1.25 },
  ]) {
    await page.evaluate((factor) => window.ftElectron.setZoomFactor(factor), zoom)
    await setWindowSize(app, page, { width, height })
    await player.evaluate((element, dir) => { element.dir = dir }, direction)
    await alignEndCardWithSeekBar()
    await expect.poll(verticalGap).toBeGreaterThanOrEqual(minimumGap)
    await expect.poll(async () => {
      const ownership = await hitOwnership()
      return {
        cardOwnsClearArea: ownership.cardOwnsClearArea,
        controlsOwnSeekBar: ownership.controlsOwnSeekBar,
      }
    }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: true })
  }

  const moreOptions = player.getByRole('button', { name: 'More settings' })
  const overflowMenu = player.locator('.shaka-overflow-menu')
  await openPlayerOptions(player)
  const zoomMenuButton = overflowMenu.getByRole('button', { name: 'Zoom' })
  await expect(controls).toHaveCSS('z-index', '9')
  await endCard.evaluate((element) => {
    const playerBounds = element.closest('.ftVideoPlayer').getBoundingClientRect()
    const menuButtonBounds = document.querySelector('.shaka-overflow-menu .video-zoom-button')
      .getBoundingClientRect()
    element.style.left = `${menuButtonBounds.left - playerBounds.left}px`
    element.style.top = `${menuButtonBounds.top - playerBounds.top}px`
  })
  await expect.poll(async () => zoomMenuButton.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    ))
  })).toBe(true)
  await zoomMenuButton.click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'true')
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect(actionDock).toHaveCSS('pointer-events', 'none')
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await player.locator('.video-zoom-menu .shaka-back-to-overflow-button').click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'false')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(minimumGap)
  await moreOptions.click()
  await expect(overflowMenu).toBeHidden()
  await alignEndCardWithSeekBar()

  await player.locator('video').evaluate(element => element.pause())
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', false)
    component.proxy.$refs.player.$.setupState.pausedInterfaceRevealed = false
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveClass(/playerPaused/)
  await expect(player).toHaveAttribute('data-player-controls-shown', 'false')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await expect.poll(async () => {
    const ownership = await hitOwnership()
    return {
      cardOwnsClearArea: ownership.cardOwnsClearArea,
      controlsOwnSeekBar: ownership.controlsOwnSeekBar,
    }
  }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: false })
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', true)
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveAttribute('data-player-controls-shown', 'true')
  await player.locator('video').evaluate(element => element.play())
  await expect(player).not.toHaveClass(/playerPaused/)

  await controls.evaluate(element => {
    window.__keepTestControlsShown.disconnect()
    element.removeAttribute('shown')
  })
  await expect(player).toHaveAttribute('data-action-dock-visible', 'false')
  await expect(player).toHaveAttribute('data-player-controls-shown', 'false')
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await endCard.evaluate(element => { element.style.top = '100px' })
  await endCard.click({ trial: true })

  const dockFocusAction = actionDock.locator('.fullscreenShareAction > .iconButton')
  await expect(dockFocusAction).toHaveCount(1)
  await dockFocusAction.focus()
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(minimumGap)
  await dockFocusAction.evaluate(element => element.blur())
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await watchComponent.evaluate(async (component) => {
    component.proxy.$refs.player.$.setupState.fullWindowEnabled = false
    await component.proxy.$nextTick()
  })
  await expect(player).not.toHaveClass(/fullWindow/)
  await expect(notice).toHaveCSS('bottom', /.+/)
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await page.locator('.app').evaluate(element => element.classList.remove('capacitorTabs'))
  await watchComponent.evaluate(async (component) => {
    component.proxy.$refs.player.$.setupState.fullWindowEnabled = true
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveClass(/fullWindow/)
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await expect(controls).toHaveCSS('z-index', '1')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await openPlayerOptions(player)
  await overflowMenu.getByRole('button', { name: 'Zoom' }).click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'true')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await player.locator('.video-zoom-menu .shaka-back-to-overflow-button').click()
  await moreOptions.click()
  await endCard.click({ trial: true })
  await watchComponent.dispose()
})

test('isolates the owning video surface while Android Picture-in-Picture is active', { tag: '@scale' }, async ({ page }) => {
  await goTo(page, 'home')
  const source = { x: 18.5, y: 24.25, width: 480.5, height: 270.25 }
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveAttribute('data-system-theme', 'light')
  await page.evaluate(bounds => {
    document.querySelector('.app').classList.add('capacitorTabs')
    // Native PiP crops the live viewport around the saved source geometry.
    // Supply the same bounds that Android entry normally records.
    for (const [name, value] of Object.entries({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })) {
      document.documentElement.style.setProperty(`--android-pip-source-${name}`, `${value}px`)
    }
    for (const target of [false, true]) {
      const player = document.createElement('div')
      player.className = 'ftVideoPlayer shaka-video-container'
      if (target) player.setAttribute('data-android-picture-in-picture-target', '')
      const video = document.createElement('video')
      video.className = 'player'
      player.append(video)
      const canvas = document.createElement('canvas')
      canvas.className = 'vrCanvas'
      player.append(canvas)
      document.querySelector('.app > .routerView').append(player)
    }
    document.body.classList.add('androidPictureInPicture')
  }, source)

  await expect(page.locator('.topNav')).toHaveCSS('visibility', 'hidden')
  await expect(page.locator('.app > .routerView')).toHaveCSS('container-type', 'normal')
  await expect(page.locator('.ftVideoPlayer').first()).toHaveCSS('visibility', 'hidden')
  const target = page.locator('[data-android-picture-in-picture-target]')
  await expect(target).toHaveCSS('visibility', 'visible')
  await expect(target.locator('> .player')).toHaveCSS('visibility', 'visible')
  await expect(target.locator('> .player')).toHaveCSS('transition-property', 'none')
  await expect(target.locator('> .vrCanvas')).toHaveCSS('transition-property', 'none')
  const expectSourceBounds = async () => {
    await expect.poll(() => target.evaluate((element, bounds) => {
      return [element, element.querySelector(':scope > .player'), element.querySelector(':scope > .vrCanvas')]
        .every(surface => {
          const rect = surface.getBoundingClientRect()
          return ['x', 'y', 'width', 'height'].every(dimension => Math.abs(rect[dimension] - bounds[dimension]) <= 1)
        })
    }, source)).toBe(true)
  }
  await expectSourceBounds()

  // Vue replaces the class attribute when the player changes into its
  // cross-tab mini-player layout. PiP ownership must survive that update.
  await target.evaluate(element => {
    element.className = 'ftVideoPlayer shaka-video-container scrollMiniPlayer'
  })
  await expect(target).toHaveAttribute('data-android-picture-in-picture-target', '')
  await expect(target.locator('> .player')).toHaveCSS('visibility', 'visible')
  await expectSourceBounds()

  // Entering Android PiP can change the reported system color scheme. Theme
  // updates must not discard the transient class that isolates the video.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveAttribute('data-system-theme', 'dark')
  await expect(page.locator('body')).toHaveClass(/androidPictureInPicture/)
  await expect(target).toHaveCSS('visibility', 'visible')
  await expectSourceBounds()
})

test('a save channel setting dropdown clears the fullscreen dock content', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readScopedStyles(
    path.join(repoRoot, 'src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue')
  )
  // The dropdown's own placement lives in FtIconButton's stylesheet, and it is
  // what puts the fly-out over the dock edge in the first place.
  const { compile } = await import('sass')
  const buttonStyles = compile(
    path.join(repoRoot, 'src/renderer/components/FtIconButton/FtIconButton.scss')
  ).css
  await page.addStyleTag({
    content: [playerStyles, buttonStyles]
      .join('\n')
      .replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })

  // The dock stacks the video info card and the description as siblings and
  // clips whatever leaves its box. The button the dropdown hangs off sits at
  // the dock's start edge, and the dropdown drops over the description below.
  await page.evaluate(() => {
    const dock = document.createElement('div')
    const info = document.createElement('div')
    const buttons = document.createElement('div')
    const options = document.createElement('div')
    const iconButton = document.createElement('div')
    const dropdown = document.createElement('div')
    const description = document.createElement('div')

    dock.className = 'fullscreenMetadataTarget'
    dock.style.cssText = 'position:fixed;inset:100px auto auto 400px;width:420px;height:420px;z-index:10000;background:#222'
    info.className = 'watchVideo watchVideoInfo'
    buttons.className = 'videoButtons'
    options.className = 'videoOptions'
    iconButton.className = 'iconButton'
    iconButton.style.cssText = 'position:relative;inline-size:30px;block-size:30px'
    dropdown.className = 'iconDropdown left bottom'
    dropdown.textContent = 'Save video quality'
    dropdown.style.inlineSize = '220px'
    dropdown.style.blockSize = '120px'
    description.className = 'watchVideo videoDescription'
    description.textContent = 'Description text that follows the info card'
    description.style.cssText = 'block-size:200px;background:#111'

    iconButton.append(dropdown)
    options.append(iconButton)
    buttons.append(options)
    info.append(buttons)
    dock.append(info, description)
    document.body.append(dock)
  })

  const dropdown = page.locator('.fullscreenMetadataTarget .iconDropdown')
  await expect(dropdown).toBeVisible()

  await expect.poll(() => dropdown.evaluate((element) => {
    const dock = element.closest('.fullscreenMetadataTarget')
    const bounds = element.getBoundingClientRect()
    const dockBounds = dock.getBoundingClientRect()
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.bottom - 8
    )
    return {
      // Not cut off by the dock, which clips its inline axis
      insideDock: bounds.left >= dockBounds.left && bounds.right <= dockBounds.right,
      // Not painted over by the description card that follows
      onTop: hit === element || element.contains(hit)
    }
  })).toEqual({ insideDock: true, onTop: true })
})

test('mobile tab selection uses checkboxes and cancels without activating', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(async () => {
    const store = window.$store
    for (let index = 0; index < 5; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const cards = page.locator('.capacitorPhoneTabRow')
  const target = cards.first().locator('.capacitorPhoneTabTarget')
  const bounds = await target.boundingBox()
  await page.mouse.move(bounds.x + 24, bounds.y + 24)
  await page.mouse.down()
  await expect(page.locator('.capacitorTabActions')).toBeVisible()
  await page.mouse.up()
  await page.getByRole('menuitem', { name: 'Close Tabs', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Close Tabs Before', exact: true })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Close Tabs After', exact: true })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Close Other Tabs', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Back', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Select Tab', exact: true }).click()
  await expect(cards.first().getByRole('checkbox')).toBeChecked()
  await expect(target).toBeFocused()
  await expect(cards.getByRole('checkbox')).toHaveCount(6)
  await expect(page.locator('.capacitorPhoneTabFab')).toBeHidden()
  await cards.nth(1).getByRole('checkbox').check()
  await expect(page.getByRole('button', { name: 'Close 2 Tabs', exact: true })).toBeVisible()
  await cards.nth(2).locator('.capacitorPhoneTabTarget').click()
  await expect(cards.nth(2).getByRole('checkbox')).toBeChecked()
  await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close 3 Tabs', exact: true })).toBeVisible()
  const panel = page.locator('#capacitor-phone-open-tabs-panel')
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(cards.getByRole('checkbox')).toHaveCount(0)
  await expect(page.locator('.capacitorPhoneTabFab')).toBeVisible()
  // The cancel button disappears, so focus must stay in the dialog for keyboard use.
  await expect(page.locator('.capacitorPhoneTabTarget[aria-selected="true"]')).toBeFocused()
  await expect.poll(async () => {
    const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
    return state.scrollTop <= state.maximum + 1
  }).toBe(true)
  await setWindowSize(app, page, { width: 760, height: 375 })
  await cards.first().locator('.capacitorPhoneTabTarget').click({ button: 'right' })
  const menuScroll = page.locator('.capacitorTabActionList')
  await menuScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => menuScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.getByRole('menuitem', { name: 'Close Tabs', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Select Tab', exact: true })).toHaveCount(0)
  await expect.poll(() => menuScroll.evaluate(element => ({
    offset: element.scrollTop,
    unusable: element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable'),
  }))).toEqual({ offset: 0, unusable: true })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Close Tabs', exact: true })).toBeFocused()
  await expect.poll(() => menuScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.getByRole('menuitem', { name: 'Select Tab', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(cards.first().getByRole('checkbox')).toBeChecked()
})

test('mobile close submenu keeps Back focused when every action is disabled', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await page.locator('.capacitorPhoneTabTarget').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close Tabs', exact: true }).click()
  await expect(page.locator('.capacitorTabActionList button:disabled')).toHaveCount(3)
  await expect(page.getByRole('menuitem', { name: 'Back', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Close Tabs', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.capacitorTabActions')).toBeHidden()
  await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()
})
