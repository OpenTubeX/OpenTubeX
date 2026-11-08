import { readFileSync } from 'node:fs'

import { test, expect, goTo, goToSettingsSection, waitForAppReady, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

const RELEASES_URL = /^https:\/\/api\.github\.com\/repos\/OpenTubeX\/OpenTubeX\/releases/
const COMMIT_HASH = '3904e64f503cde6be8793606a04ad69c5d57cef0'
const installedVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version
const [majorVersion, minorVersion] = installedVersion.split('.').map(Number)
const nextMinorVersion = `${majorVersion}.${minorVersion + 1}`
const newestUpdateVersion = `${nextMinorVersion}.1`
const olderUpdateVersion = `${nextMinorVersion}.0`

function release(name, tagName, body) {
  return { name, tag_name: tagName, body, draft: false, prerelease: false }
}

const NEWEST_NOTES = [
  '> [!WARNING]',
  '> Test alert.',
  '',
  `Automated development build from commit ${COMMIT_HASH}.`,
  '',
  '<details>',
  '<summary>Show changes</summary>',
  '',
  '- Fixed something (#499)',
  '',
  '</details>'
].join('\n')

/**
 * Serves the given releases to the in-app update check and restarts the
 * renderer so that it runs with the stub in place.
 */
async function showUpdateNotification(page, releases) {
  await page.route(RELEASES_URL, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(releases)
  }))

  // The first update check runs at startup, so enable it and reload. The route
  // above stays installed across the reload, so no request ever leaves.
  await goTo(page, 'settings')
  const updateToggle = page.locator('.switch-ctn', { hasText: 'Check for Updates' })
  await updateToggle.locator('.switch-label').click()
  await expect(updateToggle.locator('input')).toBeChecked()
  await page.reload()
  await waitForAppReady(page)

  const notification = page.locator('.toast', { hasText: 'is now available' })
  await expect(notification).toBeVisible()
  return notification
}

