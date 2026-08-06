import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { goTo, test, expect } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  seed: {
    history: [{ ...watchHistoryEntry, title: 'IP block test video' }]
  }
})

/**
 * Replays streaming URL 403s against the mounted Watch view, recording whether
 * each one reloaded the video, escalated to the IP block recovery script, or
 * showed the session-expired error.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} errorCount
 * @param {{ sessionExpired?: boolean }} [options]
 */
async function replayStreamForbiddenErrors(page, errorCount, options = {}) {
  const watchView = await watchViewHandle(page)

  return await watchView.evaluate(async (view, { count, sessionExpired }) => {
    // The state a video that is playing a DASH stream is in.
    const enterPlayingState = () => {
      view.errorMessage = ''
      view.customErrorIcon = null
      view.isLoading = false
      view.isLive = false
      view.isPostLiveDvr = false
      view.activeFormat = 'dash'
      view.manifestMimeType = 'application/dash+xml'
      // Fresh URLs for the IP-change path; past expiry for the session path.
      view.streamingDataExpiryDate = sessionExpired
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + 3_600_000)
    }

    enterPlayingState()

    const reloads = []
    const recoveries = []
    // The real reload runs, so that a reset of the one-shot reload state during
    // a same-video reload would show up here as an extra reload.
    const reloadView = view.reloadView.bind(view)
    view.reloadView = async (reloadOptions) => {
      reloads.push(view.videoId)
      await reloadView(reloadOptions)
      enterPlayingState()
    }
    // Same no-op guard as the real method, so the loads that happen during a
    // reload don't count as recovery runs.
    view.runIpBlockRecoveryScriptAndReload = async () => {
      if (!view.ipBlockDetectedInCurrentChain) { return false }
      recoveries.push(view.videoId)
      return true
    }

    // 1001 = BAD_HTTP_STATUS, category 1 = NETWORK.
    const forbiddenError = () => ({
      severity: 2,
      category: 1,
      code: 1001,
      data: ['https://example.invalid/videoplayback', 403]
    })

    const steps = []
    for (let index = 0; index < count; index++) {
      await view.handlePlayerError(forbiddenError())
      steps.push({
        reloads: reloads.length,
        recoveries: recoveries.length,
        errorMessage: view.errorMessage || ''
      })
    }

    return { steps, reloads, recoveries }
  }, { count: errorCount, sessionExpired: !!options.sessionExpired })
}

async function openWatchPage(app, page) {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('IP block test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })
}

test('a streaming URL 403 reloads the video before blaming the IP', async ({ app, page }) => {
  await openWatchPage(app, page)

  const result = await replayStreamForbiddenErrors(page, 1)

  // Our own IP changing invalidates the issued streaming URLs the same way an
  // IP block does, so the first 403 must only fetch fresh URLs.
  expect(result.steps).toEqual([{ reloads: 1, recoveries: 0, errorMessage: '' }])
})

test('a streaming URL 403 that survives the reload runs the recovery script', async ({ app, page }) => {
  await openWatchPage(app, page)

  const result = await replayStreamForbiddenErrors(page, 2)

  expect(result.steps).toEqual([
    { reloads: 1, recoveries: 0, errorMessage: '' },
    {
      reloads: 1,
      recoveries: 1,
      errorMessage: '[BAD_HTTP_STATUS: 403] Potential causes: IP block or streaming URL deciphering failed'
    }
  ])
  expect(result.recoveries).toEqual(['jNQXAC9IVRw'])
})

test('an expired watch session 403 reloads the video before showing the error', async ({ app, page }) => {
  await openWatchPage(app, page)

  const result = await replayStreamForbiddenErrors(page, 1, { sessionExpired: true })

  expect(result.steps).toEqual([{ reloads: 1, recoveries: 0, errorMessage: '' }])
})

test('an expired watch session 403 that survives the reload shows the error', async ({ app, page }) => {
  await openWatchPage(app, page)

  const result = await replayStreamForbiddenErrors(page, 2, { sessionExpired: true })

  expect(result.steps).toEqual([
    { reloads: 1, recoveries: 0, errorMessage: '' },
    {
      reloads: 1,
      recoveries: 0,
      errorMessage: '[BAD_HTTP_STATUS: 403] YouTube watch session expired. Please reopen this video.'
    }
  ])
  expect(result.recoveries).toEqual([])
})

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
    const [acquired] = await Promise.all([
      window.ftElectron.subscriptionAutoRefresh.acquire(tabId, 'videos'),
      window.ftElectron.waitForIpBlockRecoveryScript()
    ])
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
