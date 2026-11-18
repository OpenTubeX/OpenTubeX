import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { test, expect } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'

/**
 * Hold a real settings write with a competing SQLite transaction in the
 * isolated profile. The app's write waits for the lock, within SQLite's busy
 * timeout, and a later read queues behind it.
 */
async function holdSettingsWrite(app, page) {
  await page.evaluate(action => window.ftElectron.dbSettings(action), DBActions.GENERAL.FIND)
  const db = new DatabaseSync(path.join(app.userDataDir, 'settings.sqlite'))
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('BEGIN EXCLUSIVE')

  await page.evaluate(action => {
    window.__contextMenuSettingsWrite = window.ftElectron.dbSettings(action, {
      _id: 'contextMenuPerformanceProbe', value: true,
    })
  }, DBActions.GENERAL.UPSERT)
  const queuedRead = page.evaluate(action => window.ftElectron.dbSettings(action), DBActions.GENERAL.FIND)

  const release = async () => {
    db.exec('ROLLBACK')
    db.close()
    await page.evaluate(() => window.__contextMenuSettingsWrite)
    const settings = await queuedRead
    expect(settings.some(setting => setting._id === 'contextMenuPerformanceProbe' && setting.value === true),
      'the delayed write still succeeds').toBe(true)
  }

  try {
    const blocked = await Promise.race([
      queuedRead.then(() => false),
      new Promise(resolve => setTimeout(() => resolve(true), 50)),
    ])
    expect(blocked, 'the settings datastore must actually be busy').toBe(true)
  } catch (error) {
    await release()
    throw error
  }
  return release
}

test('selected-text context menu opens while unrelated settings writes wait for storage', async ({ app, page }) => {
  await page.evaluate(() => window.ftElectron.contextMenu.open({ selectionText: 'warm up' }))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const point = await page.evaluate(() => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'selected text under load'
    paragraph.style.cssText = 'position:fixed;top:120px;left:40px;width:300px;z-index:19000;background:#000'
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const bounds = paragraph.getBoundingClientRect()
    return { x: bounds.left + 10, y: bounds.top + 5 }
  })

  const release = await holdSettingsWrite(app, page)
  try {
    await page.mouse.click(point.x, point.y, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context Menu' })
    // The write stays blocked until release(), so the menu must not wait for it.
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'Search "selected text under load" in a New Tab', exact: true })).toBeVisible()
  } finally {
    await release()
    await cdp.detach()
  }
})
