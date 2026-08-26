import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, goTo, sel } from '../helpers/app.mjs'
import { mockPlayableWatchPage } from '../helpers/watch.mjs'
import { runLargeSubscriptionsBenchmark } from './subscriptions.mjs'

const actionTimeoutMs = 30_000
const navigationCycles = 10
const scrollFrames = 60

function measureRendererAction(page, scenario) {
  const timeoutMessage = scenario === 'navigation'
    ? 'Subscribed Channels did not render within the performance timeout'
    : 'Subscribed Channels search did not finish within the performance timeout'

  return page.evaluate(({ scenario, timeoutMessage, actionTimeoutMs }) => {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now()
      let previousFrame = startedAt
      let longestFrame = 0
      let settled = false
      const timeout = setTimeout(() => {
        settled = true
        reject(new Error(timeoutMessage))
      }, actionTimeoutMs)

      const isComplete = () => {
        const count = document.querySelector('.count')?.textContent ?? ''
        if (scenario === 'navigation') {
          return location.hash.startsWith('#/subscribedchannels') &&
            count.includes('933') &&
            document.querySelector('.channel') !== null
        }

        const channels = [...document.querySelectorAll('.channel')]
        return count.includes('1 channel(s) found.') &&
          channels.length === 1 &&
          (channels[0].textContent ?? '').includes('Channel 932')
      }

      function sampleFrame(timestamp) {
        if (settled) return

        longestFrame = Math.max(longestFrame, timestamp - previousFrame)
        previousFrame = timestamp

        if (isComplete()) {
          settled = true
          requestAnimationFrame(finishedAt => {
            clearTimeout(timeout)
            resolve({
              elapsed: finishedAt - startedAt,
              longestFrame: Math.max(longestFrame, finishedAt - previousFrame)
            })
          })
          return
        }

        requestAnimationFrame(sampleFrame)
      }

      if (scenario === 'navigation') {
        const links = [...document.querySelectorAll('.sideNav a[href="#/subscribedchannels"]')]
        const target = links.find(link => link.getClientRects().length > 0)
        if (!target) throw new Error('Subscribed Channels navigation link is not visible')
        target.click()
      } else {
        const input = document.querySelector('.tabContent[aria-hidden="false"] input.ft-input')
        if (!input) throw new Error('Subscribed Channels search input is missing')
        input.value = 'Channel 932'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      requestAnimationFrame(sampleFrame)
    })
  }, { scenario, timeoutMessage, actionTimeoutMs })
}

async function measureSubscribedChannelsNavigation(page) {
  await goTo(page, 'trending')

  const result = await measureRendererAction(page, 'navigation')

  await expect(page.getByText('933 channel(s) found.')).toBeVisible()
  return result
}

async function measureChannelSearch(page) {
  const result = await measureRendererAction(page, 'search')

  await expect(page.locator('.channel', { hasText: 'Channel 932' })).toBeVisible()
  return result
}

async function measureLargeFeedScroll(page) {
  await page.evaluate(() => window.scrollTo(0, 0))

  return page.evaluate(({ scrollFrames }) => new Promise(resolve => {
    const startedAt = performance.now()
    let previousFrame = startedAt
    let longestFrame = 0
    let frame = 0

    function sample(timestamp) {
      longestFrame = Math.max(longestFrame, timestamp - previousFrame)
      previousFrame = timestamp
      frame++

      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo(0, maximum * frame / scrollFrames)

      if (frame === scrollFrames) {
        requestAnimationFrame(finishedAt => resolve({
          longestFrame: Math.max(longestFrame, finishedAt - previousFrame)
        }))
        return
      }
      requestAnimationFrame(sample)
    }

    requestAnimationFrame(sample)
  }), { scrollFrames })
}

async function collectRendererWorkingSetKiB(electronApp) {
  return electronApp.evaluate(({ app }) => app.getAppMetrics()
    .filter(metric => metric.type === 'Tab')
    .reduce((total, metric) => total + metric.memory.workingSetSize, 0))
}

