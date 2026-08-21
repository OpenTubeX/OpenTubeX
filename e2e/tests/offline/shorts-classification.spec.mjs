import { expect, sel, test } from '../../helpers/app.mjs'
import { findWatchComponent, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const VIDEO = {
  type: 'video',
  videoId: 'squareVid01',
  title: 'Square music upload',
  author: 'Test Channel',
  authorId: 'UC-square-video',
  lengthSeconds: 120,
  isShort: false,
}

const SEARCH_SETTINGS = {
  prioritize: 'relevance',
  time: '',
  type: 'all',
  duration: '',
  features: [],
}

test.use({
  seed: {
    settings: {
      useCustomShortsPlayer: true,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    }
  }
})

test('keeps a normal square search result in the standard player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(({ video, searchSettings }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'square music upload',
      data: [video],
      searchSettings,
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  }, { video: VIDEO, searchSettings: SEARCH_SETTINGS })

  await page.locator(sel.searchInput).fill('square music upload')
  await page.locator(sel.searchInput).press('Enter')
  await page.getByRole('link', { name: VIDEO.title, exact: true }).click()

  await expect(page).toHaveURL(/#\/watch\/squareVid01\?short=false/)
  await waitForPlayback(page)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    component.proxy.updateShortsPlayerState(120, [{ width: 1080, height: 1080 }])
    await component.proxy.$nextTick()
  })

  await expect(page.locator('.videoLayout')).not.toHaveClass(/shortsPlayerActive/)
  await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/shortsPlayer/)
  await watchComponent.dispose()
})
