import { setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('treats an empty comments response as no comments', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) {
      return route.fallback()
    }

    commentRequestCount++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    })
  })

  await openMockedVideo(page)
  await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()

  await expect(page.locator('.noCommentMsg')).toHaveText('There are no comments available for this video')
  const expectReloadAlignedBeforeSort = () => expect.poll(() =>
    page.locator('.noCommentActions').evaluate(actions => {
      const reloadBox = actions.querySelector('.reloadComments .iconButton').getBoundingClientRect()
      const sortBox = actions.querySelector('.select-text').getBoundingClientRect()
      return {
        reloadBeforeSort: reloadBox.x + reloadBox.width <= sortBox.x,
        verticallyAligned: Math.abs(
          reloadBox.y + reloadBox.height / 2 -
          (sortBox.y + sortBox.height / 2)
        ) <= 1
      }
    })
  ).toEqual({ reloadBeforeSort: true, verticallyAligned: true })
  await expectReloadAlignedBeforeSort()

  const [actionsBox, messageBox] = await Promise.all([
    page.locator('.noCommentActions').boundingBox(),
    page.locator('.noCommentMsg').boundingBox()
  ])
  expect(Math.abs(
    actionsBox.y + actionsBox.height / 2 -
    (messageBox.y + messageBox.height / 2)
  )).toBeLessThanOrEqual(1)

  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  const [scaledActionsBox, scaledMessageBox] = await Promise.all([
    page.locator('.noCommentActions').boundingBox(),
    page.locator('.noCommentMsg').boundingBox()
  ])
  expect(Math.abs(
    scaledActionsBox.y + scaledActionsBox.height / 2 -
    (scaledMessageBox.y + scaledMessageBox.height / 2)
  )).toBeLessThanOrEqual(1)

  await setWindowSize(app, page, { width: 375, height: 800 })
  await page.locator('.app').evaluate((element) => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
  })
  await (await watchViewHandle(page)).evaluate(view => view.openPhonePanel('comments'))
  await expect(page.locator('.mobileSheet[open] .noComments')).toBeVisible()

  const readMobileLayout = () => page.locator('.noComments').evaluate((element) => {
    const actionsBounds = element.querySelector('.noCommentActions').getBoundingClientRect()
    const messageBounds = element.querySelector('.noCommentMsg').getBoundingClientRect()
    return {
      actionsAboveMessage: actionsBounds.bottom <= messageBounds.top,
      hasHorizontalOverflow: element.scrollWidth > element.clientWidth + 1
    }
  })
  const expectedMobileLayout = {
    actionsAboveMessage: true,
    hasHorizontalOverflow: false
  }
  expect(await readMobileLayout()).toEqual(expectedMobileLayout)
  await expectReloadAlignedBeforeSort()

  await setWindowSize(app, page, { width: 800, height: 375 })
  expect(await readMobileLayout()).toEqual(expectedMobileLayout)
  await expectReloadAlignedBeforeSort()
  await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
  expect(commentRequestCount).toBe(1)
})

test('loads initial comments with the video when automatic pagination is enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  // Initial comments must not depend on the later-page sentinel being visible.
  await page.addStyleTag({ content: '.commentAutoLoadSentinel { display: none !important; }' })

  await openMockedVideo(page)

  await expect(page.locator('.getCommentsTitle')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('.commentsTitle')).toBeVisible()
  await expect(page.locator('.getMoreComments')).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('pauses automatic comment pagination while filtering', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (body.continuation) {
      commentRequestCount++
    }
    await route.fallback()
  })

  await page.evaluate(() => {
    const store = window.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  await openMockedVideo(page)
  await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Filter loaded comments' }).click()
  await page.getByRole('checkbox', { name: 'From creator' }).click()
  const requestCountAfterFiltering = commentRequestCount

  // Give an unwanted page request time to start.
  await page.waitForTimeout(750)
  expect(commentRequestCount).toBe(requestCountAfterFiltering)
  await expect(page.locator('.getMoreComments')).toBeVisible()
})

