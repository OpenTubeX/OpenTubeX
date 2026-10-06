import { setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useSponsorBlock: true,
      sponsorBlockEnableSubmission: true,
      sponsorBlockGeneratedUserId: 'test-contributor',
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
      currentLocale: 'en-US'
    }
  }
})

const timedSegment = {
  UUID: 'original-segment',
  actionType: 'skip',
  category: 'sponsor',
  description: '',
  locked: 0,
  segment: [11, 12],
  videoDuration: 19,
  votes: 1
}

async function openSegments(app, page, segments = [timedSegment]) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
    contentType: 'application/json'
  }))
  await page.route('**/api/userInfo?*', route => route.fulfill({
    body: JSON.stringify({ segmentCount: 1, viewCount: 0, minutesSaved: 0 }),
    contentType: 'application/json'
  }))
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.getByRole('button', { name: 'Open SponsorBlock info', exact: true }).click()
  const panel = page.locator('.watchVideoSponsorBlock')
  await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(segments.length)
  return { panel, video }
}

async function captureThemes(page, component, testInfo, name) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
    await page.evaluate(async pack => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', pack)
    }, scheme === 'dark' ? 'material' : 'remix')
    await component.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) })
  }
}

test('submits category corrections, preserves failed edits, and updates marker colors', async ({ app, page }, testInfo) => {
  const { panel } = await openSegments(app, page)
  const votes = []
  let failVote = true
  let voteGate = null
  await page.route('**/api/voteOnSponsorTime?*', async route => {
    votes.push(Object.fromEntries(new URL(route.request().url()).searchParams))
    if (voteGate) await voteGate
    await route.fulfill({ status: failVote ? 403 : 200, body: failVote ? 'Forbidden' : '' })
  })
  await panel.locator('.sponsorBlockSegmentSummary').click()
  await expect(panel.getByRole('button', { name: 'Change category', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy & downvote', exact: true })).toHaveCount(0)
  await captureThemes(page, panel, testInfo, 'sponsorblock-pencil')
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByRole('button', { name: 'Change category', exact: true }).click()
  const category = panel.locator('select')
  await expect(category.locator('option[value="exclusive_access"]')).toHaveCount(0)
  await expect(category.locator('option[value="poi_highlight"]')).toHaveCount(0)
  await category.selectOption('intro')
  await captureThemes(page, panel, testInfo, 'sponsorblock-category')
  await panel.getByRole('button', { name: 'Submit category vote', exact: true }).click()
  await expect(page.getByText('Failed to submit SponsorBlock vote.', { exact: true })).toBeVisible()
  await expect(category).toHaveValue('intro')
  await expect(panel.locator('.sponsorBlockCategory')).toHaveText('Sponsor')

  failVote = false
  let releaseVote
  voteGate = new Promise(resolve => { releaseVote = resolve })
  await panel.getByRole('button', { name: 'Submit category vote', exact: true }).click()
  await expect.poll(() => votes.length).toBe(2)
  const refresh = panel.getByRole('button', { name: 'Refresh SponsorBlock information', exact: true })
  await expect(refresh).toBeDisabled()
  releaseVote()
  await expect(panel.locator('.sponsorBlockCategory')).toHaveText('Intermission')
  await expect(refresh).toBeEnabled()
  await expect(page.getByText('Category vote submitted.', { exact: true })).toBeVisible()
  expect(votes).toEqual(Array(2).fill({
    UUID: 'original-segment', videoID: 'jNQXAC9IVRw', userID: 'test-contributor', category: 'intro'
  }))
  await expect(page.locator('.sponsorBlockMarker')).toHaveCSS('background-color', 'rgb(0, 188, 212)')
})

test('copies bounds into a new persisted draft and submits only after editing and preview', async ({ app, page }, testInfo) => {
  const { panel, video } = await openSegments(app, page)
  const votes = []
  let submission = null
  await page.route('**/api/voteOnSponsorTime?*', route => {
    votes.push(Object.fromEntries(new URL(route.request().url()).searchParams))
    return route.fulfill({ status: 200 })
  })
  await page.route('**/api/skipSegments', route => {
    submission = route.request().postDataJSON()
    return route.fulfill({
      body: JSON.stringify([{ UUID: 'corrected-segment', category: 'sponsor', actionType: 'skip', segment: [10.722, 12.5] }]),
      contentType: 'application/json'
    })
  })
  await panel.locator('.sponsorBlockSegmentSummary').click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
  const editor = page.locator('.sponsorBlockSubmissionMenu')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Segment start time' })).toHaveValue('0:11.000')
  await expect(editor.getByRole('textbox', { name: 'Segment end time' })).toHaveValue('0:12.000')
  await expect.poll(() => votes.length).toBe(1)
  expect(votes[0]).toEqual({ UUID: 'original-segment', videoID: 'jNQXAC9IVRw', userID: 'test-contributor', type: '0' })
  expect(submission).toBeNull()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSponsorBlockDraftSegmentsByVideoId.jNQXAC9IVRw
  })).toEqual([expect.objectContaining({ startTime: 11, endTime: 12, category: 'sponsor', actionType: 'skip', previewed: false })])

  await editor.getByRole('textbox', { name: 'Segment start time' }).fill('0:10.722')
  await editor.getByRole('textbox', { name: 'Segment end time' }).fill('0:12.500')
  await editor.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(10.722, 3)
  await video.evaluate(element => {
    element.currentTime = 11.2
    element.dispatchEvent(new Event('timeupdate'))
  })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(11.2, 3)
  await expect(page.locator('.valueChangePopup')).toHaveCount(0)
  await captureThemes(page, editor, testInfo, 'sponsorblock-timings')
  await editor.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(editor.locator('.sponsorBlockSubmissionError')).toHaveText('Please preview every segment before submitting.')
  expect(submission).toBeNull()
  await editor.getByRole('button', { name: 'Preview', exact: true }).click()
  await video.evaluate(element => element.pause())
  await editor.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect.poll(() => submission).not.toBeNull()
  expect(submission.segments).toEqual([{ category: 'sponsor', actionType: 'skip', segment: [10.722, 12.5], description: '' }])
  await expect(editor).toHaveCount(0)
})

