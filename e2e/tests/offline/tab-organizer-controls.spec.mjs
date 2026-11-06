import { test, expect, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

test.describe('recently closed card', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', fetchSubscriptionsAutomatically: false } } })

  for (const iconPack of ['material', 'remix']) {
    test(`matches tab row styling and device spacing with ${iconPack} icons`, async ({ app, page, uiScale }) => {
      await page.evaluate(async pack => {
        const store = window.$store
        await store.dispatch('updateIconPack', pack)
        store.commit('setSyncServerEnabled', true)
        store.commit('setSyncServerToken', 'e2e-token')
        store.commit('setSyncServerPrivacyMode', 'enhanced')
        store.commit('setSyncServerSyncSessions', true)
        store.commit('setSyncServerSharedTabs', false)
        store.commit('setSyncServerOtherDeviceSessions', [{
          syncDeviceId: 'phone-e2e',
          syncPlatform: 'mobile',
          sessionId: 'phone-session',
          tabs: [
            { id: 'phone-tab', title: 'Subscriptions', url: '/subscriptions' },
            { id: 'phone-playlists', title: 'Playlists', url: '/userplaylists' },
          ],
        }])
        for (const title of ['Music', 'Travel', 'Science']) {
          const tab = await window.ftElectron.tabs.create({ route: '/subscriptions', title, makeActive: false, lazyLoad: true })
          await window.ftElectron.tabs.close(tab.id)
        }
        await window.ftElectron.tabs.create({ route: '/userplaylists', title: 'Open research', makeActive: false, lazyLoad: true })
      }, iconPack)
      await page.locator('.tabOrganizerButton').click()
      const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
      const recent = organizer.locator('.recentlyClosed')
      const heading = recent.getByRole('heading', { name: 'Recently Closed', exact: true })
      const clear = recent.getByRole('button', { name: 'Clear', exact: true })
      const rows = recent.locator('.closedTabRow')
      const scroller = organizer.locator('.tabOrganizerScroll')
      const deviceHeader = organizer.locator('.syncedTabsHeader')
      await expect(deviceHeader.getByRole('heading', { name: 'Tabs from other devices' })).toBeVisible()
      await expect(deviceHeader.getByRole('tablist')).toBeVisible()
      await expect(deviceHeader.getByRole('button', { name: 'Open all tabs', exact: true })).toBeVisible()
      await expect(organizer.getByRole('tabpanel').getByRole('heading')).toHaveCount(0)

      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        for (const width of [1600, 375]) {
          await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
          await app.electronApp.evaluate(({ BrowserWindow }, width) => {
            BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 })
          }, Math.round(width * uiScale / 100))
          await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - width)).toBeLessThanOrEqual(1)
          if (width === 1600) {
            await expect.poll(() => deviceHeader.evaluate(header => {
              const centers = [...header.children].map(child => {
                const bounds = child.getBoundingClientRect()
                return bounds.top + bounds.height / 2
              })
              return Math.max(...centers) - Math.min(...centers)
            })).toBeLessThanOrEqual(1)
          }
          await page.mouse.move(0, 0)
          await expect.poll(() => organizer.evaluate(element => {
            const recent = element.querySelector('.recentlyClosed')
            const device = element.querySelector('.syncedTabsSection')
            const metrics = (card, button, rows) => {
              const style = getComputedStyle(card)
              const bounds = card.getBoundingClientRect()
              const action = card.querySelector(button).getBoundingClientRect()
              const header = card.querySelector('header').getBoundingClientRect()
              const row = card.querySelector(rows)
              return {
                background: style.backgroundColor,
                radius: style.borderRadius,
                padding: style.padding,
                buttonInset: Math.round(bounds.right - action.right),
                listGap: Math.round(row.getBoundingClientRect().top - header.bottom),
                rowBackground: getComputedStyle(row).backgroundColor,
              }
            }
            return {
              recent: metrics(recent, '.dangerButton', 'li'),
              device: metrics(device, '.syncedSessionActions', 'li'),
            }
          }).then(({ recent, device }) => Object.fromEntries(Object.entries(recent)
            .filter(([key, value]) => value !== device[key])))).toEqual({})
          await expect.poll(() => organizer.evaluate(element => {
            const topRow = element.querySelector('.tabGroup .tabOrganizerRow')
            const rowStyle = row => {
              const style = getComputedStyle(row)
              return {
                background: style.backgroundColor,
                corners: style.borderRadius,
                height: Math.round(row.getBoundingClientRect().height),
              }
            }
            return {
              sectionSurfacesVisible: ['.recentlyClosed', '.syncedTabsSection'].every(selector => {
                const background = getComputedStyle(element.querySelector(selector)).backgroundColor
                return background !== 'rgba(0, 0, 0, 0)' && background !== getComputedStyle(element).backgroundColor && background !== getComputedStyle(topRow).backgroundColor
              }),
              rowsMatch: ['.closedTabRow', '.syncedTabList > li'].every(selector => JSON.stringify(rowStyle(element.querySelector(selector))) === JSON.stringify(rowStyle(topRow))),
            }
          })).toEqual({ sectionSurfacesVisible: true, rowsMatch: true })
          await expect(heading.locator('[data-icon="clock-rotate-left"] svg')).toBeVisible()
          await expect(heading.locator('[data-icon]')).toHaveAttribute('data-icon-pack', iconPack)
          await expect(heading.locator('[data-icon]')).toHaveAttribute('aria-hidden', 'true')
          await clear.scrollIntoViewIfNeeded()
          await expect(clear).toBeInViewport()
          await expect.poll(() => organizer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
          await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
          await expectScrollAtRenderedEnd(scroller)
        }
      }

      await rows.first().getByRole('button', { name: 'Restore', exact: true }).click()
      await expect(rows).toHaveCount(2)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await clear.click()
      await expect(rows).toHaveCount(0)
      await expect(clear).toBeDisabled()
      await expect(recent.getByText('No recently closed tabs match this search.')).toBeVisible()
      await expectScrollAtRenderedEnd(scroller)
    })
  }
})