/** Moves the clock past the six-hour interval; becoming visible runs a due check. */
function runPeriodicUpdateCheck(page) {
  return page.evaluate(() => {
    const now = Date.now()
    Date.now = () => now + 7 * 60 * 60 * 1000
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

async function showUpdatePrompt(page, releases) {
  const notification = await showUpdateNotification(page, releases)
  await notification.getByRole('button', { name: 'See changes and update' }).click()
  await expect(page.locator('.changeLogTitle')).toBeVisible()
}

test('update notification buttons are centered when they wrap below the text', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
  const notification = await showUpdateNotification(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  for (const size of [
    { width: 1600, height: 900 },
    { width: 800, height: 600 },
    { width: 480, height: 800 },
    { width: 375, height: 700 }
  ]) {
    // The initial window already has the desktop dimensions.
    if (size.width !== 1600) await setWindowSize(app, page, size)
    await expect.poll(() => notification.evaluate(element => {
      const toast = element.getBoundingClientRect()
      const message = element.querySelector('.toastMessage').getBoundingClientRect()
      const actions = element.querySelector('.toastActions').getBoundingClientRect()
      const wrapped = actions.top >= message.bottom
      return {
        wrapped,
        aligned: wrapped
          ? Math.abs(actions.left + actions.width / 2 - toast.left - toast.width / 2) <= 1
          : actions.left >= message.right,
        fits: element.scrollWidth <= element.clientWidth
      }
    }), { message: `${size.width}px at ${uiScale}% UI scale` }).toEqual({
      wrapped: size.width <= 480,
      aligned: true,
      fits: true
    })

    if (uiScale === 100 && size.width === 375) {
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toContainClass(colorScheme)
        const path = testInfo.outputPath(`centered-update-buttons-${colorScheme}.png`)
        await notification.screenshot({ path, animations: 'disabled' })
        await testInfo.attach(`centered update buttons (${colorScheme})`, { path, contentType: 'image/png' })
      }
    }
  }
})

test('release-note scrollbar stays anchored during touch scrolling without scroll callbacks', { tag: '@scale' }, async ({ app, page }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`,
      `<details open><summary>Show changes</summary>\n\n${Array.from({ length: 60 }, (_, index) => `- Release note ${index + 1}: scrolling through the latest improvements and fixes on a phone.`).join('\n')}\n\n</details>`)
  ])
  await setWindowSize(app, page, { width: 480, height: 800 })
  const scroller = page.locator('.changeLogText')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await expect(scrollbar).toBeAttached()
  // Touch scrolling can advance on the compositor before JS scroll listeners
  // run. Suppress those callbacks to check the scrollbar in that exact state.
  const resumeScrollEvents = await scroller.evaluateHandle(element => {
    const suppressScroll = event => {
      if (event.target === element) event.stopImmediatePropagation()
    }
    document.addEventListener('scroll', suppressScroll, { capture: true })
    return () => document.removeEventListener('scroll', suppressScroll, { capture: true })
  })
  // The dialog itself can still move during its opening animation. Compare
  // the track with its viewport in the same frame, not with the screen.
  const trackOffset = () => scroller.evaluate(element => {
    const track = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track')
    return track.getBoundingClientRect().top - element.getBoundingClientRect().top
  })
  const initialOffset = await trackOffset()
  const box = await scroller.boundingBox()
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const point = { x: box.x + box.width / 2, y: box.y + box.height - 30 }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  for (const distance of [30, 60, 90, 120, 150, 180]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - distance }] })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(50)
  await expect.poll(async () => Math.abs(await trackOffset() - initialOffset)).toBeLessThanOrEqual(1)
  await resumeScrollEvents.evaluate(resume => resume())
  await resumeScrollEvents.dispose()
  await session.detach()

  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(50)
  for (const size of [{ width: 481, height: 1000 }, { width: 1000, height: 900 }]) {
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await setWindowSize(app, page, size)
    await expectScrollAtRenderedEnd(scroller)
    await expect.poll(() => scrollbar.evaluate(element => {
      const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return Math.abs(handle.bottom - track.bottom)
    })).toBeLessThanOrEqual(1)
  }

  await scroller.locator('summary').evaluate(element => element.click())
  await expect.poll(() => scroller.evaluate(element => ({
    scrollTop: element.scrollTop,
    hasScrollbar: !element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable'),
    overflows: element.scrollHeight > element.clientHeight + 1,
    trackAnimations: element.querySelector('.os-scrollbar-vertical').getAnimations().length,
  }))).toEqual({ scrollTop: 0, hasScrollbar: false, overflows: false, trackAnimations: 0 })
})

test('the update notification stays dismissed for the current app session', async ({ page }) => {
  const notification = await showUpdateNotification(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(notification).toHaveClass(/indefinite/)
  await expect(notification.locator('.timeout-indicator-track')).toHaveCount(0)
  const updateButton = notification.getByRole('button', { name: 'See changes and update' })
  const dismissButton = notification.getByRole('button', { name: 'Dismiss' })
  await expect(updateButton).toBeVisible()
  await expect(updateButton.locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(dismissButton).toBeVisible()
  await expect(dismissButton.locator('[data-icon="xmark"]')).toBeVisible()
  expect(await notification.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  // Read both controls in the same frame while the toast animates into place.
  const [dismissBox, updateBox] = await notification.evaluate(element =>
    ['Dismiss', 'See changes and update'].map(label => {
      const button = Array.from(element.querySelectorAll('button')).find(button => button.textContent.trim() === label)
      return button.getBoundingClientRect().toJSON()
    })
  )
  expect(dismissBox).not.toBeNull()
  expect(updateBox).not.toBeNull()
  expect(Math.abs(dismissBox.x - updateBox.x)).toBeLessThanOrEqual(1)
  expect(dismissBox.y + dismissBox.height).toBeLessThanOrEqual(updateBox.y)
  expect(updateBox.y - dismissBox.y - dismissBox.height).toBeGreaterThanOrEqual(7.5)
  expect(updateBox.y - dismissBox.y - dismissBox.height).toBeLessThanOrEqual(8.5)

  const toastRow = notification.locator('xpath=../..')
  await expect(toastRow).toHaveAttribute('data-dismissible', 'false')
  await toastRow.focus()
  await page.keyboard.press('Escape')
  await expect(toastRow).toHaveAttribute('data-removed', 'false')
  await expect(notification).toBeVisible()

  const notificationBox = await notification.boundingBox()
  expect(notificationBox).not.toBeNull()
  const swipeY = notificationBox.y + notificationBox.height / 2
  await page.mouse.move(notificationBox.x + notificationBox.width / 2, swipeY)
  await page.mouse.down()
  await page.mouse.move(notificationBox.x + notificationBox.width / 2 - 200, swipeY, { steps: 5 })
  await page.mouse.up()
  await expect(toastRow).toHaveAttribute('data-swipe-out', 'false')
  await expect(notification).toBeVisible()

  await page.getByRole('button', { name: 'New Tab' }).click()
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(1)

  await notification.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notification).toHaveCount(0)

  await page.getByRole('button', { name: 'New Tab' }).click()
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(0)

  await page.reload()
  await waitForAppReady(page)
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(0)
})

test('closing the release notes restores the update notification', async ({ page }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  const notification = page.locator('.toast', { hasText: 'is now available' })
  await expect(notification).toHaveCount(0)

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.changeLogTitle')).toHaveCount(0)
  await expect(notification).toBeVisible()
})

test('periodic update checks keep one notification for the newest release', async ({ page }) => {
  const releases = [
    release(`OpenTubeX ${olderUpdateVersion}`, `v${olderUpdateVersion}-beta`, '- Older change')
  ]
  const notification = await showUpdateNotification(page, releases)
  await expect(notification).toContainText(olderUpdateVersion)

  let requests = 0
  await page.route(RELEASES_URL, (route) => {
    requests++
    return route.fallback()
  })
  const recheck = () => runPeriodicUpdateCheck(page)

  await recheck()
  await expect.poll(() => requests).toBe(1)
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(1)

  releases.unshift(release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES))
  await recheck()
  await expect(page.locator('.toast', { hasText: `Version ${newestUpdateVersion} is now available` })).toBeVisible()
  // A duplicate from the first recheck or the older toast would remain here
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(1)
})

test('a periodic check that finishes behind open release notes leaves them unchanged', async ({ page }) => {
  const releases = [
    release(`OpenTubeX ${olderUpdateVersion}`, `v${olderUpdateVersion}-beta`, '- Older change')
  ]
  const notification = await showUpdateNotification(page, releases)

  let respond
  const responded = new Promise(resolve => { respond = resolve })
  let requested
  const request = new Promise(resolve => { requested = resolve })
  await page.route(RELEASES_URL, async (route) => {
    requested()
    await responded
    return route.fallback()
  })
  releases.unshift(release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES))
  await runPeriodicUpdateCheck(page)
  await request

  await notification.getByRole('button', { name: 'See changes and update' }).click()
  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${olderUpdateVersion}`)
  const response = page.waitForResponse(RELEASES_URL)
  respond()
  expect(await (await response).finished()).toBeNull()
  // Let the check apply its result, which only needs cached modules and one IPC reply
  await page.evaluate(() => new Promise(resolve => requestIdleCallback(() => requestIdleCallback(resolve))))

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${olderUpdateVersion}`)
  await expect(page.locator('.changeLogText')).toContainText('Older change')
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(0)
})

test('a single update shows its version once and renders the release notes', { tag: '@scale' }, async ({ page, attachScreenshot }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${newestUpdateVersion}`)
  // The title already names the release, so the notes must not repeat it.
  await expect(page.locator('.changeLogText h2')).toHaveCount(0)

  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => page.locator('.promptCard').evaluate(element => {
      const card = element.getBoundingClientRect()
      const content = element.querySelector('.changeLogContent').getBoundingClientRect()
      return Math.max(content.left - card.left, card.right - content.right)
    }), { message: 'release notes have a single side gutter' }).toBeLessThanOrEqual(17)
  }

  await attachScreenshot('update prompt')

  const summary = page.locator('.changeLogText summary')
  const details = page.locator('.changeLogText details')
  await expect(summary).toBeVisible()
  // Collapsible sections start expanded, but can still be collapsed.
  await expect(details).toHaveAttribute('open', '')
  await expect(page.locator('.changeLogText details li')).toHaveText(/Fixed something/)
  await summary.click()
  await expect(details).not.toHaveAttribute('open', '')

  const commitLink = page.locator(`.changeLogText a[href$="${COMMIT_HASH}"]`)
  await expect(commitLink).toHaveText('3904e64')
  await expect(commitLink).toHaveAttribute(
    'href',
    `https://github.com/OpenTubeX/OpenTubeX/commit/${COMMIT_HASH}`
  )
})

