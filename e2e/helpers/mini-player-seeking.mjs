import { expect } from '@playwright/test'

/** Exercises the native range control through touch, including its held state. */
export async function checkMiniPlayerSeeking(page, player, touch, capture = async () => {}, { keyboard = true } = {}) {
  const video = player.locator('video').first()
  const seek = player.locator('.mobileMiniBarSeek')
  const progress = player.locator('.mobileMiniBarProgress')
  const route = page.url()
  await expect(seek).toBeEnabled()
  const thickness = () => progress.evaluate(element => Number.parseFloat(getComputedStyle(element, '::before').height))
  const trackCenter = () => progress.evaluate(element => {
    const track = getComputedStyle(element, '::before')
    return element.getBoundingClientRect().top + Number.parseFloat(track.top) + Number.parseFloat(track.height) / 2
  })
  await expect.poll(thickness).toBe(2)
  await video.evaluate(element => { element.pause(); element.currentTime = 10 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await expect.poll(() => player.evaluate(element => element.getAnimations()
    .every(animation => animation.effect.getTiming().iterations === Infinity || animation.playState !== 'running'))).toBe(true)
  const restingCenter = await trackCenter()
  const bounds = await seek.boundingBox()
  // Start on the thin line, then leave its bounds vertically while dragging.
  const start = { x: bounds.x + 8 + (bounds.width - 16) * 0.25, y: restingCenter }
  await touch('touchStart', start)
  try {
    await expect.poll(thickness).toBe(6)
    await expect.poll(trackCenter).toBeCloseTo(restingCenter, 1)
    await expect.poll(() => seek.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 1) === element
    })).toBe(true)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(restingCenter, 1)
    await expect.poll(() => seek.evaluate(element => getComputedStyle(element, '::-webkit-slider-thumb').opacity)).toBe('1')
    await capture('held')
    await touch('touchMove', { x: bounds.x + 8 + (bounds.width - 16) * 0.75, y: bounds.y - 30 })
  } finally {
    await touch('touchEnd')
  }
  const duration = await video.evaluate(element => element.duration)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.75, 0)
  await expect.poll(thickness).toBe(2)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await expect(player).toHaveClass(/mobileMiniBar/)
  await expect(page).toHaveURL(route)
  // Touch cancellation must release the enlarged track and keep navigation.
  await touch('touchStart', start)
  try {
    await expect.poll(thickness).toBe(6)
  } finally {
    await touch('touchCancel')
  }
  await expect.poll(thickness).toBe(2)
  await expect(page).toHaveURL(route)
  if (keyboard) {
    await seek.evaluate(element => element.focus({ preventScroll: true }))
    await page.keyboard.press('Home')
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(0)
    await seek.evaluate(element => element.blur())
    await expect.poll(thickness).toBe(2)
  }
  await video.evaluate(element => element.play())
  await touch('touchStart', start)
  await touch('touchEnd')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await capture('released')
}