async function failNextTabRequest(app, channel) {
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    const original = ipcMain._invokeHandlers.get(channel)
    let shouldFail = true
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('Group request failed for regression test')
      }
      return original(...args)
    })
  }, channel)
}

test.describe('group creation failures', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false } } })

  test('retries tab assignment without creating a duplicate group', async ({ app, page }) => {
    await page.locator('.tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    await organizer.getByRole('button', { name: 'Select All', exact: true }).click()
    await failNextTabRequest(app, 'tabs-set-group')
    await organizer.getByRole('button', { name: 'Create Group', exact: true }).click()
    const prompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
    const name = prompt.getByRole('textbox', { name: 'Group name', exact: true })
    const submit = prompt.getByRole('button', { name: 'Create Group', exact: true })
    await name.fill('Research')
    await submit.click()
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.groups.length))).toBe(1)
    await expect(submit).toBeEnabled()
    await expect(name).toHaveValue('Research')
    const groupId = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.groups[0].id))
    await submit.click()
    await expect(prompt).toHaveCount(0)
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    expect(state.groups).toHaveLength(1)
    expect(state.tabs.every(tab => tab.groupId === groupId)).toBe(true)
    await expect(page.getByText(/Group request failed for regression test/)).toBeVisible()
  })

  test('shows creation errors and lets the user retry', async ({ app, page }) => {
    await page.locator('.tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    await failNextTabRequest(app, 'tabs-create-group')
    await organizer.getByRole('button', { name: 'Create Group', exact: true }).click()
    const prompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
    await prompt.getByRole('textbox', { name: 'Group name', exact: true }).fill('Research')
    const submit = prompt.getByRole('button', { name: 'Create Group', exact: true })
    await submit.click()
    await expect(page.getByText(/Group request failed for regression test/)).toBeVisible()
    await expect(submit).toBeEnabled()
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.groups.length))).toBe(0)
    await submit.click()
    await expect(prompt).toHaveCount(0)
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.groups.length))).toBe(1)
  })

  test('clears the retained group when the prompt closes or succeeds', async ({ app, page }) => {
    await page.locator('.tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    await organizer.getByRole('button', { name: 'Select All', exact: true }).click()
    await failNextTabRequest(app, 'tabs-set-group')
    const create = organizer.getByRole('button', { name: 'Create Group', exact: true })
    const prompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
    const name = prompt.getByRole('textbox', { name: 'Group name', exact: true })
    const submit = prompt.getByRole('button', { name: 'Create Group', exact: true })
    await create.click()
    await name.fill('Research')
    await submit.click()
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.groups.length))).toBe(1)
    await expect(submit).toBeEnabled()
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    for (const count of [2, 3]) {
      await create.click()
      await expect(name).toHaveValue('')
      await name.fill('Research')
      await submit.click()
      await expect(prompt).toHaveCount(0)
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      expect(state.groups).toHaveLength(count)
      expect(state.tabs.every(tab => tab.groupId === state.groups.at(-1).id)).toBe(true)
    }
  })
})