test('keeps the editable copy when its downvote fails and never toggles an existing downvote', async ({ app, page }) => {
  const { panel } = await openSegments(app, page, [{ ...timedSegment, actionType: 'mute' }])
  const votes = []
  let failVote = true
  await page.route('**/api/voteOnSponsorTime?*', route => {
    votes.push(new URL(route.request().url()).searchParams.get('type'))
    return route.fulfill({ status: failVote ? 500 : 200 })
  })
  await panel.locator('.sponsorBlockSegmentSummary').click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
  const editor = page.locator('.sponsorBlockSubmissionMenu')
  await expect(editor).toBeVisible()
  await expect(page.getByText('Failed to submit SponsorBlock vote.', { exact: true })).toBeVisible()
  await expect(editor.locator('select').nth(1)).toHaveValue('mute')
  await editor.locator('.sponsorBlockSubmissionClose').click()
  failVote = false
  await page.getByRole('button', { name: 'Open SponsorBlock info', exact: true }).click()
  await panel.locator('.sponsorBlockSegmentSummary').click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByRole('button', { name: 'Downvote', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Downvote', exact: true })).toHaveClass(/active/)
  await panel.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
  await expect(editor.locator('.sponsorBlockDraftSegment')).toHaveCount(2)
  expect(votes).toEqual(['0', '0'])
})

test('prevents full-video category votes and copies highlights without an end-time field', async ({ app, page }) => {
  const { panel } = await openSegments(app, page, [
    { ...timedSegment, UUID: 'full-label', category: 'exclusive_access', actionType: 'full', segment: [0, 0] },
    { ...timedSegment, UUID: 'highlight', category: 'poi_highlight', actionType: 'poi', segment: [11, 11] }
  ])
  await page.route('**/api/voteOnSponsorTime?*', route => route.fulfill({ status: 200 }))
  await panel.locator('.sponsorBlockSegmentSummary').first().click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Change category', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy & downvote', exact: true })).toBeVisible()
  await panel.locator('.sponsorBlockSegmentSummary').nth(1).click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Change category', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
  const editor = page.locator('.sponsorBlockSubmissionMenu')
  await expect(editor.getByRole('textbox', { name: 'Segment start time' })).toHaveValue('0:11.000')
  await expect(editor.getByRole('textbox', { name: 'Segment end time' })).toHaveCount(0)
  await expect(editor.locator('select')).toHaveValue('poi_highlight')
})