async function expectCommentHeaderToolsAligned(page) {
  const commentHeaderActions = [
    page.getByRole('button', { name: 'Filter loaded comments' }),
    page.getByRole('button', { name: 'Reload Comments' })
  ]
  const actionCenters = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
  )))
  expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThanOrEqual(1)

  const actionRightEdges = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => element.getBoundingClientRect().right)
  )))
  const sortControlLeft = await page.locator('.commentHeaderActions .select').evaluate(element => {
    return element.getBoundingClientRect().left
  })
  expect(Math.max(...actionRightEdges)).toBeLessThan(sortControlLeft)

  const commentHeaderBottom = await page.locator('.commentHeader').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.bottom
  })
  const searchInputTop = await page.getByRole('searchbox', { name: 'Search loaded comments' }).evaluate(element => {
    return element.getBoundingClientRect().top
  })
  expect(searchInputTop - commentHeaderBottom).toBeGreaterThanOrEqual(7.5)
}

test.describe('manual comment loading', () => {
  // These drive the click-to-load path and the reply pagination on top of a
  // single loaded page, so they turn off the automatic pagination that would
  // otherwise load (and keep loading) the comments on its own.
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('translates a comment and restores its original text', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    let translationRequestCount = 0
    await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, route => {
      translationRequestCount++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frameworkUpdates: {
            entityBatchUpdate: {
              mutations: [{
                payload: {
                  commentEntityPayload: {
                    translatedContent: {
                      content: 'Translated comment text'
                    }
                  }
                }
              }]
            }
          }
        })
      })
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const translatableComment = page.locator('.commentThread').filter({
      has: page.locator(':scope > .commentTranslation .commentTranslationButton')
    }).first()
    const comment = page.locator(`#${await translatableComment.getAttribute('id')}`)
    await expect(comment).toBeVisible()
    const commentText = comment.locator(':scope > .commentText')
    const originalText = await commentText.textContent()
    const translate = comment.locator(':scope > .commentTranslation .commentTranslationButton')

    await translate.click()

    await expect(commentText).toHaveText('Translated comment text')
    await translate.click()
    await expect(commentText).toHaveText(originalText)

    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(1)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'fr-FR')
    })

    await expect(commentText).toHaveText(originalText)
    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(2)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
    })

    await expect(commentText).toHaveText(originalText)
    await expect(translate).toHaveCount(0)
  })

  test('does not offer to translate a comment already in the app language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const englishComment = page.locator('.commentThread').filter({
      hasText: "We're so honored that the first ever YouTube video was filmed here!"
    })
    await expect(englishComment).toBeVisible()
    await expect(englishComment.locator(':scope > .commentTranslation .commentTranslationButton')).toHaveCount(0)
  })

  test('does not offer to translate comments in an ignored language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = window.$store
      await Promise.all([
        store.dispatch('updateCurrentLocale', 'de-DE'),
        store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
      ])
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.commentTranslationButton')).toHaveCount(0)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', [])
    })
    await expect(page.locator('.commentTranslationButton').first()).toBeVisible()
  })

  test('disables comment translations globally and restarts detection when re-enabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    const translationButtons = page.locator('.commentTranslationButton')
    await expect(translationButtons.first()).toBeVisible()

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateEnableCommentTranslations', false)
    })
    await expect(translationButtons).toHaveCount(0)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateEnableCommentTranslations', true)
    })
    await expect(translationButtons.first()).toBeVisible()
  })

  test('loads collapsed replies from the video uploader while filtering', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page, { creatorReply: true, ownerReply: true })
    await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.getMoreComments')).toHaveCount(1)

    const ownerReplyToggle = page.locator('.commentReplyRootToggle').getByRole('button', {
      name: /replies from .+ and others/
    })
    await expect(ownerReplyToggle).toBeVisible()
    await expect(ownerReplyToggle.locator('img.commentReplyOwnerThumbnail')).toBeVisible()
    await expect(ownerReplyToggle.locator('.commentReplyOwnerSeparator')).toHaveText('•')
    await expect(ownerReplyToggle.locator('.commentReplyToggleText')).toHaveText(/\d+ replies/)
    await expect(ownerReplyToggle).not.toContainText('from')
    const ownerReplyThreadWithToggle = page.locator('.commentThread').filter({ has: ownerReplyToggle })
    const ownerReplyThread = page.locator(`#${await ownerReplyThreadWithToggle.getAttribute('id')}`)
    const ownerReplyThreadElement = await ownerReplyThread.elementHandle()
    expect(ownerReplyThreadElement).not.toBeNull()
    await expect(ownerReplyThread.locator('.commentReplyContent')).toHaveCount(0)
    await ownerReplyToggle.scrollIntoViewIfNeeded()
    await attachScreenshot('uploader reply indicator')

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'From creator' }).click()
    await expect.poll(() => ownerReplyThreadElement.evaluate(element => ({
      isConnected: element.isConnected,
      isVisible: element.getClientRects().length > 0,
      loadedReplyCount: element.querySelectorAll('.commentReplyContent').length
    }))).toEqual({ isConnected: true, isVisible: true, loadedReplyCount: 0 })
    await expect(ownerReplyToggle).toBeVisible()
    await ownerReplyToggle.click()
    await expect.poll(() => ownerReplyThread.evaluate(element => {
      const replies = [...element.querySelectorAll('.commentReplyContent')]
      return replies.length > 0 && replies.every(reply => reply.querySelector('.commentOwner'))
    })).toBe(true)
    await ownerReplyThreadElement.dispose()
  })

  for (const scale of [100, 125]) {
    test(`toggles comment thread lines with mouse and keyboard at ${scale}% scale`, async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.evaluate(async scale => {
        const store = window.$store
        await store.dispatch('updateUiScale', scale)
        await store.dispatch('updateBaseTheme', scale === 100 ? 'dark' : 'light')
      }, scale)
      await page.locator('.getCommentsTitle').click()
      await expect(page.locator('.commentsTitle')).toBeVisible()

      const thread = page.locator('.commentThread').first()
      const line = thread.locator(':scope > .commentThreadLineToggle')
      await expect(line).toHaveAttribute('aria-expanded', 'false')
      await page.mouse.move(0, 0)
      const restingColor = await thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)
      await line.hover({ position: { x: 10, y: 5 } })
      await expect(line).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await line.click({ position: { x: 10, y: 5 } })
      await expect(line).toHaveAttribute('aria-expanded', 'true')
      await expect(thread.locator('.commentReplyContent').first()).toBeVisible()
      const replyCount = await thread.locator('.commentReplyContent').count()

      const connector = thread.locator('.commentReplyConnectorToggle').first()
      await connector.hover()
      await expect(connector).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => connector.evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.locator(':scope > .commentReplies > .commentReplyContinuation').last().evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await connector.click()
      await expect(thread.locator('.commentReplyContent')).toHaveCount(0)
      await line.focus()
      await line.press('Enter')
      await expect(thread.locator('.commentReplyContent')).toHaveCount(replyCount)
      await line.press('Space')
      await expect(thread.locator('.commentReplyContent')).toHaveCount(0)
      await line.press('Enter')

      // Give one loaded reply children so the same controls are exercised at a
      // second depth without relying on YouTube's changing reply structure.
      const branch = thread.locator('.commentReplyBranchRoot').first()
      await branch.evaluate(element => {
        const find = vnode => {
          if (vnode?.component?.subTree?.el === element) return vnode.component
          if (vnode?.component?.subTree) {
            const match = find(vnode.component.subTree)
            if (match) return match
          }
          for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
            const match = find(child)
            if (match) return match
          }
          return null
        }
        const component = find(document.querySelector('#app').__vue_app__._container._vnode)
        const reply = component.props.node.reply
        reply.replies = Array.from({ length: 8 }, (_, index) => ({
          ...reply,
          id: `thread-line-child-${index}`,
          text: `Nested reply ${index}`,
          replies: [],
          numReplies: 0,
          hasReplyToken: false,
        }))
        reply.numReplies = 8
        reply.hasReplyToken = false
      })
      const nestedLine = branch.locator(':scope > .commentReplyLineToggle')
      const children = branch.locator('.commentReplyChildren .commentReplyContent')
      await expect(children).toHaveCount(8)
      await expect(thread.locator('.commentReplyContinuationButton').filter({ hasText: /^Hide / })).toHaveCount(1)
      await line.evaluate(element => element.blur())
      await nestedLine.hover({ position: { x: 10, y: 5 } })
      await expect(nestedLine).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => branch.locator('.commentReplyChildStem').evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await attachScreenshot(`comment thread line hover at ${scale}%`)
      await nestedLine.click({ position: { x: 10, y: 5 } })
      await expect(children).toHaveCount(0)
      await expect(thread.locator('.commentReplyContent')).toHaveCount(replyCount)
      await nestedLine.focus()
      await nestedLine.press('Space')
      await expect(children).toHaveCount(8)
      await nestedLine.evaluate(element => element.blur())
      const nestedConnector = branch.locator('.commentReplyChildren .commentReplyConnectorToggle').first()
      await nestedConnector.hover()
      await expect.poll(() => branch.locator('.commentReplyChildStem').evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).toBe(restingColor)
      await nestedConnector.click()
      await expect(children).toHaveCount(0)
      await branch.locator(':scope > .commentReplyChildren > .commentReplyContinuation button').click()
      await expect(children).toHaveCount(8)

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })
      const scroller = page.locator('.fullscreenCommentsOverlay.open .commentsContentWrapper')
      for (const toggle of [nestedLine, line]) {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        const previousScrollTop = await scroller.evaluate(element => element.scrollTop)
        expect(previousScrollTop).toBeGreaterThan(0)
        await toggle.evaluate(element => element.click())
        await expect.poll(() => scroller.evaluate((element, previousScrollTop) => {
          const content = element.querySelector(':scope > div')
          const maximumScrollTop = Math.max(0, element.scrollTop +
            content.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom)
          const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
          return {
            reduced: element.scrollTop < previousScrollTop,
            scrollbarMatchesOverflow: scrollbar.classList.contains('os-scrollbar-visible') === (maximumScrollTop > 1),
          }
        }, previousScrollTop)).toEqual({ reduced: true, scrollbarMatchesOverflow: true })
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector(':scope > div')
          return element.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom
        // The clamp uses integer layout offsets and heights; their rounding
        // can add up to more than one CSS pixel at fractional Electron zoom.
        })).toBeLessThanOrEqual(2)
      }
    })
  }

  test('searches the comments loaded for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.commentThread')
    const initialCommentCount = await comments.count()
    expect(initialCommentCount).toBeGreaterThan(1)

    await expect(page.getByRole('searchbox', { name: 'Search loaded comments' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const searchFilter = page.getByRole('checkbox', { name: 'Search loaded comments' })
    await expect(searchFilter).toBeFocused()
    await searchFilter.click()
    const commentSearchInput = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await expect(commentSearchInput).toBeFocused()
    await expect(page.locator('.commentTools .clearInputTextButton')).toHaveCount(0)
    await expectCommentHeaderToolsAligned(page)
    await expect.poll(() => page.locator('.commentTools .ft-input-component').evaluate(element => {
      const parent = element.parentElement
      const style = getComputedStyle(parent)
      return Math.abs(parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - element.getBoundingClientRect().width)
    })).toBeLessThanOrEqual(1)
    await commentSearchInput.fill('honored')

    const searchCancelButtonStyles = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      const baseRule = rules.find(rule => (
        rule.selectorText?.includes('input[type="search"]::-webkit-search-cancel-button') &&
        !rule.selectorText.includes(':hover') &&
        !rule.selectorText.includes(':active')
      ))
      const hoverRule = rules.find(rule => rule.selectorText?.includes('::-webkit-search-cancel-button:hover'))

      return {
        appearance: baseRule?.style.getPropertyValue('-webkit-appearance'),
        backgroundColor: baseRule?.style.backgroundColor,
        blockSize: baseRule?.style.blockSize,
        hoverBackgroundColor: hoverRule?.style.backgroundColor,
        inlineSize: baseRule?.style.inlineSize,
        maskSize: baseRule?.style.maskSize
      }
    })
    expect(searchCancelButtonStyles).toEqual({
      appearance: 'none',
      backgroundColor: 'var(--secondary-text-color)',
      blockSize: '24px',
      hoverBackgroundColor: 'var(--primary-color)',
      inlineSize: '24px',
      maskSize: '12px 12px',
    })

    await expect(comments).toHaveCount(1)
    await expect(comments).toContainText("We're so honored that the first ever YouTube video was filmed here!")
    await expect(comments.locator('.commentText mark')).toHaveText('honored')
    await expect(page.getByText(`1 of ${initialCommentCount} loaded comments`)).toBeVisible()

    await commentSearchInput.fill('WahilPro')
    await expect(comments).toHaveCount(1)
    await expect(comments.locator('.commentAuthor mark')).toHaveText('WahilPro')
  })

  test('searches loaded replies and keeps their parent thread', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const thread = page.locator('.commentThread').first()
    await thread.locator('.commentReplyRootToggle button').click()
    const firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    await page.getByRole('searchbox', { name: 'Search loaded comments' }).fill(replyAuthor)

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent .commentAuthor mark')).toHaveText(replyAuthor)
  })

  test('keeps creator-filtered thread lines connected without dangling stems', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { creatorReply: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const thread = page.locator('.commentThread').first()
    await thread.locator('.commentReplyRootToggle button').click()
    const firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    await firstReply.evaluate(element => {
      const branch = element.closest('.commentReplyBranch')
      const app = document.querySelector('#app')?.__vue_app__
      const find = vnode => {
        if (vnode?.component?.subTree?.el === branch) return vnode.component
        if (vnode?.component?.subTree) {
          const match = find(vnode.component.subTree)
          if (match) return match
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = find(child)
            if (match) return match
          }
        }
        return null
      }
      const replyComponent = find(app?._container?._vnode)
      if (!replyComponent) throw new Error('Unable to access the comment reply')
      replyComponent.props.node.reply.hasReplyToken = true
    })
    await expect(firstReply.locator(':scope > .commentReplyChildStem')).toHaveCount(1)

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'From creator' }).click()

    const filteredReplyThread = page.locator('.commentThread').filter({
      has: page.locator('.commentReplyContent')
    })
    await expect(filteredReplyThread).toHaveCount(1)
    await expect(filteredReplyThread.locator('.commentReplyContent')).toHaveCount(1)
    await expect(filteredReplyThread.locator('.commentReplyChildStem')).toHaveCount(0)

    const expectLineToEndAtLastConnectorStart = () => expect.poll(() => filteredReplyThread.evaluate(element => {
      const lineStyle = getComputedStyle(element, '::before')
      const lineEnd = element.getBoundingClientRect().bottom - Number.parseFloat(lineStyle.insetBlockEnd)
      const connectors = element.querySelectorAll(
        ':scope > .commentReplies > .commentReplyBranchRoot > .commentReplyConnector'
      )
      const connectorStart = connectors.item(connectors.length - 1).getBoundingClientRect().top
      return Math.abs(lineEnd - connectorStart)
    })).toBeLessThanOrEqual(0.5)

    await expectLineToEndAtLastConnectorStart()
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateUiScale', 125)
    })
    await expectLineToEndAtLastConnectorStart()
  })

  test('filters comments with timestamps and keeps highlighted timestamps clickable', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { commentTimestamp: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Contains timestamps' }).click()
    await expect(page.locator('.commentThread')).toHaveCount(1)

    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    const search = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await search.fill('0:05')
    const timestamp = page.locator('.commentThread .commentText a[data-time="5"]')
    await expect(timestamp.locator('mark')).toHaveText('0:05')

    const video = page.locator('video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 0
    })
    await timestamp.locator('mark').click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 1)
  })

  test('keeps personal comment pins for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const initialCommentsResponsePromise = page.waitForResponse(response => {
      if (!/\/youtubei\/v1\/next/.test(response.url())) return false
      return Boolean(JSON.parse(response.request().postData() ?? '{}').continuation)
    }, { timeout: 30_000 })
    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    const initialCommentsResponse = await initialCommentsResponsePromise
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const pinnedComment = page.locator('.commentThread').filter({ hasText: 'Who is here today?' })
    await pinnedComment.getByRole('button', { name: 'Pin comment by @WahilPro' }).click()
    await expect(pinnedComment).toContainText('Pinned by you')
    await expect(pinnedComment.getByRole('button', { name: 'Unpin comment by @WahilPro' })).toHaveAttribute('aria-pressed', 'true')
    await expect(pinnedComment).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(pinnedComment.locator('.commentPersonalPin')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')

    const commentsWithoutPinned = await initialCommentsResponse.json()
    const mutations = commentsWithoutPinned.frameworkUpdates.entityBatchUpdate.mutations
    const pinnedMutation = mutations.find(mutation => {
      return mutation.payload?.commentEntityPayload?.properties?.content?.content === 'Who is here today?'
    })
    const pinnedCommentId = pinnedMutation.payload.commentEntityPayload.properties.commentId
    commentsWithoutPinned.frameworkUpdates.entityBatchUpdate.mutations = mutations.filter(mutation => {
      return mutation.payload?.commentEntityPayload?.properties?.commentId !== pinnedCommentId
    })
    for (const endpoint of commentsWithoutPinned.onResponseReceivedEndpoints) {
      const command = endpoint.reloadContinuationItemsCommand ?? endpoint.appendContinuationItemsAction
      if (!Array.isArray(command?.continuationItems)) continue

      command.continuationItems = command.continuationItems.filter(item => {
        return item.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentId !== pinnedCommentId
      })
    }
    expect(JSON.stringify(commentsWithoutPinned)).not.toContain('Who is here today?')

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(commentsWithoutPinned)
    }), { times: 1 })
    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    await expect(pinnedComment).toHaveCount(1)
    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')
    await expect(page.locator('.commentThread').first()).toContainText('Pinned by you')
  })

  test('keeps personal pins on loaded replies', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    let thread = page.locator('.commentThread').first()
    const parentAuthor = await thread.locator(':scope > .commentAuthorWrapper .commentAuthor').innerText()
    await thread.locator('.commentReplyRootToggle button').click()
    let firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(firstReply).toContainText('Pinned by you')
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    await expect(thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'false')

    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    thread = page.locator('.commentThread').first()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    const parentPinButton = thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })
    await expect(parentPinButton).toHaveAttribute('aria-pressed', 'false')
    await thread.locator('.commentReplyRootToggle button').click()
    firstReply = thread.locator('.commentReplyContent').filter({ hasText: replyAuthor })
    const replyUnpinButton = firstReply.getByRole('button', { name: `Unpin comment by ${replyAuthor}` })
    await expect(replyUnpinButton).toHaveAttribute('aria-pressed', 'true')
    await expect(firstReply).toContainText('Pinned by you')

    await replyUnpinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toHaveCount(0)
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')

    await parentPinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('Pinned by you')
    await expect(thread.getByRole('button', { name: `Unpin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'true')
  })

  test('filters loaded comments to the video creator', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const creatorFilter = page.getByRole('checkbox', { name: 'From creator' })
    await expect(creatorFilter.locator('img.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
    await creatorFilter.click()

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentThread')).toContainText('@jawed')
    await expect(page.locator('.commentThread')).toContainText('Hello')
  })

  test('applies the shortened view count setting to comment likes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toContainText(/4\.6\s?m/i)

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateShortenViewCounts', false)
    })
    await expect(commentLikes).toContainText('4,600,000')
  })

  test('renders whitespace-only zero like counts as zero', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { blankCommentLikes: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toHaveText('0')
  })

  test.describe('comment filtering at 125% UI scale', () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          generalAutoLoadMorePaginatedItemsEnabled: false,
          uiScale: 125
        },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#d50000',
          textColor: '#FFFFFF',
          subscriptions: []
        }, {
          _id: 'commentPinsProfile',
          name: 'Comment pins profile',
          bgColor: '#558B2F',
          textColor: '#FFFFFF',
          subscriptions: []
        }]
      }
    })

    test('clamps fullscreen comment scrolling after switching pin storage groups', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)

      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await loadComments.click()
      await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

      const liveCommentCount = await page.locator('.commentThread').count()
      const persistedCommentCount = 20
      await page.evaluate(({ persistedCommentCount }) => {
        const commentSnapshots = Array.from({ length: persistedCommentCount }, (_, index) => ({
          id: `persisted-comment-${index}`,
          author: `@PersistedAuthor${index}`,
          authorId: `UC-persisted-${index}`,
          authorLink: `UC-persisted-${index}`,
          authorThumb: '',
          dataType: 'local',
          hasOwnerReplied: false,
          hasReplyToken: false,
          isEdited: false,
          isHearted: false,
          isMember: false,
          isOwner: false,
          isPinned: false,
          likes: 0,
          memberIconUrl: '',
          numReplies: 0,
          published: 0,
          replies: [],
          showReplies: false,
          text: `Persisted pinned comment ${index}`,
          time: 'now',
          translationText: ''
        }))
        localStorage.setItem('opentubex-comment-pins', JSON.stringify({
          'allChannels:video:jNQXAC9IVRw': {
            commentIds: commentSnapshots.map(comment => comment.id),
            commentSnapshots
          }
        }))
      }, { persistedCommentCount })

      await page.evaluate(() => {
        const store = window.$store
        return store.dispatch('updateActiveProfile', 'commentPinsProfile')
      })
      await expect.poll(() => page.evaluate(() => {
        const store = window.$store
        return store.getters.getActiveProfile._id
      })).toBe('commentPinsProfile')
      await page.evaluate(() => {
        const store = window.$store
        return store.dispatch('updateActiveProfile', 'allChannels')
      })
      await expect(page.locator('.commentThread')).toHaveCount(liveCommentCount + persistedCommentCount)

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })

      const dock = page.locator('.fullscreenCommentsOverlay.open')
      const scroller = dock.locator('.commentsContentWrapper')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      const commentsList = dock.locator('.commentThread').first().locator('..')
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      const previousContentHeight = await commentsList.evaluate(element => element.offsetHeight)

      await page.evaluate(() => {
        const store = window.$store
        return store.dispatch('updateActiveProfile', 'commentPinsProfile')
      })
      await expect(dock.locator('.commentThread')).toHaveCount(liveCommentCount)
      await expect.poll(() => commentsList.evaluate(element => element.offsetHeight))
        .toBeLessThan(previousContentHeight)
      await expect.poll(() => scroller.evaluate(element => {
        const contentElement = element.querySelector('.commentThread')?.parentElement
        if (!contentElement) return false

        const viewportBounds = element.getBoundingClientRect()
        const contentBounds = contentElement.getBoundingClientRect()
        const contentMarginBlockEnd = Number.parseFloat(getComputedStyle(contentElement).marginBlockEnd) || 0
        const viewportPaddingBottom = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0
        const renderedEndGap = viewportBounds.bottom - contentBounds.bottom
        return Math.abs(renderedEndGap - contentMarginBlockEnd - viewportPaddingBottom) <= 1
      })).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    })

    test('clamps fullscreen comment scrolling after creator and search filtering', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)

      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await loadComments.click()
      await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: 'Filter loaded comments' }).click()
      await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await expectCommentHeaderToolsAligned(page)
      await page.getByRole('searchbox', { name: 'Search loaded comments' }).press('Escape')

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })

      const dock = page.locator('.fullscreenCommentsOverlay.open')
      const scroller = dock.locator('.commentsContentWrapper')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect(dock.getByRole('checkbox', { name: 'From creator' }).locator('img.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      const creatorFilter = dock.getByRole('checkbox', { name: 'From creator' })
      await creatorFilter.click()

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

      await creatorFilter.click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await dock.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await dock.getByRole('searchbox', { name: 'Search loaded comments' }).fill('honored')

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    })
  })

  test('stale reply controls disappear after an empty final reply page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.comment')
    const commentIndex = await comments.evaluateAll(elements => (
      elements.findIndex(element => element.querySelector('.commentReplyRootToggle'))
    ))
    expect(commentIndex).toBeGreaterThanOrEqual(0)
    const comment = comments.nth(commentIndex)
    const replyToggleRow = comment.locator('.commentReplyRootToggle')
    const replyToggle = replyToggleRow.locator('.commentReplyContinuationButton')
    await expect(replyToggle).toBeVisible()
    await expect(replyToggle).not.toContainText('View')
    await expect(replyToggle.locator('svg')).toBeVisible()
    expect(await replyToggleRow.evaluate(element => (
      getComputedStyle(element, '::before').borderInlineStartWidth
    ))).toBe('1px')
    expect(await comment.evaluate((element) => {
      const toggle = element.querySelector('.commentReplyRootToggle')
      const stemStyle = getComputedStyle(element, '::before')
      const connectorStyle = getComputedStyle(toggle, '::before')
      const stemBottom = element.getBoundingClientRect().bottom - Number.parseFloat(stemStyle.insetBlockEnd)
      const connectorTop = toggle.getBoundingClientRect().top +
        Number.parseFloat(connectorStyle.insetBlockStart)
      return Math.abs(stemBottom - connectorTop)
    })).toBeLessThanOrEqual(0.5)

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onResponseReceivedEndpoints: [{
          appendContinuationItemsAction: {
            targetId: 'comment-replies-item-stale'
          }
        }]
      })
    }), { times: 1 })

    await replyToggle.click()

    await expect(comment.locator('.commentReplyRootToggle')).toHaveCount(0)
    await expect(comment).not.toHaveClass(/commentThreadCollapsed/)
    await expect(comment.locator('.commentReplyBranch')).toHaveCount(0)
  })

  test('reloading fullscreen comments scrolls back to the first comment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await waitForPlayback(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)

    // The end of the loaded comments: the offset the reloaded, shorter list has
    // no room for, so it used to leave the dock parked past its own content.
    await comments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)

    const [reloadResponse] = await Promise.all([
      page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 }),
      page.locator('.fullscreenCommentHeader').getByRole('button', { name: 'Reload Comments' }).click()
    ])
    expect(reloadResponse.ok()).toBe(true)
    await expect(page.locator('.fullscreenCommentsOverlay .comment').first()).toBeVisible({ timeout: 30_000 })

    // OverlayScrollbars reapplies its remembered offset once the new list has
    // rendered, so the position has to still be at the top a moment later.
    await page.waitForTimeout(1000)
    expect(await comments.evaluate((element) => element.scrollTop)).toBe(0)
  })
})
