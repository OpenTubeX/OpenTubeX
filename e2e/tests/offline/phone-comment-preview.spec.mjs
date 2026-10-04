import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

async function openPhoneVideo(app, page) {
  await mockPlayableWatchPage(app, page)
  await page.route(/https:\/\/yt3\.(ggpht|googleusercontent)\.com\//, route => fulfillVisualFixture(route, 'avatar'))
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 450, height: 850 })
  const button = page.locator('.phoneCommentsButton')
  await button.scrollIntoViewIfNeeded()
  await expect(button.locator('.phoneCommentDot')).toHaveCount(5)
  await expect(button.locator('.phoneCommentExcerpt')).toHaveCount(1)
  await page.mouse.move(0, 0)
  return button
}

test('phone comment preview rotates the first five comments and opens the comments sheet', async ({ app, page }, testInfo) => {
  await page.clock.install()
  const button = await openPhoneVideo(app, page)
  const view = await watchViewHandle(page)
  const comments = await view.evaluate(component => component.commentPreviews)
  const excerpt = button.locator('.phoneCommentExcerpt')
  const activeDot = () => button.locator('.phoneCommentDot').evaluateAll(dots => dots.findIndex(dot => dot.classList.contains('active')))
  const originalHeight = await button.evaluate(element => element.getBoundingClientRect().height)

  await expect(excerpt).toContainText(comments[0].author)
  const open = button.getByRole('button', { name: 'Comments', exact: true })
  await expect(open).toHaveAccessibleDescription(`${comments[0].author} ${comments[0].text.replaceAll(/\s+/g, ' ').trim()}`)
  await open.focus()
  await open.blur()
  await page.clock.fastForward(4000)
  await expect.poll(activeDot).toBe(0)
  for (const index of [1, 2, 3, 4, 0]) {
    await page.clock.fastForward(index === 1 ? 1000 : 5000)
    await expect.poll(activeDot).toBe(index)
    await expect(excerpt).toHaveCount(1)
    await expect(excerpt).toContainText(comments[index].author)
    await expect(excerpt).toContainText(comments[index].text.replaceAll(/\s+/g, ' ').trim())
    await expect(open).toHaveAccessibleDescription(`${comments[index].author} ${comments[index].text.replaceAll(/\s+/g, ' ').trim()}`)
    await expect(button.locator('img.phoneCommentAvatarImage')).toHaveAttribute('src', comments[index].authorThumb)
    await expect(button.locator('img.phoneCommentAvatarImage')).toBeVisible()
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 1)
  }

  await expect(button.locator('button')).toHaveCount(1)
  await open.focus()
  await page.clock.fastForward(10_000)
  await expect.poll(activeDot).toBe(0)
  await open.blur()
  await page.clock.fastForward(5000)
  await expect.poll(activeDot).toBe(1)

  await button.getByRole('button', { name: 'Comments', exact: true }).focus()
  await page.clock.fastForward(10_000)
  await expect.poll(activeDot).toBe(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.mobileSheet[open] .comment').first()).toBeVisible()

  await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
  await button.click({ position: { x: 1, y: (await button.boundingBox()).height / 2 } })
  await expect(page.locator('.mobileSheet[open] .comment').first()).toBeVisible()
  await page.locator('.mobileSheet[open]').getByRole('button', { name: 'Close', exact: true }).click()
  await page.clock.fastForward(1000)
  await page.mouse.move(0, 0)
  for (const { width, height, zoom } of [
    { width: 375, height: 800, zoom: 1 },
    { width: 450, height: 900, zoom: 1.25 },
    { width: 850, height: 450, zoom: 1 }
  ]) {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await setWindowSize(app, page, { width, height })
    await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect.poll(() => button.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const heading = element.querySelector('.phoneCommentsHeading').getBoundingClientRect()
      const control = element.querySelector('button').getBoundingClientRect()
      const cardStyle = getComputedStyle(element)
      const icon = element.querySelector('.phoneCommentsHeading').firstElementChild.getBoundingClientRect()
      const title = element.querySelector('.phoneCommentsTitle').getBoundingClientRect()
      const chevron = element.querySelector('.phoneCommentsHeading').lastElementChild.getBoundingClientRect()
      const preview = element.querySelector('.phoneCommentPreview').getBoundingClientRect()
      const avatar = element.querySelector('.phoneCommentAvatar').getBoundingClientRect()
      const excerpt = element.querySelector('.phoneCommentExcerpt').getBoundingClientRect()
      const dots = element.querySelector('.phoneCommentDots').getBoundingClientRect()
      const circles = [...element.querySelectorAll('.phoneCommentDot')].map(dot => dot.getBoundingClientRect())
      const dotCenter = (circles[0].left + circles.at(-1).right) / 2
      return cardStyle.paddingTop === '0px' && cardStyle.paddingRight === '0px' &&
        cardStyle.paddingBottom === '0px' && cardStyle.paddingLeft === '0px' &&
        Math.abs(bounds.left - control.left) < 1 && Math.abs(bounds.right - control.right) < 1 &&
        Math.abs(bounds.top - control.top) < 1 && Math.abs(bounds.bottom - control.bottom) < 1 &&
        bounds.left >= 0 && bounds.right <= window.innerWidth + 1 &&
        element.scrollWidth <= element.clientWidth + 1 && preview.top >= heading.bottom &&
        Math.abs(icon.left - heading.left) < 1 && title.left > icon.right &&
        Math.abs(chevron.right - heading.right) < 1 &&
        Math.abs(icon.top + icon.height / 2 - title.top - title.height / 2) < 1 &&
        avatar.width === 32 && avatar.height === 32 && excerpt.left > avatar.right &&
        dots.top >= preview.bottom && Math.abs(dotCenter - (bounds.left + bounds.width / 2)) < 1
    })).toBe(true)
    await testInfo.attach(`comment-preview-${width}-${zoom}`, { body: await button.screenshot(), contentType: 'image/png' })
  }
  await view.evaluate(component => component.$store.dispatch('updateBaseTheme', 'dark'))
  await testInfo.attach('comment-preview-dark', { body: await button.screenshot(), contentType: 'image/png' })
})

