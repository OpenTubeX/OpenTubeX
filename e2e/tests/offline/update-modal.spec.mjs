import { readFileSync } from 'node:fs'

import { test, expect, goTo, waitForAppReady } from '../../helpers/app.mjs'

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
async function showUpdatePrompt(page, releases) {
  await page.route(RELEASES_URL, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(releases)
  }))

  // The update check only runs at startup, so enable it and reload. The route
  // above stays installed across the reload, so no request ever leaves.
  await goTo(page, 'settings')
  const updateToggle = page.locator('.switch-ctn', { hasText: 'Check for Updates' })
  await updateToggle.locator('.switch-label').click()
  await expect(updateToggle.locator('input')).toBeChecked()
  await page.reload()
  await waitForAppReady(page)

  await page.locator('.banner-wrapper .banner').click()
  await expect(page.locator('.changeLogTitle')).toBeVisible()
}

test('a single update shows its version once and renders the release notes', async ({ page, attachScreenshot }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${newestUpdateVersion}`)
  // The title already names the release, so the notes must not repeat it.
  await expect(page.locator('.changeLogText h2')).toHaveCount(0)

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
