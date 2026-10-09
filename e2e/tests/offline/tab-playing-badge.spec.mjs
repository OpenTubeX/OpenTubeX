import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'

for (const iconPack of ['material', 'remix']) {
  test.describe(iconPack, () => {
    test.use({
      seed: {
        settings: {
          iconPack,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue'
        }
      }
    })

    test('keeps tab identities visible with corner playback badges', async ({ page }, testInfo) => {
      const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
      const ids = await page.evaluate(async avatarDataUrl => {
        const tabs = []
        for (const [index, title] of ['Night drive mix', 'Live concert'].entries()) {
          const tab = await window.ftElectron.tabs.create({
            route: `/watch/badge${index}aaaaa`,
            title,
            makeActive: false,
            lazyLoad: true,
            ...(index === 0 ? { avatarDataUrl } : {})
          })
          tabs.push(tab.id)
        }
        return tabs
      }, `data:image/png;base64,${avatar.toString('base64')}`)
      const tabs = ids.map(id => page.locator(`.tabBar .tab[data-tab-id="${id}"]`))
      const identities = [tabs[0].locator('img.tabAvatar'), tabs[1].locator('.tabPageIcon')]
      for (const identity of identities) await expect(identity).toBeVisible()
      const initialTitleBounds = await Promise.all(tabs.map(tab => tab.locator('.tabTitleText').boundingBox()))

      await page.evaluate(ids => ids.forEach(id => window.ftElectron.tabs.setPlaybackState('playing', id)), ids)
      for (const [index, tab] of tabs.entries()) {
        await expect(tab.locator('.playingBadge')).toBeVisible()
        await expect(identities[index]).toBeVisible()
        expect(await tab.locator('.tabTitleText').boundingBox()).toEqual(initialTitleBounds[index])
      }

      await page.evaluate(id => window.ftElectron.tabs.setPinned(id, true), ids[0])
      await expect(tabs[0]).toHaveClass(/pinned/)
      await page.evaluate(async id => {
        const group = await window.ftElectron.tabs.createGroup({ name: 'Music', color: 'blue' })
        await window.ftElectron.tabs.setGroup([id], group.id)
      }, ids[0])
      await expect(tabs[0].locator('.groupBadge')).toBeVisible()
      for (const scale of [100, 125]) {
        for (const position of ['top', 'bottom', 'left', 'right']) {
          await page.evaluate(async ({ scale, position }) => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            await store.dispatch('updateUiScale', scale)
            await store.dispatch('updateTabBarPosition', position)
          }, { scale, position })
          await tabs[0].hover()
          await expect(tabs[0].locator('.closeButton')).toHaveCSS('opacity', '1')
          for (const [index, tab] of tabs.entries()) {
            await expect(identities[index]).toBeVisible()
            await expect.poll(() => tab.evaluate(element => {
              const bounds = element.getBoundingClientRect()
              const icon = element.querySelector('.tabIconContainer').getBoundingClientRect()
              const badge = element.querySelector('.playingBadge').getBoundingClientRect()
              const title = element.querySelector('.tabTitleText').getBoundingClientRect()
              const close = element.querySelector('.closeButton').getBoundingClientRect()
              const corner = element.classList.contains('pinned')
                ? badge.left < icon.left && badge.right > icon.left && badge.right < icon.right
                : badge.left > icon.left && badge.left < icon.right && badge.right > icon.right
              return corner &&
                badge.top > icon.top && badge.top < icon.bottom && badge.bottom > icon.bottom &&
                badge.left >= bounds.left && badge.right <= title.left && badge.bottom <= bounds.bottom &&
                badge.right <= close.left
            })).toBe(true)
          }
        }
      }

      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateTabBarPosition', 'top')
      })
      await tabs[1].hover()
      await page.mouse.move(700, 300)
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        await expect.poll(() => identities[0].evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
        const bar = await page.locator('.tabBar').boundingBox()
        const lastTab = await tabs[1].boundingBox()
        await page.screenshot({
          path: testInfo.outputPath(`playing-badges-${iconPack}-${theme}.png`),
          clip: { ...bar, width: lastTab.x + lastTab.width - bar.x + 10 }
        })
      }

      await page.evaluate(id => window.ftElectron.tabs.setLoading(true, id), ids[0])
      await expect(tabs[0].locator('.tabLoadingLine')).toBeVisible()
      await expect(tabs[0].locator('.playingBadge')).toBeVisible()
      await expect(identities[0]).toBeVisible()
      await page.evaluate(id => window.ftElectron.tabs.setLoading(false, id), ids[0])
      await expect(tabs[0].locator('.tabLoadingLine')).toHaveCount(0)
      await expect(tabs[0].locator('.playingBadge')).toBeVisible()
      await expect(identities[0]).toBeVisible()

      await page.evaluate(ids => ids.forEach(id => window.ftElectron.tabs.setPlaybackState('paused', id)), ids)
      for (const [index, tab] of tabs.entries()) {
        await expect(tab.locator('.playingIcon')).toHaveCount(0)
        await expect(identities[index]).toBeVisible()
      }
      await page.evaluate(async ids => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateShowTabIcons', false)
        ids.forEach(id => window.ftElectron.tabs.setPlaybackState('playing', id))
      }, ids)
      for (const tab of tabs) {
        await expect(tab.locator('.tabIconContainer')).toHaveCount(0)
        await expect(tab.locator('.playingIcon')).toBeVisible()
        await expect(tab.locator('.playingBadge')).toHaveCount(0)
      }
    })
  })
}
