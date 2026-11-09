import { readFileSync } from 'node:fs'

import { test, expect, goTo, waitForAppReady, setWindowSize, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

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
  await expect(dismissButton).toBeVisible()

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
