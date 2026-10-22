import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

function readClipboard(app) {
  return app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
}

async function copyFreshReport(app, copyButton) {
  await app.electronApp.evaluate(({ clipboard }) => clipboard.writeText(''))
  await copyButton.click()
  await expect.poll(() => readClipboard(app)).not.toBe('')
  return readClipboard(app)
}

function logFailures(page, app, label) {
  return Promise.all([
    page.evaluate((label) => {
      const error = new Error(`Renderer playback failed ${label}`)
      error.data = ['https://rr1---sn-abc123.googlevideo.com/videoplayback?ip=203.0.113.9&sig=secret-signature', { headers: { cookie: 'SID=secret-cookie' } }]
      console.error('Player error', error)
      Promise.reject(new Error(`Renderer rejection ${label}`))
    }, label),
    app.electronApp.evaluate((_electron, label) => {
      console.error(`yt-dlp failed ${label} for /home/alice/video with token=secret-token`)
    }, label),
  ])
}

test('diagnostic logging records redacted renderer and main process logs only while it is on', async ({ page, app }, testInfo) => {
  const settings = await goToSettingsSection(page, 'advanced')
  const section = settings.locator('.settingsSection').filter({ hasText: 'Diagnostics' })
  await section.scrollIntoViewIfNeeded()
  const toggle = section.getByRole('checkbox', { name: 'Enable diagnostic logging' })
  const copyButton = section.getByRole('button', { name: 'Copy report' })

  await expect(toggle).not.toBeChecked()
  await expect(copyButton).toBeDisabled()
  await logFailures(page, app, 'before')

  await section.locator('label.switch-label').filter({ hasText: 'Enable diagnostic logging' }).click()
  await expect(toggle).toBeChecked()
  await expect(copyButton).toBeEnabled()
  await logFailures(page, app, 'during')

  await copyButton.click()
  await expect.poll(() => readClipboard(app)).toContain('Renderer rejection during')
  const report = await readClipboard(app)
  await testInfo.attach('diagnostic-report.txt', { body: report, contentType: 'text/plain' })

  expect(report).toMatch(/^OpenTubeX diagnostic report\n/)
  expect(report).toContain('backendPreference: ')
  expect(report).toMatch(/ERROR \[renderer \d+\] Player error Error: Renderer playback failed during/)
  expect(report).toContain('"https://<node>.googlevideo.com/videoplayback?<redacted>"')
  expect(report).toContain('cookie: <redacted>')
  expect(report).toMatch(/ERROR \[renderer \d+\] Unhandled promise rejection Error: Renderer rejection during/)
  expect(report).toContain('ERROR [main] yt-dlp failed during for /home/<user>/video with token=<redacted>')
  for (const text of ['before', '203.0.113.9', 'secret-signature', 'secret-cookie', 'secret-token', 'alice', 'sn-abc123']) {
    expect(report).not.toContain(text)
  }
  await testInfo.attach('diagnostics-settings.png', { body: await section.screenshot(), contentType: 'image/png' })

  await section.getByRole('button', { name: 'Clear log' }).click()
  await expect(page.getByText('Diagnostic log cleared')).toBeVisible()
  await expect.poll(() => copyFreshReport(app, copyButton)).toContain('Log (0 entries')

  // Turning logging off discards entries, and nothing is recorded until it is on again
  const label = section.locator('label.switch-label').filter({ hasText: 'Enable diagnostic logging' })
  await logFailures(page, app, 'discarded')
  await label.click()
  await expect(copyButton).toBeDisabled()
  await logFailures(page, app, 'while off')
  await label.click()
  await expect(copyButton).toBeEnabled()
  await expect.poll(() => copyFreshReport(app, copyButton)).toContain('Log (0 entries')
})
