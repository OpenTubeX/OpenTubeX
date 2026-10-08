import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { abortUnmockedRequest, expect, goTo, sel } from '../helpers/app.mjs'
import { mockPlayableWatchPage } from '../helpers/watch.mjs'
import { runLargeSubscriptionsBenchmark } from './subscriptions.mjs'

const actionTimeoutMs = 30_000
const navigationCycles = 10
const scrollFrames = 60
const playbackCycles = 5

export function mockPerformanceServices(page) {
  return page.route(/^https?:\/\//, route => {
    // Aborting unrelated channel/trending requests marks the shared YouTube
    // origin unavailable and makes later mocked playback wait in retry backoff.
    if (new URL(route.request().url()).hostname === 'www.youtube.com') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    }
    return abortUnmockedRequest(route)
  })
}

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

export async function measureLargeFeedScroll(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Performance.enable')
    const before = await session.send('Performance.getMetrics')
    const result = await page.evaluate(({ scrollFrames, actionTimeoutMs }) => new Promise((resolve, reject) => {
      const startedAt = performance.now()
      let previousFrame = startedAt
      let longestFrame = 0
      let frame = 0
      let animationFrame
      const timeout = setTimeout(() => {
        cancelAnimationFrame(animationFrame)
        reject(new Error('Large feed scrolling did not finish within the performance timeout'))
      }, actionTimeoutMs)

      function sample(timestamp) {
        longestFrame = Math.max(longestFrame, timestamp - previousFrame)
        previousFrame = timestamp
        frame++

        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        if (maximum === 0) {
          clearTimeout(timeout)
          reject(new Error('The large feed has no scroll range'))
          return
        }
        window.scrollTo({ top: maximum * frame / scrollFrames, behavior: 'instant' })

        if (frame === scrollFrames) {
          animationFrame = requestAnimationFrame(finishedAt => {
            clearTimeout(timeout)
            if (window.scrollY <= 0) {
              reject(new Error('The large feed did not scroll'))
              return
            }
            resolve({
              elapsed: finishedAt - startedAt,
              longestFrame: Math.max(longestFrame, finishedAt - previousFrame)
            })
          })
          return
        }
        animationFrame = requestAnimationFrame(sample)
      }

      animationFrame = requestAnimationFrame(sample)
    }), { scrollFrames, actionTimeoutMs })
    const after = await session.send('Performance.getMetrics')
    const taskDuration = metrics => metrics.metrics.find(metric => metric.name === 'TaskDuration')?.value
    const taskMs = (taskDuration(after) - taskDuration(before)) * 1000
    if (!Number.isFinite(taskMs) || taskMs < 0) {
      throw new Error('Renderer TaskDuration is unavailable')
    }
    return { ...result, taskMs }
  } finally {
    await session.detach()
  }
}

async function collectRendererHeapAfterGcKiB(page, settleMs = 0) {
  if (settleMs > 0) await page.waitForTimeout(settleMs)
  return page.evaluate(async () => {
    if (typeof globalThis.gc !== 'function') {
      throw new Error('Renderer garbage collection is unavailable')
    }

    for (let index = 0; index < 3; index++) {
      globalThis.gc()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }

    const usedJSHeapSize = performance.memory?.usedJSHeapSize
    if (!Number.isFinite(usedJSHeapSize)) {
      throw new Error('Precise renderer heap information is unavailable')
    }
    return usedJSHeapSize / 1024
  })
}

async function measureNavigationHeapGrowth(page) {
  await goTo(page, 'trending')
  const before = await collectRendererHeapAfterGcKiB(page)

  for (let index = 0; index < navigationCycles; index++) {
    await goTo(page, 'subscribedchannels')
    await expect(page.getByText('933 channel(s) found.')).toBeVisible()
    await goTo(page, 'trending')
  }

  const after = await collectRendererHeapAfterGcKiB(page)
  return Math.max(0, after - before) / 1024
}

async function measurePlaybackStart(electronApp, page) {
  await mockPlayableWatchPage({ electronApp, page }, page)
  // Keep the watch API/media fixtures, with the performance fallback for other
  // requests throughout the later playback and disposal measurements.
  await page.unroute(/^https?:\/\//, abortUnmockedRequest)
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

export async function measurePlaybackHeapGrowth(page) {
  const expandNavigation = page.getByRole('button', { name: 'Expand side navigation', exact: true })
  if (await expandNavigation.isVisible()) await expandNavigation.click()
  await goTo(page, 'trending')
  await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)

  async function cycle() {
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/jNQXAC9IVRw', makeActive: true
    }))
    const panel = page.locator(`.tabContent[data-tab-id="${tab.id}"]`)
    await expect.poll(() => panel.locator('video').evaluateAll(videos => videos.some(video =>
      !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    )), { timeout: actionTimeoutMs }).toBe(true)
    await page.evaluate(id => window.ftElectron.tabs.close(id), tab.id)
    await expect(panel).toHaveCount(0)
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
  }

  // Exclude one-time player initialization, lazy modules and media caches.
  await cycle()
  // Avatar requests can retain closed players until their five-second deadline.
  // Sample both sides after that bounded work settles, rather than measuring
  // timing-dependent temporary retention as a player leak.
  const before = await collectRendererHeapAfterGcKiB(page, 5000)
  for (let index = 0; index < playbackCycles; index++) await cycle()
  const after = await collectRendererHeapAfterGcKiB(page, 5000)
  return Math.max(0, after - before) / 1024
}

export async function packedCodeSizeKiB(appRoot) {
  const distRoot = path.join(appRoot, 'dist-e2e')
  const entries = await readdir(distRoot, { withFileTypes: true, recursive: true })
  const bundleFiles = entries.filter(entry => entry.isFile() && (
    entry.name.endsWith('.css') ||
    entry.name.endsWith('.js')
  ))
  const sizes = await Promise.all(bundleFiles.map(async entry => (
    await stat(path.join(entry.parentPath, entry.name))
  ).size))
  return sizes.reduce((total, size) => total + size, 0) / 1024
}

export async function runPerformanceScenarios({ electronApp, page }, startup, appRoot) {
  const subscribedChannelsNavigation = await measureSubscribedChannelsNavigation(page)
  const channelSearch = await measureChannelSearch(page)
  const subscriptionSwitches = await runLargeSubscriptionsBenchmark(page)
  const scroll = await measureLargeFeedScroll(page)
  const navigationHeapGrowthMiB = await measureNavigationHeapGrowth(page)
  const playbackStart = await measurePlaybackStart(electronApp, page)
  const playbackHeapGrowthMiB = await measurePlaybackHeapGrowth(page)

  return {
    ...startup,
    subscribedChannelsNavigationElapsedMs: subscribedChannelsNavigation.elapsed,
    subscribedChannelsNavigationLongestFrameMs: subscribedChannelsNavigation.longestFrame,
    channelSearchElapsedMs: channelSearch.elapsed,
    channelSearchLongestFrameMs: channelSearch.longestFrame,
    ...subscriptionSwitches,
    largeFeedScrollLongestFrameMs: scroll.longestFrame,
    largeFeedScrollElapsedMs: scroll.elapsed,
    largeFeedScrollTaskMs: scroll.taskMs,
    navigationHeapGrowthMiB,
    playbackStartElapsedMs: playbackStart.elapsed,
    playbackStartLongestFrameMs: playbackStart.longestFrame,
    playbackHeapGrowthMiB,
    packedCodeSizeKiB: await packedCodeSizeKiB(appRoot)
  }
}
