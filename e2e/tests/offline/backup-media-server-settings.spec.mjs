import { test, expect, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const label = 'Always use backup media server'

test('backup media server setting defaults off and persists', async ({ app, attachScreenshot }) => {
  const section = await goToSettingsSection(app.page, 'advanced')
  const toggle = section.getByRole('checkbox', { name: new RegExp(`^${label}`) })
  await expect(toggle).not.toBeChecked()
  await section.locator('label.switch-label').filter({ hasText: label }).click()
  await expect(toggle).toBeChecked()
  await expect.poll(async () => latestSettings(
    readDatastore(app.userDataDir, 'settings')
  ).alwaysUseBackupMediaServer).toBe(true)
  await toggle.scrollIntoViewIfNeeded()
  await attachScreenshot('backup-media-server-setting')
})

test.describe('with the backup media server always on', () => {
  test.use({ seed: { settings: { alwaysUseBackupMediaServer: true } } })

  // The media element loads progressive streams without the player's request filter
  test('progressive streams load from the backup server', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, {
      mediaUrl: 'https://rr1---sn-assigned-1.googlevideo.com/videoplayback?id=opentubex-e2e-demo&itag=43&mn=sn-assigned-1%2Csn-backup-2&fvip=4'
    })
    const hosts = new Set()
    page.on('request', request => {
      const { hostname, pathname } = new URL(request.url())
      if (pathname === '/videoplayback') hosts.add(hostname)
    })

    await openMockedVideo(page)
    await waitForPlayback(page)

    expect([...hosts]).toEqual(['rr4---sn-backup-2.googlevideo.com'])
  })
})
