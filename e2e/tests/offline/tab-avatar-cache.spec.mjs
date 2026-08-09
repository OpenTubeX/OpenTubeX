import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

import { test, expect } from '../../helpers/app.mjs'

// A 1x1 PNG, small enough to stay well inside the avatar download limit
const AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_AVATAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * The cached files added since `baseline`, with a digest of their contents so
 * the assertions do not depend on how the cache names its entries.
 * @param {string} userDataDir
 * @param {Set<string>} [baseline]
 * @returns {Promise<Array<{name: string, digest: string}>>}
 */
async function listCachedFiles(userDataDir, baseline = new Set()) {
  const directory = path.join(userDataDir, 'tab-previews')
  const names = await readdir(directory).catch(() => [])
  const files = await Promise.all(names
    .filter(name => !baseline.has(name))
    .map(async name => ({
      name,
      digest: createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex')
    })))
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} channelId
 * @param {string} avatarBase64
 */
async function createChannelTabWithAvatar(page, channelId, avatarBase64) {
  return await page.evaluate(async ({ channelId, avatarBase64 }) => {
    const route = `/channel/${channelId}`
    const tab = await window.ftElectron.tabs.create({ route, makeActive: false, lazyLoad: true })
    const bytes = Uint8Array.from(atob(avatarBase64), character => character.charCodeAt(0))
    const applied = await window.ftElectron.tabs.updateAvatar(bytes.buffer, tab.id, route)
    return { id: tab.id, applied }
  }, { channelId, avatarBase64 })
}

test('tabs of the same channel share one cached avatar file', async ({ app, page }) => {
  // Previews of the tab that is already open are not part of this
  const baseline = new Set((await listCachedFiles(app.userDataDir)).map(file => file.name))

  const first = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  const second = await createChannelTabWithAvatar(page, 'UCtestchannel', AVATAR_PNG)
  expect(first.applied).toBe(true)
  expect(second.applied).toBe(true)

  // Byte identical avatars must be stored once, not once per tab
  await expect.poll(() => listCachedFiles(app.userDataDir, baseline)).toHaveLength(1)
  const [sharedAvatar] = await listCachedFiles(app.userDataDir, baseline)

  // A different channel still gets its own file
  const third = await createChannelTabWithAvatar(page, 'UCotherchannel', OTHER_AVATAR_PNG)
  expect(third.applied).toBe(true)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return new Set(files.map(file => file.digest)).size
  }).toBe(2)

  // Closing one of the two tabs must not pull the file out from under the other
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), first.id)
  await expect(page.locator(`.tab[data-tab-id="${first.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return files.some(file => file.name === sharedAvatar.name)
  }).toBe(true)

  // The last tab letting go of it releases the file
  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), second.id)
  await expect(page.locator(`.tab[data-tab-id="${second.id}"]`)).toHaveCount(0)
  await expect.poll(async () => {
    const files = await listCachedFiles(app.userDataDir, baseline)
    return files.some(file => file.name === sharedAvatar.name)
  }).toBe(false)
})
