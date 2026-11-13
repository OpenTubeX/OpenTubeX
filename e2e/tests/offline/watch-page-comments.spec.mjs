import { readDatastore, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { emptyCommentsResponse, mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('treats an empty comments response as no comments', { tag: '@scale' }, async ({ app, page }) => {
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
      body: emptyCommentsResponse
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

  await setWindowSize(app, page, { width: 375, height: 800 })
  await page.locator('.app').evaluate((element) => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
  })
  await (await watchViewHandle(page)).evaluate(view => view.openPhonePanel('comments'))
  await expect(page.locator('.mobileSheet[open] .noComments')).toBeVisible()

  await expect(page.locator('.mobileSheet[open] .noCommentActions')).toHaveCount(0)
  await expect.poll(() => page.locator('.mobileSheet[open] .noComments').evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false)
  await expect(page.locator('.mobileSheet[open]').getByRole('button', { name: 'Reload Comments', exact: true })).toHaveCount(1)
  await expect(page.locator('.mobileSheet[open]').getByRole('button', { name: /^sort by$/i })).toHaveCount(1)
  await setWindowSize(app, page, { width: 800, height: 375 })
  await expect(page.locator('.mobileSheet[open] .noCommentActions')).toHaveCount(0)
  await expect.poll(() => page.locator('.mobileSheet[open] .noComments').evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false)
  await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
  expect(commentRequestCount).toBe(1)

  // Without comments, shortening or closing a long comment draft at the
  // bottom shortens the panel too.
  await page.evaluate(() => window.$store.dispatch('updateYouTubeAccount', {
    credentials: { access_token: 'token', refresh_token: 'token', expiry_date: new Date(Date.now() + 3_600_000).toISOString(), client: { client_id: 'id', client_secret: 'secret' } },
    profiles: [{ name: 'Commenter', handle: null, thumbnail: null, pageId: null }],
    pageId: null,
    channelId: null
  }))
  const sheet = page.locator('.mobileSheet[open]')
  const scroller = sheet.locator('.commentsContentWrapper')
  const expectScrollInRange = () => expect.poll(() => scroller.evaluate(element => {
    // No empty space below the last rendered content, unless it all fits.
    const contentEnd = Math.max(...[...element.children]
      .filter(child => !child.classList.contains('os-scrollbar'))
      .map(child => child.getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(child).marginBlockEnd) || 0))) +
      (Number.parseFloat(getComputedStyle(element).paddingBottom) || 0)
    return element.scrollTop + element.clientHeight <= element.scrollHeight + 1 &&
      element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1 &&
      (element.scrollTop <= 1 || contentEnd >= element.getBoundingClientRect().bottom - 1)
  })).toBe(true)
  const scrollToBottom = async () => {
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  }
  const longDraft = Array.from({ length: 30 }, (_, line) => `Line ${line + 1}`).join('\n')
  await sheet.getByRole('button', { name: 'Add a comment' }).click()
  const draft = sheet.locator('.topCommentComposer textarea')
  await draft.fill(longDraft)
  await scrollToBottom()
  await draft.fill('Short comment')
  await expectScrollInRange()

  await draft.fill(longDraft)
  await scrollToBottom()
  await sheet.locator('.topCommentComposer').getByRole('button', { name: 'Cancel' }).click()
  await expect(draft).toHaveCount(0)
  await expectScrollInRange()
})

const headerOnlyResponse = JSON.parse(emptyCommentsResponse)
headerOnlyResponse.onResponseReceivedEndpoints.pop()
headerOnlyResponse.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems[0].commentsHeaderRenderer.countText.simpleText = '123 Comments'

