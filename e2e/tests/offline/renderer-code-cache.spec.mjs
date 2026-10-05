import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { landingPage: 'history' } } })

async function rendererCacheEntries(userDataDir) {
  const directory = path.join(userDataDir, 'Code Cache', 'js')
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const contents = await readFile(path.join(entry.parentPath, entry.name))
    return { name: entry.name, contents }
  }))
  // Ignore Chromium's small heat-check records: these must contain compiled
  // code for our entry point, rather than merely noting that it was visited.
  return files.filter(({ contents }) => contents.includes('app://bundle/renderer.js') && contents.length > 1024)
}

test('persists packaged renderer code across launches and recreates it after clearing', async ({ app }, testInfo) => {
  let entries
  let checkpoints = 0
  const inspectStoppedCache = async (oldProcess) => {
    expect(oldProcess.exitCode, 'the previous process has exited').toBe(0)
    entries = await rendererCacheEntries(app.userDataDir)
    expect(entries.length, 'compiled renderer code persists before a replacement process starts').toBeGreaterThan(0)
    checkpoints++
  }

  // The default V8 policy waits for repeated loads before storing bytecode.
  for (let launch = 0; launch < 2; launch++) {
    const { page } = await app.relaunch()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  }

  await app.relaunch(inspectStoppedCache)
  expect(checkpoints).toBe(1)
  await testInfo.attach('renderer-code-cache', {
    body: JSON.stringify(entries.map(({ name, contents }) => ({ name, bytes: contents.length }))),
    contentType: 'application/json'
  })

  await app.electronApp.evaluate(async ({ session }) => {
    await session.defaultSession.clearCodeCaches({ urls: [] })
  })
  expect(await rendererCacheEntries(app.userDataDir)).toHaveLength(0)

  for (let launch = 0; launch < 2; launch++) {
    const { page } = await app.relaunch()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  }
  await app.relaunch(inspectStoppedCache)
  expect(checkpoints).toBe(2)
})
