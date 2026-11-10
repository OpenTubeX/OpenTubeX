import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

test('late timeupdates do not access the released Shaka cast proxy', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const component = await page.evaluateHandle(findWatchComponent)
  const disposal = await component.evaluateHandle(component => {
    const video = component.refs.player.$.setupState.video
    const controls = video.ui.getControls()
    const player = controls.getLocalPlayer()
    const proxy = controls.getPlayer()
    const originalDestroy = player.destroy.bind(player)
    const config = component.appContext.app.config
    const originalErrorHandler = config.errorHandler
    const state = { started: false, errors: [], proxy, video }
    const gate = new Promise(resolve => { state.release = resolve })
    config.errorHandler = (error, ...args) => {
      state.errors.push(String(error))
      originalErrorHandler?.(error, ...args)
    }
    state.restore = () => { config.errorHandler = originalErrorHandler }
    player.destroy = () => {
      state.started = true
      const destroyed = originalDestroy()
      return gate.then(() => destroyed)
    }
    state.destroyed = component.refs.player.destroyPlayer()
    return state
  })
  try {
    await expect.poll(() => disposal.evaluate(state => state.started)).toBe(true)
    const result = await disposal.evaluate(state => {
      let proxyError = null
      try { state.proxy.seekRange() } catch (error) { proxyError = String(error) }
      state.video.dispatchEvent(new Event('timeupdate'))
      return { proxyError, errors: state.errors }
    })
    // Confirm this is the real teardown window, where optional chaining on
    // getPlayer() cannot protect a read through its released proxy.
    expect(result.proxyError).toMatch(/Cannot read properties of null/)
    expect(result.errors).toEqual([])
  } finally {
    await disposal.evaluate(async state => {
      state.release()
      await state.destroyed
      state.restore()
    })
    await component.dispose()
    await disposal.dispose()
  }
  await expect(video).toBeVisible()
})

for (const timing of ['while', 'after']) {
  test(`shortcuts and leaving fullscreen ${timing} the player is torn down do not reach released controls`, async ({ app, page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)

    // A playback-engine fallback tears the player down while it stays mounted,
    // and input or the end of fullscreen can arrive during or after that teardown.
    const component = await page.evaluateHandle(findWatchComponent)
    const teardown = await component.evaluateHandle(component => {
      const player = component.refs.player.$.setupState.video.ui.getControls().getLocalPlayer()
      const originalDestroy = player.destroy.bind(player)
      const state = { started: false }
      const gate = new Promise(resolve => { state.release = resolve })
      player.destroy = () => {
        state.started = true
        const destroyed = originalDestroy()
        return gate.then(() => destroyed)
      }
      state.destroyed = component.refs.player.destroyPlayer()
      return state
    })
    await expect.poll(() => teardown.evaluate(state => state.started)).toBe(true)
    if (timing === 'after') {
      await teardown.evaluate(async state => {
        state.release()
        await state.destroyed
      })
    }
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Shift+?')
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve))))
    await teardown.evaluate(async state => {
      state.release()
      await state.destroyed
    })
    await teardown.dispose()
    await component.dispose()

    expect(errors).toEqual([])
  })
}