for (const trigger of ['initial load', 'newest reload']) {
  test(`incomplete comments during ${trigger} stay retryable instead of reporting no comments`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => window.$store.dispatch('updateBackendFallback', false))
    const initialLoad = trigger === 'initial load'
    let fail = initialLoad
    let headerOnly = false
    let failedRequests = 0
    let failedContinuation
    let lastContinuation
    let loadedResponse
    const firstResponse = trigger === 'newest reload'
      ? page.waitForResponse(response =>
          response.url().includes('/youtubei/v1/next') && JSON.parse(response.request().postData() ?? '{}').continuation
        )
      : null
    await page.route(/\/youtubei\/v1\/next/, (route, request) => {
      const { continuation } = JSON.parse(request.postData() ?? '{}')
      if (!continuation) return route.fallback()
      lastContinuation = continuation
      // Replay the recorded comments when retrying a sort whose page is not recorded.
      if (!fail) {
        return loadedResponse
          ? route.fulfill({ status: 200, contentType: 'application/json', body: loadedResponse })
          : route.fallback()
      }
      failedRequests++
      failedContinuation = continuation
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: headerOnly ? JSON.stringify(headerOnlyResponse) : '{}'
      })
    })
    await openMockedVideo(page)
    if (firstResponse) loadedResponse = await (await firstResponse).text()
    const sort = async () => {
      await page.locator('.commentHeaderActions').getByRole('combobox').click()
      await page.getByRole('option', { name: /^newest first$/i }).click()
    }
    if (trigger === 'newest reload') {
      const data = JSON.parse(loadedResponse)
      const items = data.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems[0]
        .commentsHeaderRenderer.sortMenu.sortFilterSubMenuRenderer.subMenuItems
      items.forEach((item, index) => { item.selected = index === 1 })
      loadedResponse = JSON.stringify(data)
      await sort()
      await expect(page.locator('.comment').first()).toBeVisible()
    }
    if (!initialLoad) {
      await expect(page.locator('.comment').first()).toBeVisible()
      fail = true
      await page.getByRole('button', { name: 'Reload Comments', exact: true }).click()
    }
    await expect(page.locator('.getCommentsTitle')).toBeVisible()
    await expect(page.locator('.noCommentMsg')).toHaveCount(0)
    await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    expect(failedRequests).toBe(1)
    if (trigger === 'newest reload') {
      headerOnly = true
      await page.locator('.getCommentsTitle').click()
      await expect(page.locator('.getCommentsTitle')).toBeVisible()
      expect(failedRequests).toBe(2)
      const data = JSON.parse(loadedResponse)
      delete data.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems[0].commentsHeaderRenderer.sortMenu
      loadedResponse = JSON.stringify(data)
    }
    fail = false
    await page.locator('.getCommentsTitle').click()
    await expect(page.locator('.comment').first()).toBeVisible()
    await expect(page.locator('.noCommentMsg')).toHaveCount(0)
    await expect(page.locator('.commentsTitle')).not.toHaveText(/^0 Comments/)
    if (trigger === 'newest reload') {
      expect(lastContinuation).toBe(failedContinuation)
      await expect(page.locator('.commentHeaderActions .selectedValue')).toHaveText(/^newest first$/i)
      await page.getByRole('button', { name: 'Reload Comments', exact: true }).click()
      await expect(page.locator('.comment').first()).toBeVisible()
      await expect(page.locator('.commentHeaderActions .selectedValue')).toHaveText(/^newest first$/i)
      const newestContinuation = lastContinuation
      await page.locator('.commentHeaderActions').getByRole('combobox').click()
      await page.getByRole('option', { name: /^top comments$/i }).click()
      await expect.poll(() => lastContinuation).not.toBe(newestContinuation)
      await expect(page.locator('.comment').first()).toBeVisible()
    }
  })
}