async function collectMemoryAfterGc(electronApp, page) {
  await page.evaluate(async () => {
    if (typeof globalThis.gc !== 'function') {
      throw new Error('Renderer garbage collection is unavailable')
    }
    globalThis.gc()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  return collectRendererWorkingSetKiB(electronApp)
}

async function measureNavigationMemoryGrowth(electronApp, page) {
  await goTo(page, 'trending')
  const before = await collectMemoryAfterGc(electronApp, page)

  for (let index = 0; index < navigationCycles; index++) {
    await goTo(page, 'subscribedchannels')
    await expect(page.getByText('933 channel(s) found.')).toBeVisible()
    await goTo(page, 'trending')
  }

  const after = await collectMemoryAfterGc(electronApp, page)
  return Math.max(0, after - before) / 1024
}

async function measurePlaybackStart(electronApp, page) {
  await mockPlayableWatchPage({ electronApp, page }, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')

  await page.evaluate(() => {
    const startedAt = performance.now()
    let previousFrame = startedAt
    let longestFrame = 0
    let animationFrame

    const sampleFrame = timestamp => {
      longestFrame = Math.max(longestFrame, timestamp - previousFrame)
      previousFrame = timestamp
      animationFrame = requestAnimationFrame(sampleFrame)
    }
    animationFrame = requestAnimationFrame(sampleFrame)

    const recordPlaybackStart = event => {
      if (!(event.target instanceof HTMLVideoElement) || window.__performancePlaybackStart) {
        return
      }
      cancelAnimationFrame(animationFrame)
      window.__performancePlaybackStart = {
        elapsed: performance.now() - startedAt,
        longestFrame: Math.max(longestFrame, performance.now() - previousFrame)
      }
      document.removeEventListener('playing', recordPlaybackStart, true)
    }
    document.addEventListener('playing', recordPlaybackStart, true)
  })

  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect.poll(
    () => page.evaluate(() => window.__performancePlaybackStart ?? null),
    { timeout: actionTimeoutMs, message: 'waiting for local playback to start' }
  ).not.toBeNull()

  return page.evaluate(() => window.__performancePlaybackStart)
}

export async function packedCodeSizeKiB(appRoot) {
  const distRoot = path.join(appRoot, 'dist-e2e')
  const entries = await readdir(distRoot, { withFileTypes: true })
  const bundleFiles = entries.filter(entry => entry.isFile() && (
    entry.name.endsWith('.css') ||
    entry.name.endsWith('.js')
  ))
  const sizes = await Promise.all(bundleFiles.map(async entry => (
    await stat(path.join(distRoot, entry.name))
  ).size))
  return sizes.reduce((total, size) => total + size, 0) / 1024
}

export async function runPerformanceScenarios({ electronApp, page }, startup, appRoot) {
  const subscribedChannelsNavigation = await measureSubscribedChannelsNavigation(page)
  const channelSearch = await measureChannelSearch(page)
  const subscriptionSwitches = await runLargeSubscriptionsBenchmark(page)
  const scroll = await measureLargeFeedScroll(page)
  const navigationMemoryGrowthMiB = await measureNavigationMemoryGrowth(electronApp, page)
  const playbackStart = await measurePlaybackStart(electronApp, page)

  return {
    ...startup,
    subscribedChannelsNavigationElapsedMs: subscribedChannelsNavigation.elapsed,
    subscribedChannelsNavigationLongestFrameMs: subscribedChannelsNavigation.longestFrame,
    channelSearchElapsedMs: channelSearch.elapsed,
    channelSearchLongestFrameMs: channelSearch.longestFrame,
    ...subscriptionSwitches,
    largeFeedScrollLongestFrameMs: scroll.longestFrame,
    navigationMemoryGrowthMiB,
    playbackStartElapsedMs: playbackStart.elapsed,
    playbackStartLongestFrameMs: playbackStart.longestFrame,
    packedCodeSizeKiB: await packedCodeSizeKiB(appRoot)
  }
}