test.describe('organizer controls', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'dark', fetchSubscriptionsAutomatically: false } } })

  test('shares one desktop row, wraps without overflow, and creates groups in a focused dialog', async ({ app, page, uiScale }, testInfo) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height: 1080 }))
    await page.evaluate(async () => {
      for (let index = 0; index < 30; index++) {
        await window.ftElectron.tabs.create({ route: { path: '/subscriptions' }, title: `Organizer tab ${index}`, activate: false, lazyLoad: true })
      }
    })
    await page.locator('.tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    const controls = organizer.locator('.tabOrganizerControls')
    await expect.poll(() => controls.evaluate(element => {
      const controls = [...element.querySelectorAll(':scope > button, :scope > span, :scope > .select .select-text, :scope > .tabOrganizerSearch input')]
      const bottoms = controls.map(control => control.getBoundingClientRect().bottom)
      return Math.max(...bottoms) - Math.min(...bottoms)
    })).toBeLessThanOrEqual(1)
    await organizer.screenshot({ path: testInfo.outputPath('organizer-desktop.png') })
    const scroller = organizer.locator('.tabOrganizerScroll')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectScrollAtRenderedEnd(scroller)
    const scrollTop = await scroller.evaluate(element => element.scrollTop)
    const create = organizer.getByRole('button', { name: 'Create Group', exact: true })
    await create.click()
    const prompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
    const name = prompt.getByRole('textbox', { name: 'Group name', exact: true })
    await expect(name).toBeFocused()
    await expect(prompt.getByRole('button', { name: 'Create Group', exact: true })).toBeDisabled()
    await name.fill('   ')
    await name.press('Enter')
    await expect(prompt).toBeVisible()
    await name.press('Shift+Tab')
    await expect(prompt.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(name).toBeFocused()
    await name.press('Escape')
    await expect(prompt).toHaveCount(0)
    await expect(organizer).toBeVisible()
    await expect(create).toBeFocused()
    expect(await scroller.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)

    await organizer.getByRole('button', { name: 'Select All', exact: true }).click()
    await create.click()
    await expect(name).toHaveValue('')
    await name.fill('  Research  ')
    await prompt.screenshot({ path: testInfo.outputPath('create-group.png') })
    await name.press('Enter')
    await expect(prompt).toHaveCount(0)
    await expect(organizer.locator('.tabGroup').filter({ has: page.getByRole('button', { name: 'Rename Research', exact: true }) }).locator('.tabOrganizerRow')).toHaveCount(31)
    await expect(create).toBeFocused()

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 375, height: 800 }))
    await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - 375 * 100 / uiScale)).toBeLessThanOrEqual(1)
    await expect.poll(() => organizer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectScrollAtRenderedEnd(scroller)
    await organizer.screenshot({ path: testInfo.outputPath('organizer-narrow.png') })
    await create.click()
    await expect(name).toBeFocused()
    await expect.poll(() => prompt.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(create).toBeFocused()

    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    for (const height of [800, 1080]) {
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      const previousRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
      await app.electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height }), height)
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(previousRange)
      await expectScrollAtRenderedEnd(scroller)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    }
  })
})