test('package manager installs show the update command instead of the download link', async ({ app, page, attachScreenshot }) => {
  const command = 'sudo apt update && sudo apt install --only-upgrade opentubex'
  await app.electronApp.evaluate(({ clipboard, ipcMain }, command) => {
    clipboard.writeText('')
    ipcMain.removeHandler('get-package-manager-update')
    ipcMain.handle('get-package-manager-update', () => ({ packageManager: 'APT', command }))
  }, command)
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(page.locator('.changeLogUpdateCommand')).toHaveText(`Update with APT: ${command}`)
  await expect(page.getByRole('button', { name: 'Download From Site' })).toHaveCount(0)
  await attachScreenshot('package manager update prompt')

  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Update command copied' })).toBeVisible()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(command)
})

test.describe('with external links enabled', () => {
  test.use({ seed: { settings: { externalLinkHandling: '' } } })

  test('release-note links open externally instead of replacing the app window', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.releaseNoteExternalUrls = []
      shell.openExternal = async url => {
        globalThis.releaseNoteExternalUrls.push(url)
      }
    })
    // An in-window navigation would load this page instead of the app
    await page.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: 'GitHub' }))
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
    ])
    const appUrl = page.url()

    await page.locator(`.changeLogText a[href$="${COMMIT_HASH}"]`).click()

    await expect.poll(() => app.electronApp.evaluate(() => globalThis.releaseNoteExternalUrls))
      .toEqual([`https://github.com/OpenTubeX/OpenTubeX/commit/${COMMIT_HASH}`])
    expect(page.url()).toBe(appUrl)
    await expect(page.locator('.changeLogTitle')).toBeVisible()
  })

  test('the donate button opens the donation page and keeps the release notes open', async ({ app, page, attachScreenshot }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.donateExternalUrls = []
      shell.openExternal = async url => {
        globalThis.donateExternalUrls.push(url)
      }
    })
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
    ])
    await attachScreenshot('update prompt with donate button')

    await page.getByRole('button', { name: 'Donate', exact: true }).click()

    await expect.poll(() => app.electronApp.evaluate(() => globalThis.donateExternalUrls))
      .toEqual(['https://opentubex.org/donate/'])
    await expect(page.locator('.changeLogTitle')).toBeVisible()
  })
})