test('phone comment avatars respect photo privacy, creator photos and missing or failed images', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const button = await openPhoneVideo(app, page)
  const view = await watchViewHandle(page)
  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="purple"/></svg>')
  await view.evaluate((component, authorThumb) => {
    component.commentPreviews = [{ id: 'photo', author: '@viewer', text: 'Comment with a photo', authorThumb, isOwner: false }]
  }, avatar)
  await expect(button.locator('.phoneCommentRow')).toHaveCount(1)
  await expect(button.locator('img.phoneCommentAvatarImage')).toBeVisible()
  const originalHeight = await button.evaluate(element => element.getBoundingClientRect().height)
  await view.evaluate(component => { component.$store.state.settings.hideCommentPhotos = true })
  await expect(button.locator('img.phoneCommentAvatarImage')).toHaveCount(0)
  await expect(button.locator('.phoneCommentAvatarInitial')).toHaveText('v')
  await view.evaluate(component => { component.commentPreviews[0].isOwner = true })
  await expect(button.locator('img.phoneCommentAvatarImage')).toBeVisible()
  await view.evaluate(component => { component.commentPreviews[0].authorThumb = '' })
  await expect(button.locator('.phoneCommentAvatarInitial')).toHaveText('v')
  await view.evaluate(component => { component.commentPreviews[0].authorThumb = 'data:image/png;base64,broken' })
  await expect(button.locator('.phoneCommentAvatar .retryImagePlaceholder')).toBeVisible()
  expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 1)
})

test('phone comment preview respects reduced motion and resets when comments reload or disappear', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  const button = await openPhoneVideo(app, page)
  const view = await watchViewHandle(page)
  const firstAuthor = await button.locator('.phoneCommentAuthor').innerText()
  await expect(button.locator('button')).toHaveCount(1)
  await page.clock.fastForward(15_000)
  await expect(button.locator('.phoneCommentAuthor')).toHaveText(firstAuthor)
  await expect(button.locator('.phoneCommentDot').first()).toHaveCSS('transition-duration', '0s')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(button.locator('button')).toHaveCount(1)
  await page.clock.fastForward(5000)
  await expect(button.locator('.phoneCommentDot').nth(1)).toHaveClass(/active/)
  const originalHeight = await button.evaluate(element => element.getBoundingClientRect().height)
  await view.evaluate(component => {
    component.commentPreviews = [{ id: 'replacement', author: '@replacement', text: 'A short replacement comment' }]
  })
  await expect(button.locator('.phoneCommentAuthor')).toHaveText(['@replacement'])
  await expect(button.locator('.phoneCommentDot')).toHaveCount(0)
  await expect(button.locator('button')).toHaveCount(1)
  expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(originalHeight)
  await view.evaluate(component => { component.commentPreviews = [] })
  await expect(button.locator('.phoneCommentPreview')).toHaveCount(0)
  await expect(button.getByRole('button', { name: 'Comments', exact: true })).toBeVisible()
  await expect(button.getByRole('button', { name: 'Comments', exact: true })).toHaveAccessibleDescription('')
})
