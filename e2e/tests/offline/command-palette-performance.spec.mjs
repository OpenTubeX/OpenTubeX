import { test, expect } from '../../helpers/app.mjs'

test('palette opening stays independent of library size on a throttled renderer', async ({ page }) => {
  test.setTimeout(120000)
  // Warm the async component so this measures library work, not chunk loading.
  await page.keyboard.press('Control+k')
  await expect(page.locator('.commandPalette')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.__paletteMetadataReads = 0
    const history = Array.from({ length: 20000 }, (_, index) => ({
      videoId: `v${String(index).padStart(10, '0')}`,
      author: 'Example Channel',
      get title() {
        window.__paletteMetadataReads++
        if (index === 0) {
          // Ensure the scan crosses its first batch boundary even on a fast
          // host, so the queued input probe cannot pass after a tiny scan.
          const end = performance.now() + 10
          while (performance.now() < end) { /* simulate costly metadata */ }
        }
        return index === 19999
          ? 'Unique destination'
          : index === 19998
            ? 'New palette demonstration'
            : `Practical mountain photography techniques episode ${index}`
      },
    }))
    const playlist = { _id: 'large-palette-library', playlistName: 'Large library', videos: history }
    if (store.state.history.libraryPaged) {
      if (!await store.dispatch('overwriteHistory', new Map(history.map(video => [video.videoId, video])))) throw new Error('History fixture was not persisted')
      if (!await store.dispatch('updatePlaylist', playlist)) throw new Error('Playlist fixture was not persisted')
      const persisted = await window.ftElectron.libraryQuery('playlistSummaries')
      if (persisted.find(entry => entry._id === playlist._id)?.videoCount !== history.length) throw new Error('Playlist fixture is incomplete')
    } else {
      store.commit('setHistoryCacheSorted', history)
      store.commit('setAllPlaylists', [playlist])
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  try {
    await page.evaluate(() => { window.__paletteMetadataReads = 0 })
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await expect(input).toBeFocused()
    expect(await page.evaluate(() => window.__paletteMetadataReads)).toBe(0)
    await input.fill('\u0301')
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    expect(await page.evaluate(() => window.__paletteMetadataReads)).toBe(0)
    await expect(page.getByRole('group', { name: 'Local videos', exact: true })).toHaveCount(0)
    const responsive = await input.evaluate(async element => {
      const probe = new Promise(resolve => setTimeout(() => resolve(
        document.querySelector('.commandPalette [role="listbox"]').getAttribute('aria-busy') === 'true'
      ), 0))
      element.value = 'unique destination'
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return probe
    })
    expect(responsive, 'pending input must run before the library scan finishes').toBe(true)
    await input.fill('tab')
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'true')
    await input.press('End')
    const selected = await input.getAttribute('aria-activedescendant')
    expect(selected).not.toBe(await page.getByRole('option').first().getAttribute('id'))
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
    await expect(input).toHaveAttribute('aria-activedescendant', selected)
    await input.fill('new')
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'true')
    await input.press('End')
    const selectedWithMatches = await input.getAttribute('aria-activedescendant')
    await expect(page.getByRole('group', { name: 'Local videos', exact: true }).getByRole('option')).toHaveCount(2, { timeout: 60000 })
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    await expect(input).toHaveAttribute('aria-activedescendant', selectedWithMatches)
    // Commands must remain usable before the library finishes searching.
    await input.fill('new tab')
    const newTab = page.getByRole('option', { name: /^Create a new tab\b/ })
    await expect(newTab).toBeVisible()
    await newTab.click()
    await expect(page.locator('.commandPalette')).toBeHidden()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await page.keyboard.press('Control+k')
    await input.fill('unique destination')
    // Timing is measured separately. Here assert eventual correctness under
    // severe host contention without making a fixed search-speed promise.
    await expect(page.getByRole('group', { name: 'Local videos', exact: true }).getByRole('option')).toHaveCount(2, { timeout: 60000 })
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  } finally {
    await cdp.detach()
  }
})
