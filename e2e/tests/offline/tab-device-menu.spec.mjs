import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')
const recipient = Buffer.alloc(16, 3).toString('base64url')
const videoId = 'jNQXAC9IVRw'

for (const layout of ['desktop', 'phone']) {
  test(`opens video tabs on another device from the ${layout} context menu`, async ({ app, page, attachScreenshot }) => {
    const sent = []
    await page.route('https://tab-sync.example/**', route => {
      if (route.request().method() === 'POST') sent.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    })
    if (layout === 'phone') await setWindowSize(app, page, { width: 375, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(async ({ key, salt, recipient, videoId, layout }) => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      store.commit('setSyncServerEnabled', true)
      store.commit('setSyncServerAutoSync', false)
      store.commit('setSyncServerUrl', 'https://tab-sync.example')
      store.commit('setSyncServerToken', 'test-token')
      store.commit('setSyncServerPrivacyKey', key)
      store.commit('setSyncServerPrivacySalt', salt)
      store.commit('setSyncServerLiveSupported', true)
      store.commit('setSyncServerDevices', { [recipient]: { name: 'Laptop', platform: 'linux' } })
      await store.dispatch('createTab', { route: `/watch/${videoId}`, title: 'Send this tab', makeActive: false, lazyLoad: true })
      if (layout === 'phone') {
        const visit = vnode => {
          if (!vnode || typeof vnode !== 'object') return
          if (vnode.component) {
            if (vnode.component.type?.__name === 'CapacitorPhoneTabSwitcher') vnode.component.props.enabled = true
            visit(vnode.component.subTree)
          }
          if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
        }
        visit(document.querySelector('#app')._vnode)
      }
    }, { key, salt, recipient, videoId, layout })
    if (layout === 'phone') await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const target = page.locator(layout === 'phone' ? '.capacitorPhoneTabTarget' : '.tab[data-tab-id]').filter({ hasText: 'Send this tab' })
    await target.click({ button: 'right' })
    const menu = page.locator(layout === 'phone' ? '.capacitorTabActions' : '.contextMenu')
    const openOnDevice = menu.getByRole('menuitem', { name: 'Open on another device', exact: true })
    await openOnDevice.click()
    const laptop = menu.getByRole('menuitem', { name: 'Laptop', exact: true })
    await expect(laptop.locator('[data-icon="display"]')).toBeVisible()
    await attachScreenshot(`${layout} tab device picker`)
    if (layout === 'phone') {
      await page.evaluate(recipient => {
        const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
        const devices = { [recipient]: { name: 'Laptop', platform: 'linux' } }
        for (let i = 0; i < 20; i++) devices[`extra-${i}`] = { name: `Device ${i}`, platform: 'android' }
        store.commit('setSyncServerDevices', devices)
      }, recipient)
      const list = menu.locator('.capacitorTabActionList')
      await list.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await page.evaluate(recipient => {
        document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
          .commit('setSyncServerDevices', { [recipient]: { name: 'Laptop', platform: 'linux' } })
      }, recipient)
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
      await expect(list.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await page.keyboard.press('Escape')
      await expect(openOnDevice).toBeFocused()
      await openOnDevice.click()
      await page.evaluate(() => {
        document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
          .commit('setSyncServerDevices', {})
      })
      await menu.getByRole('menuitem', { name: 'Back', exact: true }).click()
      await expect(openOnDevice).toBeDisabled()
      await expect(menu.getByRole('menuitem', { name: 'Select Tab', exact: true })).toBeFocused()
      await page.evaluate(recipient => {
        document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
          .commit('setSyncServerDevices', { [recipient]: { name: 'Laptop', platform: 'linux' } })
      }, recipient)
      await openOnDevice.click()
    }
    await laptop.click()
    await expect(menu).toBeHidden()
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0].recipient).toBe(recipient)
    const request = await decryptSyncDocument(sent[0].payload, key)
    expect(request.videoId).toBe(videoId)
    expect(request.title).toBe('Send this tab')
    await expect(page.getByText(/^Video sent\./)).toBeVisible()
    const original = page.locator(layout === 'phone' ? '.capacitorPhoneTabTarget' : '.tab[data-tab-id]').first()
    await original.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Open on another device', exact: true })).toHaveCount(0)
  })
}
