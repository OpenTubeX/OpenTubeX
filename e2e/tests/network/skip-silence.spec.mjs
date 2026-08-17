import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, openVideoOrSkip, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

const VIDEO = {
  id: 'erWLQ0uHQkg',
  title: 'silence fast forward test v2',
  url: 'https://www.youtube.com/watch?v=erWLQ0uHQkg'
}

test.use({
  seed: {
    settings: {
      showSkipSilenceButton: true,
      keyboardShortcuts: JSON.stringify({
        VIDEO_PLAYER: {
          PLAYBACK: {
            TOGGLE_SKIP_SILENCE: 'h'
          }
        }
      })
    }
  }
})

test('jumps to the end of silence without changing playback rate', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'needs the adaptive audio segments of the real API')

  await openVideoOrSkip(test, page, VIDEO)
  const video = await waitForPlaybackOrSkip(test, page)
  await video.evaluate(element => {
    window.__skipSilenceJumps = []
    window.__skipSilenceRates = [element.playbackRate]
    let lastTime = element.currentTime
    element.addEventListener('timeupdate', () => {
      lastTime = element.currentTime
    })
    element.addEventListener('seeking', () => {
      window.__skipSilenceJumps.push(element.currentTime - lastTime)
    })
    element.addEventListener('ratechange', () => {
      window.__skipSilenceRates.push(element.playbackRate)
    })
  })

  await page.locator(`${activeTab} .ftVideoPlayer`).press('h')
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
  })).toBe(true)

  await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__skipSilenceJumps)), {
    timeout: 30_000,
    intervals: [500]
  }).toBeGreaterThan(2)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)

  const { jumps, rates } = await page.evaluate(() => ({
    jumps: window.__skipSilenceJumps,
    rates: window.__skipSilenceRates
  }))
  expect(jumps.filter(jump => jump > 0.1)).toHaveLength(1)
  expect(rates.every(rate => rate === 1)).toBe(true)
})
