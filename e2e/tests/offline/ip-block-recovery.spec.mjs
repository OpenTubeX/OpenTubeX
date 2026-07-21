import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'

test('subscription refresh waits for an active IP block recovery', async ({ app, page }) => {
  const isWindows = process.platform === 'win32'
  const scriptPath = path.join(app.userDataDir, isWindows ? 'recover.cmd' : 'recover.sh')
  await writeFile(scriptPath, isWindows
    ? '@echo off\r\nping 127.0.0.1 -n 2 > nul\r\n'
    : '#!/bin/sh\nsleep 0.5\n')
  if (!isWindows) {
    await chmod(scriptPath, 0o700)
  }

  const result = await page.evaluate(async (recoveryScriptPath) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const tabId = store.getters.getActiveTabId
    const started = await window.ftElectron.startIpBlockRecoveryScript(recoveryScriptPath)
    const startedAt = performance.now()
    const acquired = await window.ftElectron.subscriptionAutoRefresh.acquire(tabId, 'videos')
    const elapsed = performance.now() - startedAt

    if (acquired) {
      await window.ftElectron.subscriptionAutoRefresh.release(tabId)
    }

    return { acquired, elapsed, started }
  }, scriptPath)

  expect(result.started).toBe(true)
  expect(result.acquired).toBe(true)
  expect(result.elapsed).toBeGreaterThanOrEqual(350)
})