test('stops muting when a category correction disables the last playback segment', async ({ app, page }) => {
  const { panel, video } = await openSegments(app, page, [{ ...timedSegment, actionType: 'mute' }])
  await page.route('**/api/voteOnSponsorTime?*', route => route.fulfill({ status: 200 }))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSponsorBlockIntro', { color: '#00ffff', skip: 'doNothing' })
  })
  await video.evaluate(element => {
    element.muted = false
    element.currentTime = 11.2
    element.dispatchEvent(new Event('timeupdate'))
  })
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(true)
  await panel.locator('.sponsorBlockSegmentSummary').click()
  await panel.getByRole('button', { name: 'Edit', exact: true }).click()
  await panel.getByRole('button', { name: 'Change category', exact: true }).click()
  await expect(panel.locator('select option[value="music_offtopic"]')).toHaveCount(0)
  await panel.locator('select').selectOption('intro')
  await panel.getByRole('button', { name: 'Submit category vote', exact: true }).click()
  await expect(panel.locator('.sponsorBlockCategory')).toHaveText('Intermission')
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(false)
  await expect(page.locator('.sponsorBlockMarker')).toHaveCount(0)
})

for (const uiScale of [100, 95]) {
  test.describe(`segment editor layout at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          useSponsorBlock: true,
          sponsorBlockEnableSubmission: true,
          sponsorBlockGeneratedUserId: 'test-contributor',
          uiScale,
          alwaysShowScrollbars: true,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue'
        }
      }
    })

    test('keeps category edits inside the panel and clamps after collapsing, cancellation, and resize', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 1440, height: 960 })
      const { panel } = await openSegments(app, page, Array.from({ length: 9 }, (_, index) => ({
        ...timedSegment, UUID: `segment-${index}`, segment: [index, index + 0.5]
      })))
      const content = panel.locator('.sponsorBlockContent')
      const lastSegment = panel.locator('.sponsorBlockSegmentSummary').last()
      await lastSegment.click()
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      await panel.getByRole('button', { name: 'Change category', exact: true }).click()
      const scrollToBottom = () => content.evaluate(element => { element.scrollTop = element.scrollHeight })
      const expectValidScroll = () => expect.poll(() => content.evaluate(element => {
        const viewport = element.getBoundingClientRect()
        const end = element.querySelector('.sponsorBlockFooter').getBoundingClientRect().bottom
        const maximum = Math.max(0, element.scrollTop + end - viewport.bottom)
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return element.scrollTop <= maximum + 2 &&
          scrollbar.classList.contains('os-scrollbar-visible') === (maximum > 1)
      })).toBe(true)
      await scrollToBottom()
      await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectValidScroll()
      await panel.getByRole('button', { name: 'Change category', exact: true }).click()
      await scrollToBottom()
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      await expectValidScroll()
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      await panel.getByRole('button', { name: 'Change category', exact: true }).click()
      await scrollToBottom()
      await lastSegment.click()
      await expectValidScroll()
      await lastSegment.click()
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      await panel.getByRole('button', { name: 'Change category', exact: true }).click()
      await scrollToBottom()
      await setWindowSize(app, page, { width: 430, height: 820 })
      await expectValidScroll()
      await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await scrollToBottom()
      await setWindowSize(app, page, { width: 1400, height: 940 })
      await expectValidScroll()

      await page.route('**/api/voteOnSponsorTime?*', route => route.fulfill({ status: 200 }))
      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenSponsorBlockToggle').click({ force: true })
      const fullscreenPanel = page.locator('.fullscreenSponsorBlockOverlay.open')
      await expect(fullscreenPanel).toBeVisible()
      if (await fullscreenPanel.getByRole('button', { name: 'Copy & downvote', exact: true }).count() === 0) {
        if (await fullscreenPanel.getByRole('button', { name: 'Edit', exact: true }).count() === 0) {
          await fullscreenPanel.locator('.sponsorBlockSegmentSummary').last().click()
        }
        await fullscreenPanel.getByRole('button', { name: 'Edit', exact: true }).click()
      }
      await fullscreenPanel.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
      await expect(page.locator('.sponsorBlockSubmissionMenu')).toBeVisible()
    })

    test('edits directly from a skipped toast and keeps its editor inside the player', async ({ app, page }, testInfo) => {
      const { panel, video } = await openSegments(app, page)
      const votes = []
      await page.route('**/api/voteOnSponsorTime?*', route => {
        votes.push(Object.fromEntries(new URL(route.request().url()).searchParams))
        return route.fulfill({ status: 200 })
      })
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await page.evaluate(() => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSponsorBlockSkippedToastDuration', 1)
      })
      await video.evaluate(element => {
        element.currentTime = 11.2
        element.dispatchEvent(new Event('timeupdate'))
      })
      const player = page.locator('.ftVideoPlayer')
      const toast = player.locator('.skippedSegment')
      await expect(toast).toBeVisible()
      await expect(toast.getByRole('button', { name: 'Change category', exact: true })).toHaveCount(0)
      await toast.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(toast.getByRole('button', { name: 'Copy & downvote', exact: true })).toBeVisible()
      await expect(toast.locator('.btn')).toHaveCount(2)
      await toast.getByRole('button', { name: 'Change category', exact: true }).click()
      await toast.locator('select').selectOption('intro')
      await toast.getByRole('button', { name: 'Submit category vote', exact: true }).click()
      await expect(toast.locator('.skippedSegmentText')).toContainText('Intermission')
      expect(votes[0].category).toBe('intro')
      expect(votes[0]).not.toHaveProperty('type')
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1100)
      await expect(toast).toBeVisible()
      const expectCenteredCancel = () => expect.poll(() => toast.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => {
        const button = element.getBoundingClientRect()
        const actions = element.closest('.sponsorBlockEditActions').getBoundingClientRect()
        return Math.abs(button.left + button.width / 2 - actions.left - actions.width / 2)
      })).toBeLessThan(1)
      await expectCenteredCancel()
      if (uiScale === 100) await captureThemes(page, toast, testInfo, 'sponsorblock-toast-editor')

      // Shorter translations fit on one row, where Cancel should stay on the right.
      const originalLabels = await page.evaluate(() => {
        const app = document.querySelector('#app').__vue_app__
        const i18n = app._context.provides[app.__VUE_I18N_SYMBOL__].global
        const { SubmitCategoryVote, CopyAndDownvote } = i18n.getLocaleMessage('en-US').Video.Player.SponsorBlock
        i18n.mergeLocaleMessage('en-US', {
          Video: { Player: { SponsorBlock: { SubmitCategoryVote: 'Vote', CopyAndDownvote: 'Copy' } } }
        })
        return { SubmitCategoryVote, CopyAndDownvote }
      })
      const cancel = toast.locator('.sponsorBlockCancelButton')
      await expect(toast.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
      await expect.poll(() => cancel.evaluate(element => {
        const button = element.getBoundingClientRect()
        const primary = element.parentElement.querySelector('.sponsorBlockPrimaryActions').getBoundingClientRect()
        const actions = element.parentElement.getBoundingClientRect()
        const padding = parseFloat(getComputedStyle(element.parentElement).paddingRight)
        return Math.max(Math.abs(button.top - primary.top), Math.abs(actions.right - padding - button.right))
      })).toBeLessThan(1)
      await page.evaluate(labels => {
        const app = document.querySelector('#app').__vue_app__
        app._context.provides[app.__VUE_I18N_SYMBOL__].global.mergeLocaleMessage('en-US', {
          Video: { Player: { SponsorBlock: labels } }
        })
      }, originalLabels)
      await expect(toast.getByRole('button', { name: 'Copy & downvote', exact: true })).toBeVisible()
      await expectCenteredCancel()

      const scroller = toast.locator('.sponsorBlockToastEditor')
      await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
      const scrollToBottom = () => scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      const expectValidScroll = () => expect.poll(() => scroller.evaluate(element => {
        const end = element.querySelector('.sponsorBlockEditActions').getBoundingClientRect().bottom
        const maximum = Math.max(0, element.scrollTop + end - element.getBoundingClientRect().bottom)
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return element.scrollTop <= maximum + 2 && scrollbar.classList.contains('os-scrollbar-visible') === (maximum > 1)
      })).toBe(true)
      await scrollToBottom()
      await setWindowSize(app, page, { width: 430, height: 820 })
      await expectValidScroll()
      await expectCenteredCancel()
      await expect.poll(() => toast.evaluate(element => {
        const player = element.closest('.ftVideoPlayer').getBoundingClientRect()
        const notice = element.getBoundingClientRect()
        return notice.top >= player.top - 1 && notice.left >= player.left - 1 && notice.right <= player.right + 1
      })).toBe(true)
      await scrollToBottom()
      await toast.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectValidScroll()
      await toast.getByRole('button', { name: 'Change category', exact: true }).click()
      await scrollToBottom()
      await setWindowSize(app, page, { width: 1360, height: 940 })
      await expectValidScroll()
      await toast.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(toast.getByRole('button', { name: 'Copy & downvote', exact: true })).toHaveCount(0)
      await toast.getByRole('button', { name: 'Edit', exact: true }).click()
      await toast.getByRole('button', { name: 'Copy & downvote', exact: true }).click()
      await expect(page.locator('.sponsorBlockSubmissionMenu')).toBeVisible()
      await expect(toast).toHaveCount(0)
      expect(votes.at(-1).type).toBe('0')
    })
  })
}