test.describe('with external links behind a prompt', () => {
  test.use({ seed: { settings: { externalLinkHandling: 'openLinkAfterPrompt' } } })

  test('the donate button asks before opening the donation page', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.donateExternalUrls = []
      shell.openExternal = async url => {
        globalThis.donateExternalUrls.push(url)
      }
    })
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
    ])

    await page.getByRole('button', { name: 'Donate', exact: true }).click()
    const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })
    await expect(prompt).toContainText('https://opentubex.org/donate/')
    expect(await app.electronApp.evaluate(() => globalThis.donateExternalUrls)).toEqual([])

    await prompt.getByRole('button', { name: 'Yes, Open Link' }).click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.donateExternalUrls))
      .toEqual(['https://opentubex.org/donate/'])
    await expect(page.locator('.changeLogTitle')).toBeVisible()
  })

  test('the download button asks before opening the downloads page', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.downloadExternalUrls = []
      shell.openExternal = async url => {
        globalThis.downloadExternalUrls.push(url)
      }
    })
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
    ])

    const downloadButton = page.getByRole('button', { name: 'Download From Site' })
    const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })
    await downloadButton.click()
    await expect(prompt).toContainText('https://opentubex.org/downloads/')

    // Declining keeps the update available
    await prompt.getByRole('button', { name: 'No', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    await expect(page.locator('.changeLogTitle')).toBeVisible()
    expect(await app.electronApp.evaluate(() => globalThis.downloadExternalUrls)).toEqual([])

    await downloadButton.click()
    await prompt.getByRole('button', { name: 'Yes, Open Link' }).click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.downloadExternalUrls))
      .toEqual(['https://opentubex.org/downloads/'])
  })
})

test.describe('with external links disabled', () => {
  test.use({ seed: { settings: { externalLinkHandling: 'doNothing' } } })

  test('the download button keeps the release notes open without opening a link', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.downloadExternalUrls = []
      shell.openExternal = async url => {
        globalThis.downloadExternalUrls.push(url)
      }
    })
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
    ])

    await page.getByRole('button', { name: 'Download From Site' }).click()
    await expect(page.locator('.toast', { hasText: 'External link opening has been disabled' })).toBeVisible()
    await expect(page.locator('.changeLogTitle')).toBeVisible()
    expect(await app.electronApp.evaluate(() => globalThis.downloadExternalUrls)).toEqual([])
  })
})

