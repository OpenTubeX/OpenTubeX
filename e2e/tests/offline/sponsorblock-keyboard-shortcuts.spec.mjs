import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const bindings = {
  START_SPONSORBLOCK_SEGMENT: 'alt+a',
  END_SPONSORBLOCK_SEGMENT: 'alt+b',
  OPEN_SPONSORBLOCK_SUBMISSION_MENU: 'alt+s',
  CANCEL_SPONSORBLOCK_SEGMENT: 'alt+x',
  CLEAR_SPONSORBLOCK_SEGMENTS: 'alt+c',
}

const defaultBindings = [';', ';', "'", 'Unassigned', 'Unassigned']

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useSponsorBlock: true,
      sponsorBlockEnableSubmission: true,
      currentLocale: 'en-US',
    }
  }
})

async function openVideo(app, page) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([]),
    contentType: 'application/json'
  }))
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    element.currentTime = 2
  })
  return video
}

async function assignShortcuts(page) {
  await page.evaluate(bindings => window.$store.dispatch('updateKeyboardShortcuts', JSON.stringify({
    VIDEO_PLAYER: { SPONSORBLOCK: bindings }
  })), bindings)
}

async function drafts(page) {
  return page.evaluate(() => window.$store.getters.getSponsorBlockDraftSegmentsByVideoId.jNQXAC9IVRw ?? [])
}

test('assigns searchable SponsorBlock shortcuts and resets them', async ({ page }, testInfo) => {
  await page.keyboard.press('Shift+?')
  const search = page.locator('.shortcutToolbar').getByRole('searchbox')
  await search.fill('SponsorBlock')
  await expect(page.locator('.labelAndShortcut')).toHaveCount(5)

  for (const [index, [code, binding]] of Object.entries(bindings).entries()) {
    const button = page.locator(`[data-shortcut-path="VIDEO_PLAYER.SPONSORBLOCK.${code}"]`)
    await expect(button).toHaveText(defaultBindings[index])
    await button.click()
    await button.press(binding.replace('alt', 'Alt'))
    await expect(button).toHaveText(binding.replace('alt', 'Alt'))
  }
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(window.$store.getters.getKeyboardShortcuts).VIDEO_PLAYER.SPONSORBLOCK
  )).toEqual(bindings)

  // The existing conflict flow also applies to these actions.
  const start = page.locator('[data-shortcut-path="VIDEO_PLAYER.SPONSORBLOCK.START_SPONSORBLOCK_SEGMENT"]')
  await start.click()
  await start.press('k')
  await expect(page.locator('.prompt')).toContainText('Toggle play/pause')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(start).toHaveText('Alt+a')

  for (const code of ['START_SPONSORBLOCK_SEGMENT', 'END_SPONSORBLOCK_SEGMENT']) {
    const button = page.locator(`[data-shortcut-path="VIDEO_PLAYER.SPONSORBLOCK.${code}"]`)
    await button.click()
    await button.press(';')
    await expect(button).toHaveText(';')
    await expect(page.locator('.prompt')).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
  await expect(page.locator('.shortcutButton')).toHaveText(defaultBindings)
  await page.locator('.keyboardShortcutPromptEmbedded').screenshot({ path: testInfo.outputPath('sponsorblock-shortcuts.png') })
})

test('uses the extension defaults to mark both boundaries and toggle the submission menu', async ({ app, page }) => {
  const video = await openVideo(app, page)
  await expect(page.locator('.sponsorblock-start-button').first()).toHaveAttribute('aria-label', 'Start Segment Now (;)')
  await page.keyboard.down(';')
  await page.keyboard.down(';')
  await page.keyboard.up(';')
  await expect.poll(() => drafts(page)).toEqual([
    expect.objectContaining({ startTime: 2, endTime: null })
  ])
  await video.evaluate(element => { element.currentTime = 6 })
  await page.keyboard.press(';')
  await expect.poll(() => drafts(page)).toEqual([
    expect.objectContaining({ startTime: 2, endTime: 6 })
  ])
  const menu = page.locator('.sponsorBlockSubmissionMenu')
  await expect(menu).toBeVisible()
  await page.keyboard.press("'")
  await expect(menu).toHaveCount(0)
  await page.keyboard.press("'")
  await expect(menu).toBeVisible()
})

