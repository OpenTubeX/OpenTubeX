import { test, expect } from '../../helpers/app.mjs'

const EXTERNAL_URL = 'https://example.org/article'
const BACKGROUND = { url: EXTERNAL_URL, options: { activate: false } }
const FOREGROUND = { url: EXTERNAL_URL, options: null }

test.use({ seed: { settings: { externalLinkHandling: '' } } })

async function stubBrowser(app) {
  await app.electronApp.evaluate(({ shell }) => {
    globalThis.externalLinkCalls = []
    shell.openExternal = async (url, options) => {
      globalThis.externalLinkCalls.push({ url, options: options ?? null })
    }
  })
  return () => app.electronApp.evaluate(() => globalThis.externalLinkCalls)
}

async function addLink(page) {
  await page.locator('body').evaluate((body, href) => {
    body.insertAdjacentHTML('beforeend', `<a href="${href}">External article</a>`)
  }, EXTERNAL_URL)
  return page.getByRole('link', { name: 'External article' })
}

test('middle-clicking an external link opens it in the background', async ({ app, page }) => {
  const calls = await stubBrowser(app)
  const link = await addLink(page)

  await link.click({ button: 'middle' })
  await expect.poll(calls).toEqual([BACKGROUND])

  await link.click()
  await expect.poll(calls).toEqual([BACKGROUND, FOREGROUND])
})