test('loads initial comments with the video when automatic pagination is enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setAutoLoadComments', true)
  })
  // Initial comments must not depend on the later-page sentinel being visible.
  await page.addStyleTag({ content: '.commentAutoLoadSentinel { display: none !important; }' })

  await openMockedVideo(page)

  await expect(page.locator('.getCommentsTitle')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('.commentsTitle')).toBeVisible()
  await expect(page.locator('.getMoreComments')).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('does not retry a failed automatic comment load until asked', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, (route, request) => {
    if (!JSON.parse(request.postData() ?? '{}').continuation) return route.fallback()
    commentRequestCount++
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.evaluate(async () => {
    const store = window.$store
    store.commit('setAutoLoadComments', true)
    await store.dispatch('updateBackendFallback', false)
  })

  await openMockedVideo(page)
  const loadComments = page.locator('.getCommentsTitle')
  await expect(loadComments).toBeVisible()
  await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()
  // The sentinel remounts with the button and reports itself visible within a
  // few frames, which used to start the next attempt at once.
  await page.evaluate(() => new Promise(resolve => {
    let frames = 10
    const step = () => (--frames ? requestAnimationFrame(step) : resolve())
    requestAnimationFrame(step)
  }))
  await expect(page.locator('.commentLoader')).toHaveCount(0)
  await expect(loadComments).toBeVisible()
  expect(commentRequestCount).toBe(1)

  await loadComments.click()
  await expect.poll(() => commentRequestCount).toBe(2)
  await expect(loadComments).toBeVisible()
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
        autoLoadComments: false
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

  test('activates the view, hide, and load more buttons with the keyboard without toggling playback', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const video = await waitForPlayback(page)
    const viewComments = page.locator('.getCommentsTitle')
    const comments = page.locator('.commentThread')

    const firstPageResponse = page.waitForResponse(response =>
      response.url().includes('/youtubei/v1/next') && JSON.parse(response.request().postData() ?? '{}').continuation
    )
    await viewComments.press('Space')
    const firstPage = await (await firstPageResponse).json()
    await expect(page.locator('.commentsTitle')).toBeVisible()
    await page.locator('.commentTitleAction').press('Space')
    await expect(comments).toHaveCount(0)
    await viewComments.press('Enter')
    await expect(comments.first()).toBeVisible()

    const secondPageComment = firstPage.onResponseReceivedEndpoints[1].reloadContinuationItemsCommand.continuationItems
      .find(item => item.commentThreadRenderer)
    secondPageComment.commentThreadRenderer.commentViewModel.commentViewModel.commentId += '-next-page'
    await page.route(/\/youtubei\/v1\/next/, (route, request) => {
      if (!JSON.parse(request.postData() ?? '{}').continuation) return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { targetId: 'comments-section', continuationItems: [secondPageComment] } }],
          frameworkUpdates: firstPage.frameworkUpdates
        })
      })
    })
    const loadedCommentCount = await comments.count()
    const loadMoreRequest = page.waitForRequest(request => /\/youtubei\/v1\/next/.test(request.url()) && !!request.postDataJSON()?.continuation)
    await page.locator('.getMoreComments').press('Space')
    await loadMoreRequest
    await expect.poll(() => comments.count()).toBeGreaterThan(loadedCommentCount)

    expect(await video.evaluate(element => element.paused)).toBe(false)
  })

  test('toggles comment thread lines with mouse and keyboard at 125% scale', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 125)
      await store.dispatch('updateBaseTheme', 'light')
    })
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
    // Replies sit on the page background; only the thread lines group them.
    await expect(thread.locator(':scope > .commentReplies')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
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
    await attachScreenshot('comment thread line hover at 125%')
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
      const close = parent.querySelector('.commentSearchClose').getBoundingClientRect()
      return Math.abs(parent.clientWidth - parseFloat(style.columnGap) - close.width - element.getBoundingClientRect().width)
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

  test('drops a queued comment rating after signing in to another account', async ({ app, page }) => {
    const signIn = name => page.evaluate(name => window.$store.dispatch('updateYouTubeAccount', {
      credentials: { access_token: `${name}-access`, refresh_token: `${name}-refresh`, expiry_date: new Date(Date.now() + 3_600_000).toISOString(), client: { client_id: 'id', client_secret: 'secret' } },
      profiles: [{ name, handle: null, thumbnail: null, pageId: null }],
      pageId: null,
      channelId: null
    }), name)
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await signIn('first')

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const requests = []
    const { promise: firstRatingHeld, resolve: releaseFirstRating } = Promise.withResolvers()
    await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, async (route, request) => {
      requests.push({ authorization: request.headers().authorization, action: JSON.parse(request.postData()).actions[0] })
      if (requests.length === 1) await firstRatingHeld
      // The first account's like goes through and the second account's fails.
      const status = requests.length === 1 ? 'STATUS_SUCCEEDED' : 'STATUS_FAILED'
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ actionResults: [{ status }] }) })
    })

    const like = page.locator('.commentAccountAction[aria-pressed]').first()
    await like.click()
    await expect.poll(() => requests.length).toBe(1)
    // The unlike waits behind the first like, and both accounts use the
    // Google account's own channel.
    await like.click()
    await signIn('second')
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    // Ratings go out in order, so the unlike would go before this like.
    await like.click()
    await expect(like).toHaveAttribute('aria-pressed', 'true')
    releaseFirstRating()

    await expect.poll(() => requests.length).toBe(2)
    expect(requests.map(entry => entry.authorization)).toEqual(['Bearer first-access', 'Bearer second-access'])
    expect(requests[1].action).toBe(requests[0].action)
    // The failed like shows the second account's own rating, not the first account's like.
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(requests).toHaveLength(2)
  })

  test.describe('comment filtering at 125% UI scale', () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          autoLoadComments: false,
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
      const search = dock.getByRole('searchbox', { name: 'Search loaded comments' })
      await search.fill('honored')

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

      // Deleting your own comment from the bottom shortens the list too.
      await search.fill('')
      await search.press('Escape')
      const lastThread = dock.locator('.commentThread').last()
      const authorId = (await lastThread.locator('a[href*="/channel/"]').first().getAttribute('href')).split('/channel/')[1]
      await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, (route, request) => {
        // The action's third field is the comment ID.
        const action = [...Buffer.from(decodeURIComponent(JSON.parse(request.postData()).actions[0]), 'base64')]
        const commentId = Buffer.from(action.slice(6, 6 + action[5])).toString()
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ actions: [{ removeCommentAction: { commentId, actionResult: { status: 'STATUS_SUCCEEDED' } } }] })
        })
      })
      await page.evaluate(channelId => window.$store.dispatch('updateYouTubeAccount', {
        credentials: { access_token: 'token', refresh_token: 'token', expiry_date: new Date(Date.now() + 3_600_000).toISOString(), client: { client_id: 'id', client_secret: 'secret' } },
        profiles: [{ name: 'Commenter', handle: null, thumbnail: null, pageId: null }],
        pageId: null,
        channelId
      }), authorId)
      const expectScrollInRange = () => expect.poll(() => scroller.evaluate(element => (
        element.scrollTop + element.clientHeight <= element.scrollHeight + 1 &&
        element.scrollTop <= element.scrollHeight - element.clientHeight + 1
      ))).toBe(true)

      // So do shortening and closing a long reply at the bottom.
      const longReply = Array.from({ length: 30 }, (_, line) => `Line ${line + 1}`).join('\n')
      await lastThread.getByRole('button', { name: 'Reply', exact: true }).click()
      const replyInput = lastThread.locator('.replyComposer textarea')
      await replyInput.fill(longReply)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await replyInput.fill('Short reply')
      await expectScrollInRange()

      await replyInput.fill(longReply)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await lastThread.locator('.replyComposer').getByRole('button', { name: 'Cancel' }).click()
      await expect(lastThread.locator('.replyComposer')).toHaveCount(0)
      await expectScrollInRange()

      const threadCount = await dock.locator('.commentThread').count()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await lastThread.getByRole('button', { name: 'Delete comment' }).first().click()
      await page.locator('.prompt').getByRole('button', { name: 'Delete comment', includeHidden: true }).click({ force: true })
      await expect(dock.locator('.commentThread')).toHaveCount(threadCount - 1)
      await expectScrollInRange()
      await expect.poll(() => scroller.evaluate(element => {
        const list = [...element.querySelectorAll('.commentThread')].at(-1).getBoundingClientRect()
        return Math.round(element.getBoundingClientRect().bottom - list.bottom)
      })).toBeLessThanOrEqual(200)
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

