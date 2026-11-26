import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import { clickInFullscreen, goTo } from '../../e2e/helpers/app.mjs'
import { blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'
import { replaceWatchVideo } from '../helpers/android-watch.mjs'
import { rethrowWithAndroidState } from '../helpers/android-failure.mjs'

// Use a current debug APK on a locked emulator with its WebView forwarded.
test('Android customizes fullscreen actions and removes the empty bubble', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const { browser, page } = await connectAndroidApp()
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    await blockAppNetwork(page)
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CurrentLocale: 'en-US',
        FullscreenActions: ['share', 'sponsorBlock'],
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: true,
        UseReturnYouTubeDislikes: false,
        RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        EnableDownloads: true,
        // A slow load would otherwise fall back to yt-dlp, which replaces the fixture.
        PlaybackEngineFallback: false,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenActionsQueue = JSON.parse(JSON.stringify(store.getters.getWatchQueue))
      document.querySelector('.tutorialOverlay')?.remove()
      return saved
    })
    if (await page.locator('.settingsWindow').isVisible()) await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')
    while (!await page.locator('.settingsMenu').isVisible()) await page.locator('.settingsBackButton').click()
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.getByRole('button', { name: 'Customize interface', exact: true }).click()
    await page.locator('[data-settings-subpage-tab="fullscreenActions"]').click()
    const rows = page.locator('.selectedAction')
    await expect(rows).toHaveCount(2)
    await page.getByRole('button', { name: 'Move SponsorBlock up', exact: true }).click()
    await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.dataset.fullscreenActionId)))
      .toEqual(['sponsorBlock', 'share'])
    await page.getByRole('button', { name: 'Remove Share Video', exact: true }).click()
    await page.getByRole('button', { name: 'Add action', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Add action', exact: true })
    await menu.getByRole('menuitem', { name: 'Share Video', exact: true }).click()
    await menu.getByRole('menuitem').first().press('Escape')
    await page.locator('.settingsCloseButton').click()
    await page.evaluate(() => { location.hash = '#/watch/jNQXAC9IVRw' })
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    watch = await replaceWatchVideo(page, {
      activeFormat: 'legacy',
      videoTitle: 'Fullscreen actions test',
      videoLengthSeconds: 30,
      legacyFormats: [{
        itag: 0,
        qualityLabel: 'Test',
        mimeType: 'video/webm',
        width: 640,
        height: 360,
        bitrate: 0,
        localFile: true,
        url: `data:video/webm;base64,${media}`
      }],
    })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await player.locator('.shaka-fullscreen-button').click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    const dock = player.locator('.fullscreenActions')
    await expect(dock).toBeVisible()
    await expect(dock).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect.poll(() => dock.locator('.fullscreenActionsContent > *').evaluateAll(elements => elements.map(element => (
      element.classList.contains('fullscreenSponsorBlockToggle') ? 'sponsorBlock' : 'share'
    )))).toEqual(['sponsorBlock', 'share'])
    await dock.locator('.fullscreenSponsorBlockToggle').click()
    await expect(player.locator('.fullscreenSponsorBlockOverlay.open')).toBeVisible()
    await player.locator('.fullscreenSponsorBlockOverlay.open').getByRole('button', { name: 'Close', exact: true }).click()
    await watch.evaluate(async component => {
      const watch = component.proxy
      watch.isOffline = false
      watch.recommendedVideos = Array.from({ length: 20 }, (_, index) => ({
        videoId: `related${String(index).padStart(4, '0')}`,
        title: `Recommended video ${index + 1}`,
        author: 'Recommendation channel',
        authorId: 'UC-recommendation-test',
        lengthSeconds: 60,
        viewCount: 100,
        type: 'video',
        isLive: false,
      }))
      for (let index = 0; index < 20; index++) {
        watch.$store.commit('addVideoToWatchQueue', {
          video: {
            videoId: `queued${String(index).padStart(5, '0')}`,
            title: `Queued video ${index + 1}`,
            author: 'Queue channel',
          }
        })
      }
      await watch.$store.dispatch('updateFullscreenActions', [
        'queue', 'download', 'recommendations', 'share', 'sponsorBlock', 'comments', 'addToPlaylist', 'quickBookmark'
      ])
    })
    await dock.getByRole('button', { name: 'Queue', exact: true }).click()
    const queue = player.locator('.fullscreenQueueOverlay.open')
    await expect(queue).toBeVisible()
    await expect.poll(() => player.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return [...element.querySelector('.fullscreenActionsContent').children].every(action => {
        const button = action.matches('button') ? action : action.querySelector('button')
        const rect = button.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right &&
          rect.top >= bounds.top && rect.bottom <= bounds.bottom &&
          button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
      })
    })).toBe(true)
    await expect.poll(() => queue.locator('.queueHeader').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Array.from(element.children).every(child => {
        const childBounds = child.getBoundingClientRect()
        return childBounds.left >= bounds.left - 1 && childBounds.right <= bounds.right + 1
      })
    })).toBe(true)
    await queue.locator('.queueItem').filter({ has: page.getByRole('heading', { name: 'Queued video 2', exact: true }) }).getByRole('button', { name: 'More Options', exact: true }).click()
    await clickInFullscreen(page.getByRole('menuitem', { name: /^Move video up$/i }))
    await expect(queue.locator('.queueItem h3').first()).toHaveText('Queued video 2')
    const queueScroller = queue.locator('.queueItems')
    await queueScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => queueScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await queue.getByRole('button', { name: 'Clear Queue', exact: true }).click()
    await expect(queue).toHaveCount(0)
    await expect(dock.getByRole('button', { name: 'Queue', exact: true })).toHaveCount(0)
    await dock.getByRole('button', { name: 'Recommended videos', exact: true }).click()
    const recommendations = player.locator('.fullscreenRecommendationsOverlay.open')
    await expect(recommendations).toBeVisible()
    const recommendationsScroller = recommendations.locator('.recommendationsScroller')
    await expect(recommendationsScroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await recommendationsScroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => recommendationsScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watch.evaluate(component => { component.proxy.recommendedVideos = component.proxy.recommendedVideos.slice(0, 1) })
    await expect.poll(() => recommendationsScroller.evaluate(element => element.scrollTop)).toBe(0)
    await recommendations.getByRole('button', { name: 'Close', exact: true }).click()
    await dock.getByRole('button', { name: 'Download Video', exact: true }).click()
    await expect(page.locator('.downloadPromptCard')).toBeVisible()
    assert.equal(await page.evaluate(() => document.fullscreenElement?.contains(document.querySelector('.downloadPromptCard'))), true)
    await clickInFullscreen(page.locator('.downloadPromptCard').getByRole('button', { name: 'Cancel', exact: true }))
    await page.evaluate(async () => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateFullscreenActions', [])
    })
    await expect(dock).toHaveCount(0)
    await expect(player).toHaveAttribute('data-action-dock-visible', 'false')
    assert.equal(await video.evaluate(element => element.error), null)
  } catch (error) {
    await rethrowWithAndroidState(error, page, 'fullscreen-actions', () => {
      const describe = element => element && {
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        inFullscreen: !!document.fullscreenElement?.contains(element),
      }
      const card = document.querySelector('.downloadPromptCard')
      return {
        now: Math.round(performance.now()),
        fullscreenElement: document.fullscreenElement?.className ?? null,
        prompts: [...document.querySelectorAll('.prompt')].map(describe),
        downloadPromptCard: describe(card),
        cardAnimations: card?.getAnimations({ subtree: true }).map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) ?? null,
        overlays: [...document.querySelectorAll('.ftVideoPlayer [class*="Overlay"].open, .toast, .ft-toast, [role="dialog"], [role="menu"]')].map(describe),
        inert: [...document.querySelectorAll('[inert]')].map(element => element.className),
        focused: document.activeElement && `${document.activeElement.tagName.toLowerCase()}.${[...document.activeElement.classList].join('.')}`,
      }
    })
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) {
        if (key === 'FullscreenActions') await store.dispatch('updateFullscreenActions', value)
        else store.commit('set' + key, value)
      }
      if (window.__fullscreenActionsQueue) {
        store.commit('clearWatchQueue')
        for (const video of window.__fullscreenActionsQueue) store.commit('addVideoToWatchQueue', { video })
      }
      delete window.__fullscreenActionsQueue
      window.__androidTestNetwork?.restore()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await browser.close()
  }
})
