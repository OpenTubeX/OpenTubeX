import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

const handover = (await readFile(new URL('../../../src/datastores/libraryHandover.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')

test.beforeEach(async ({ context }) => {
  await context.route('http://localhost/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Library handover</title>'
  }))
})

// Opens the library like the web build: sqliteWorker.js holds the lock until
// the tab releases it by ending the worker.
async function libraryTab(context) {
  const page = await context.newPage()
  await page.addInitScript(`${handover}
// Checked on startup, like main.js
const inUseElsewhere = libraryInUseElsewhere()
window.openLibrary = async (workerStartup = 0) => {
  if (await inUseElsewhere) return 'in use elsewhere'
  await whenLibraryAvailable()
  const worker = new AbortController()
  let endWorker
  claimLibrary(async () => {
    worker.abort()
    endWorker?.()
  })
  await new Promise(resolve => setTimeout(resolve, workerStartup))
  navigator.locks.request('opentubex-library', { signal: worker.signal }, () => new Promise(resolve => {
    endWorker = resolve
    window.libraryOpen = true
  })).catch(() => {})
  return 'opened'
}
window.useLibraryHere = useLibraryHere
window.libraryState = async () =>
  window.libraryOpen === true ? 'open' : await inUseElsewhere ? 'in use elsewhere' : 'waiting'`)
  await page.goto('http://localhost/')
  return page
}

// A tab that hands the library over reloads, which ends running evaluations.
const state = page => page.evaluate(() => window.libraryState()).catch(() => 'reloading')

test('a new tab takes the library over, and the previous tab can take it back', async ({ context }) => {
  const first = await libraryTab(context)
  expect(await first.evaluate(() => window.openLibrary())).toBe('opened')
  await expect.poll(() => state(first)).toBe('open')

  const second = await libraryTab(context)
  // Its worker can ask for the library after the previous tab reloaded.
  const secondOpened = second.evaluate(() => window.openLibrary(1000))
  // The previous tab reloads without the library and doesn't claim it again.
  await expect.poll(() => state(first)).toBe('in use elsewhere')
  expect(await secondOpened).toBe('opened')
  await expect.poll(() => state(second)).toBe('open')
  expect(await first.evaluate(() => window.openLibrary())).toBe('in use elsewhere')

  await Promise.all([first.waitForEvent('load'), first.evaluate(() => window.useLibraryHere()).catch(() => {})])
  expect(await first.evaluate(() => window.openLibrary())).toBe('opened')
  await expect.poll(() => state(first)).toBe('open')
  await expect.poll(() => state(second)).toBe('in use elsewhere')

  // Once the other tab closed, a reload opens the library again.
  await first.close()
  await second.reload()
  expect(await second.evaluate(() => window.openLibrary())).toBe('opened')
  await expect.poll(() => state(second)).toBe('open')
})

test('tabs that open at the same time leave exactly one with the library', async ({ context }) => {
  const tabs = await Promise.all([libraryTab(context), libraryTab(context)])
  await Promise.all(tabs.map(tab => tab.evaluate(() => window.openLibrary()).catch(() => {})))
  await expect.poll(async () => (await Promise.all(tabs.map(state))).sort()).toEqual(['in use elsewhere', 'open'])
})