test.describe('Auto Load Comments apart from Auto Load Next Page', () => {
  /** Counts the comment page requests and opens the mocked video. */
  async function openVideoCountingCommentRequests(app, page) {
    await mockPlayableWatchPage(app, page)
    const requests = { count: 0 }
    await page.route(/\/youtubei\/v1\/next/, (route, request) => {
      if (JSON.parse(request.postData() ?? '{}').continuation) requests.count++
      return route.fallback()
    })
    await openMockedVideo(page)
    return requests
  }

  test.describe('with only comments loading automatically', () => {
    test.use({
      seed: {
        settings: { ...WATCH_PAGE_SEED, generalAutoLoadMorePaginatedItemsEnabled: false, autoLoadComments: true }
      }
    })

    test('loads comments without a click', async ({ app, page }) => {
      const requests = await openVideoCountingCommentRequests(app, page)
      await expect(page.locator('.comment').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.getCommentsTitle')).toHaveCount(0)
      expect(requests.count).toBeGreaterThan(0)
    })
  })

  /** @returns {unknown} the saved Auto Load Comments value, if any */
  function storedAutoLoadComments(app) {
    const entry = readDatastore(app.userDataDir, 'settings').split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
      .find(doc => doc._id === 'autoLoadComments')
    return entry?.value
  }

  test.describe('after updating with Auto Load Next Page turned off', () => {
    test.use({
      seed: { settings: { ...WATCH_PAGE_SEED, generalAutoLoadMorePaginatedItemsEnabled: false } }
    })

    test('keeps comments loading manually and saves that choice', async ({ app, page }) => {
      expect(await page.evaluate(() => window.$store.getters.getAutoLoadComments)).toBe(false)
      await expect.poll(() => storedAutoLoadComments(app)).toBe(false)

      const requests = await openVideoCountingCommentRequests(app, page)
      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await expect(loadComments).toBeVisible()
      expect(requests.count).toBe(0)
    })
  })

  test('does not copy a later Auto Load Next Page change to comments', async ({ app, page }) => {
    await expect.poll(() => storedAutoLoadComments(app)).toBe(true)
    await page.evaluate(() => window.$store.dispatch('updateGeneralAutoLoadMorePaginatedItemsEnabled', false))

    const relaunched = await app.relaunch()
    expect(await relaunched.page.evaluate(() => [
      window.$store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled,
      window.$store.getters.getAutoLoadComments
    ])).toEqual([false, true])
  })
})