test('skipped updates keep a heading per release', async ({ page, attachScreenshot }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, 'Newest notes'),
    release(`OpenTubeX ${olderUpdateVersion}`, `v${olderUpdateVersion}-beta`, 'Older notes')
  ])

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${newestUpdateVersion}`)
  await expect(page.locator('.changeLogText h2')).toHaveText([
    `OpenTubeX ${newestUpdateVersion}`,
    `OpenTubeX ${olderUpdateVersion}`
  ])
  await attachScreenshot('update prompt with skipped releases')
})

test('release notes for other platforms are hidden', async ({ page }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, [
      '## Highlights',
      '',
      '- **Android, iOS:** Mobile highlight. (#1)',
      '',
      '## Improvements',
      '',
      '- Shared improvement. (#2)',
      '- **Desktop:** Desktop improvement. (#3)',
      '- **Android:** Android improvement. (#4)',
      '  <img src="https://github.com/user-attachments/assets/android" alt="Android screenshot">'
    ].join('\n'))
  ])

  await expect(page.locator('.changeLogText h2')).toHaveText(['Improvements'])
  await expect(page.locator('.changeLogText li')).toHaveText([
    'Shared improvement. (#2)',
    'Desktop: Desktop improvement. (#3)'
  ])
  await expect(page.locator('.changeLogText img')).toHaveCount(0)
})

test.describe('release-note screenshots with dark and light variants', () => {
  test.use({ seed: { settings: { baseTheme: 'dark' } } })

  test('show the variant for the app theme when the prompt opens', async ({ page }) => {
    // Serve the screenshots, because a failed image is replaced with its alt text.
    await page.route('https://github.com/user-attachments/assets/*', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>'
    }))
    await page.emulateMedia({ colorScheme: 'dark' })
    const notification = await showUpdateNotification(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, [
        '- Screenshot improvement. (#1)',
        '  <picture>',
        '    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/dark">',
        '    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/light">',
        '    <img src="https://github.com/user-attachments/assets/dark" alt="Screenshot" width="844">',
        '  </picture>'
      ].join('\n'))
    ])

    // Switch to a light app theme after the update check, while the OS stays dark.
    await goToSettingsSection(page, 'theme')
    const baseTheme = page.getByRole('combobox', { name: 'Base Theme' })
    await baseTheme.click()
    await page.locator(`#${await baseTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.locator('body')).toHaveClass(/\blight\b/)
    await page.locator('.settingsCloseButton').click()
    await notification.getByRole('button', { name: 'See changes and update' }).click()

    const screenshot = page.locator('.changeLogText li').getByAltText('Screenshot')
    await expect(screenshot).toHaveAttribute('src', 'https://github.com/user-attachments/assets/light')
    await expect.poll(() => screenshot.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  })
})

test('changelog images preserve their aspect ratio at phone and desktop widths', { tag: '@scale' }, async ({ page, uiScale }) => {
  const imageUrl = 'https://example.com/release-screenshot.svg'
  await page.route(imageUrl, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="teal"/></svg>'
  }))
  const notes = [
    `<img src="${imageUrl}" alt="Height only" height="450">`,
    `<img src="${imageUrl}" alt="Both dimensions" width="800" height="450">`,
    `<img src="${imageUrl}" alt="Width only" width="800">`,
    `![Markdown image](${imageUrl})`
  ].join('\n\n')
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, notes)
  ])

  const images = page.locator('.changeLogText img')
  await expect(images).toHaveCount(4)
  await images.evaluateAll(elements => Promise.all(elements.map(image => image.decode())))
  // The prompt springs slightly past its full size as it opens, which scales the images with it.
  await page.locator('.changeLogText').evaluate(text => Promise.all(
    text.closest('.promptCard').getAnimations().map(animation => animation.finished.catch(() => {}))
  ))

  for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport)
    for (const image of await images.all()) {
      const dimensions = await image.evaluate(element => {
        const { width, height } = element.getBoundingClientRect()
        const container = element.closest('.changeLogText')
        const style = getComputedStyle(container)
        return {
          width,
          height,
          expectedHeight: width * element.naturalHeight / element.naturalWidth,
          availableWidth: container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        }
      })
      const context = `${await image.getAttribute('alt')}, ${viewport.width}px, ${uiScale}% scale`
      expect(dimensions.width, context).toBeGreaterThan(0)
      expect(dimensions.width, context).toBeLessThanOrEqual(dimensions.availableWidth + 1)
      expect.soft(Math.abs(dimensions.height - dimensions.expectedHeight), context).toBeLessThanOrEqual(1)
    }
  }
})