test('creates, ends, opens, cancels and clears drafts with configured shortcuts', async ({ app, page }, testInfo) => {
  const video = await openVideo(app, page)
  await assignShortcuts(page)
  const menu = page.locator('.sponsorBlockSubmissionMenu')
  await page.keyboard.press('Alt+s')
  await expect(menu).toHaveCount(0)

  await page.keyboard.press('Alt+a')
  await expect.poll(() => drafts(page)).toEqual([
    expect.objectContaining({ startTime: 2, endTime: null })
  ])
  await page.keyboard.press('Alt+a')
  await expect.poll(() => drafts(page)).toHaveLength(1)
  await expect(page.locator('.sponsorblock-end-button').first()).toHaveAttribute('aria-label', 'End Segment Now (Alt+b)')
  await video.evaluate(element => { element.currentTime = 6 })
  await page.keyboard.press('Alt+b')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('textbox', { name: 'Segment start time' })).toHaveValue('0:02.000')
  await expect(menu.getByRole('textbox', { name: 'Segment end time' })).toHaveValue('0:06.000')
  await menu.screenshot({ path: testInfo.outputPath('keyboard-created-segment.png') })
  await menu.getByRole('textbox', { name: 'Segment start time' }).focus()
  await page.keyboard.press('Alt+c')
  expect(await drafts(page)).toHaveLength(1)
  await menu.getByRole('textbox', { name: 'Segment start time' }).evaluate(element => element.blur())
  await page.keyboard.press('Alt+s')
  await expect(menu).toHaveCount(0)
  await page.keyboard.press('Alt+s')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Alt+s')

  await video.evaluate(element => { element.currentTime = 8 })
  await page.keyboard.press('Alt+a')
  await expect.poll(() => drafts(page)).toHaveLength(2)
  await page.keyboard.press('Alt+x')
  await expect.poll(() => drafts(page)).toEqual([
    expect.objectContaining({ startTime: 2, endTime: 6 })
  ])

  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('Alt+c')
  await expect.poll(() => drafts(page)).toHaveLength(1)
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('Alt+c')
  await expect.poll(() => drafts(page)).toHaveLength(0)
})

test('ignores editable fields, disabled submission, inactive tabs and repeated keydowns', async ({ app, page }) => {
  await openVideo(app, page)
  await assignShortcuts(page)
  const search = page.locator(sel.searchInput)
  await search.focus()
  await page.keyboard.press('Alt+a')
  expect(await drafts(page)).toHaveLength(0)
  await search.evaluate(element => element.blur())

  for (const setting of ['updateSponsorBlockEnableSubmission', 'updateUseSponsorBlock']) {
    await page.evaluate(setting => window.$store.dispatch(setting, false), setting)
    await page.keyboard.press('Alt+a')
    expect(await drafts(page)).toHaveLength(0)
    await page.evaluate(setting => window.$store.dispatch(setting, true), setting)
  }

  await page.keyboard.press('Alt+s')
  await expect(page.locator('.sponsorBlockSubmissionMenu')).toHaveCount(0)
  await page.keyboard.down('Alt')
  await page.keyboard.down('a')
  await page.keyboard.down('a')
  await page.keyboard.up('a')
  await page.keyboard.up('Alt')
  await expect.poll(() => drafts(page)).toHaveLength(1)

  await page.keyboard.press('Shift+?')
  await expect(page.locator('.keyboardShortcutPromptEmbedded')).toBeVisible()
  await page.keyboard.press('Alt+x')
  expect(await drafts(page)).toHaveLength(1)
  await page.locator('.settingsCloseButton').click()

  // A repeated toggle must leave the menu open.
  await page.keyboard.down('Alt')
  await page.keyboard.down('s')
  await page.keyboard.down('s')
  await page.keyboard.up('s')
  await page.keyboard.up('Alt')
  await expect(page.locator('.sponsorBlockSubmissionMenu')).toBeVisible()

  await page.keyboard.press('Control+t')
  await page.locator(sel.searchInput).evaluate(element => element.blur())
  await page.keyboard.press('Alt+x')
  expect(await drafts(page)).toHaveLength(1)
})
