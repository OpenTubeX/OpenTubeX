import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { compileScript, parse } from 'vue/compiler-sfc'

// Mount the real sheet in the same render as its .app target, as happens when
// Android restores a Watch tab. Only native services and scroll helpers are stubbed.
test('restored phone panels mount their contents before they are opened', async ({ page }) => {
  const file = new URL('../../../src/renderer/components/FtMobileSheet/FtMobileSheet.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const compiled = compileScript(descriptor, { id: 'mobile-sheet-startup', inlineTemplate: true }).content
    .replace(/^import .* from ['"](?!vue['"])[^'"]+['"];?\n/gm, '')
    .replaceAll('from "vue"', 'from "/vue.js"')
    .replaceAll("from 'vue'", 'from "/vue.js"')
    .replaceAll('process.env.IS_CAPACITOR', 'false')
    .replaceAll('process.env.IS_IOS', 'false')
  const services = `
    const FtIcon = { render: () => null }
    const usePhoneLayout = () => ref(false)
    const isAppHidden = () => false
    const applyAnimationSpeed = animation => animation
    const isReducedMotionEnabled = () => true
    const lockBodyScroll = () => {}
    const unlockBodyScroll = () => {}
    const updateMobileSheetRootClass = () => {}
  `
  const vue = await readFile(new URL('../../../node_modules/vue/dist/vue.esm-browser.js', import.meta.url), 'utf8')
  await page.route('http://sheet.test/**', route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/vue.js') return route.fulfill({ contentType: 'text/javascript', body: vue })
    if (pathname === '/sheet.js') return route.fulfill({ contentType: 'text/javascript', body: services + compiled })
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
  })
  await page.goto('http://sheet.test')
  await page.evaluate(async () => {
    const { createApp, h, nextTick, provide, ref } = await import('./vue.js')
    const { default: Sheet } = await import('./sheet.js')
    const open = ref(false)
    window.sheetMounts = 0
    window.sheetErrors = []
    const Content = {
      setup() { window.sheetMounts++; return () => h('p', 'Loaded comments') }
    }
    const app = createApp({
      setup() {
        provide('phonePanelPlayer', () => document.querySelector('.player'))
        return () => h('div', { class: 'app' }, [
          h('div', { class: 'player' }),
          h(Sheet, { title: 'Comments', belowPlayer: true, open: open.value }, () => h(Content))
        ])
      }
    })
    app.config.globalProperties.$t = key => key
    app.config.errorHandler = error => window.sheetErrors.push(String(error))
    app.mount('#root')
    await nextTick()
    window.openSheet = async () => { open.value = true; await nextTick() }
  })
  expect(await page.evaluate(() => window.sheetMounts)).toBe(1)
  await page.evaluate(() => window.openSheet())
  await expect(page.getByRole('dialog', { name: 'Comments', exact: true })).toBeVisible()
  await expect(page.getByText('Loaded comments')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.sheetMounts)).toBe(1)
  expect(await page.evaluate(() => window.sheetErrors)).toEqual([])
})
