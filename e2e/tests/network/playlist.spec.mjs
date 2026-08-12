import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

const MEMBERS_ONLY_PLAYLIST = {
  id: 'PLIwiAebpd5CK-T-TP6lnpLI5heKC9zDlc',
  title: 'Baba Is You',
  url: 'https://www.youtube.com/playlist?list=PLIwiAebpd5CK-T-TP6lnpLI5heKC9zDlc'
}

test('loads playlists containing members-only videos', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'playlist hydration needs the real API')

  await page.locator(sel.searchInput).fill(MEMBERS_ONLY_PLAYLIST.url)
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${MEMBERS_ONLY_PLAYLIST.id}`))
  await expect(page.locator('.playlistTitle')).toContainText(MEMBERS_ONLY_PLAYLIST.title, {
    timeout: 30_000
  })
  await expect(page.locator('.playlistPage')).toHaveClass(/grid/)
  await expect(page.locator('.playlistItemsCard .autoGrid')).toHaveClass(/grid/)
  await expect.poll(
    () => page.locator('.playlistItemsCard .autoGrid > .grid').count(),
    { timeout: 30_000 }
  ).toBeGreaterThan(20)
})
