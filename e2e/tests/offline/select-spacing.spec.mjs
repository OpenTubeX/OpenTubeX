import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, repoRoot } from '../../helpers/app.mjs'

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(target => Math.abs(innerWidth - target), width)).toBeLessThanOrEqual(1)
}

for (const uiScale of [100, 95]) {
  test.describe(`select spacing at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          baseTheme: 'dark',
          currentLocale: 'en-US',
          enableDownloads: true,
          rememberVideoQualityPerChannel: true,
          channelVideoQualities: JSON.stringify({ UCaaaaaaaaaaaaaaaaaaaaaa: '720' })
        },
        downloads: [{
          id: 1,
          title: 'Spacing fixture',
          status: 'completed',
          mode: 'audio',
          destination: path.join(repoRoot, 'e2e/fixtures/media/demo-audio.mp3'),
          completedAt: Date.now()
        }]
      }
    })

    test.describe('onboarding', () => {
      test.use({
        showTutorial: true,
        seed: {
          settings: {
            uiScale,
            baseTheme: 'system',
            systemDarkTheme: 'dark',
            systemLightTheme: 'light',
            mainColor: 'Red',
            secColor: 'Blue',
            currentLocale: 'en-US'
          }
        }
      })

      test('uses the tutorial gaps once around tab layout and appearance selects', async ({ app, page }, testInfo) => {
        await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
        await page.reload()
        const tutorial = page.locator('.tutorialCard')
        for (let step = 0; step < 4; step++) {
          await tutorial.getByRole('button', { name: 'Next' }).click()
          if (await tutorial.locator('.tutorialTabLayoutSelect').count()) {
            const spacing = await tutorial.evaluate(element => {
              const select = element.querySelector('.tutorialTabLayoutSelect').getBoundingClientRect()
              return {
                descriptionGap: select.top - element.querySelector('p').getBoundingClientRect().bottom,
                actionGap: element.querySelector('.tutorialActions').getBoundingClientRect().top - select.bottom
              }
            })
            expect.soft(spacing.descriptionGap).toBeCloseTo(20, 0)
            expect.soft(spacing.actionGap).toBeCloseTo(20, 0)
          }
        }
        await expect(tutorial).toHaveAccessibleName('Make it yours')
        for (const width of [1600, 375, 812]) {
          await resize(app, page, width, uiScale)
          const spacing = await tutorial.evaluate(element => {
            const selects = [...element.querySelectorAll('.tutorialSelects .select-text')].map(select => select.getBoundingClientRect())
            return {
              descriptionGap: selects[0].top - element.querySelector('p').getBoundingClientRect().bottom,
              selectGap: selects[1].top - selects[0].bottom,
              actionGap: element.querySelector('.tutorialActions').getBoundingClientRect().top - selects[1].bottom
            }
          })
          expect.soft(spacing.descriptionGap, `${width}px description gap`).toBeCloseTo(20, 0)
          expect.soft(spacing.selectGap, `${width}px select gap`).toBeCloseTo(16, 0)
          expect.soft(spacing.actionGap, `${width}px action gap`).toBeCloseTo(20, 0)
          if (width === 375 && uiScale === 100) {
            await page.mouse.move(0, 0)
            for (const theme of ['dark', 'light']) {
              await page.emulateMedia({ colorScheme: theme })
              await expect(page.locator('body')).toHaveClass(new RegExp(theme))
              const screenshot = testInfo.outputPath(`onboarding-select-spacing-${theme}.png`)
              await tutorial.screenshot({ path: screenshot, animations: 'disabled' })
              await testInfo.attach(`onboarding-select-spacing-${theme}`, { path: screenshot, contentType: 'image/png' })
            }
          }
        }
      })
    })

    test('standalone sort and filter controls do not add a second bottom gap', async ({ app, page }) => {
      await goTo(page, 'userplaylists')
      await expect(page.locator('.optionsRow .sortSelect:visible')).toHaveCSS('margin-bottom', '0px')
      await goTo(page, 'downloads')
      await page.locator('.downloadSectionHeading').getByRole('button', { name: 'Search Filters' }).click()
      const filters = page.locator('.downloadFilters .select')
      await expect(filters).toHaveCount(3)
      for (const width of [1600, 375, 812]) {
        await resize(app, page, width, uiScale)
        for (const select of await filters.all()) {
          await expect(select).toHaveCSS('margin-bottom', '0px')
        }
      }
    })

    test.describe('playlist-add prompt', () => {
      test.use({
        seed: {
          settings: { uiScale, currentLocale: 'en-US' },
          playlists: [{
            _id: 'spacing-source',
            playlistName: 'Spacing source',
            protected: false,
            videos: [{ videoId: 'ccccccccccc', title: 'Spacing video', lengthSeconds: 60, playlistItemId: 'spacing-item', type: 'video' }],
            createdAt: Date.now(),
            lastUpdatedAt: Date.now()
          }, {
            _id: 'spacing-target',
            playlistName: 'Spacing target',
            protected: false,
            videos: [],
            createdAt: Date.now(),
            lastUpdatedAt: Date.now()
          }]
        }
      })

      test('preserves the gap between sort controls and the playlist list', async ({ app, page }, testInfo) => {
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Spacing source', exact: true }).click()
        await page.getByTitle('Copy Playlist', { exact: true }).click()
        const dialog = page.getByRole('dialog').filter({ has: page.locator('.playlists-container') })
        await expect(dialog.locator('.optionsRow')).toBeVisible()
        for (const width of [1600, 375, 812]) {
          await resize(app, page, width, uiScale)
          await expect.poll(() => dialog.evaluate(element => (
            element.querySelector('.playlists-container').getBoundingClientRect().top -
            element.querySelector('.optionsRow').getBoundingClientRect().bottom
          )), { message: `${width}px options-to-list gap` }).toBeCloseTo(20, 0)
          if (width === 375 && uiScale === 100) {
            await page.mouse.move(0, 0)
            await dialog.screenshot({ path: testInfo.outputPath('playlist-add-spacing.png'), animations: 'disabled' })
          }
        }
      })
    })

    test('settings keep their standard row spacing and quick settings keep their own gaps', async ({ page }) => {
      await page.locator('.profileTrigger').click()
      const quickSelect = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('combobox', { name: 'Base Theme' }).locator('..')
      await expect(quickSelect).toHaveCSS('margin-top', '0px')
      await expect(quickSelect).toHaveCSS('margin-bottom', '0px')
      await page.keyboard.press('Escape')
      const general = await goToSettingsSection(page, 'general')
      const select = general.getByRole('combobox', { name: 'Default Landing Page' }).locator('..')
      await expect(select).toHaveCSS('margin-top', '10px')
      await expect(select).toHaveCSS('margin-bottom', '10px')
    })

    test('saved channel selects align with the other preference controls', async ({ page }) => {
      await goToSettingsSection(page, 'playback')
      await page.getByRole('button', { name: 'Manage Saved Channels (1)' }).click()
      const select = page.locator('.channelPreference .select')
      await expect(select).toHaveCount(1)
      await expect(select).toHaveCSS('margin-top', '0px')
      await expect(select).toHaveCSS('margin-bottom', '0px')
    })

    test.describe('channel toolbar', () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            backendPreference: 'invidious',
            defaultInvidiousInstance: 'https://invidious.test'
          }
        }
      })

      test('keeps View All centered with the sort select without padding below the toolbar', async ({ app, page }) => {
        const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
        await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
          json: new URL(route.request().url()).pathname.endsWith('/videos')
            ? { videos: [], continuation: 'next' }
            : {
                author: 'Spacing fixture',
                authorId: channelId,
                authorThumbnails: [],
                authorBanners: [],
                description: '',
                subCount: 0,
                totalViews: 0,
                joined: 0,
                tabs: ['videos'],
                relatedChannels: [],
                isFamilyFriendly: true
              }
        }))
        const tab = await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}/videos`, makeActive: false }), channelId)
        await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
        const toolbar = page.locator('.select-container:visible')
        await expect(toolbar.getByRole('combobox')).toBeVisible()
        for (const width of [1600, 375, 812]) {
          await resize(app, page, width, uiScale)
          const geometry = await toolbar.evaluate(element => {
            const button = element.querySelector('.btn').getBoundingClientRect()
            const select = element.querySelector('.select-text').getBoundingClientRect()
            return {
              wrapped: select.top >= button.bottom,
              rowGap: select.top - button.bottom - Number.parseFloat(getComputedStyle(element.querySelector('.select')).marginTop),
              centerOffset: Math.abs(button.top + button.height / 2 - select.top - select.height / 2),
              bottomGap: element.getBoundingClientRect().bottom - Math.max(button.bottom, select.bottom)
            }
          })
          if (geometry.wrapped) {
            expect.soft(geometry.rowGap, `${width}px wrapped toolbar gap`).toBeCloseTo(10, 0)
          } else {
            expect.soft(geometry.centerOffset, `${width}px toolbar alignment`).toBeLessThanOrEqual(1)
          }
          expect.soft(geometry.bottomGap, `${width}px toolbar empty space`).toBeCloseTo(0, 0)
        }
      })
    })
  })
}
