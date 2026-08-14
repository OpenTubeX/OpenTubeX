import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

const ALPHA_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const BETA_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

test.use({
  seed: {
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: ALPHA_CHANNEL_ID, name: 'Alpha Channel', thumbnail: '' },
          { id: BETA_CHANNEL_ID, name: 'Beta Channel', thumbnail: '' }
        ]
      }
    ]
  }
})

test.describe('download settings', () => {
  test('creates templates from built-in and custom templates', async ({ page }) => {
    await goToSettingsSection(page, 'download')

    await expect(page.getByText(
      'yt-dlp, FFmpeg, and FFprobe are configured in the External Software settings.',
      { exact: true }
    )).toHaveCount(0)
    await page.getByRole('button', { name: 'Manage Download Templates (0)' }).click()

    const header = page.locator('.templateManagerHeader')
    const source = header.getByRole('combobox', { name: 'Template to Edit or Use as a Base' })
    const name = header.getByRole('textbox', { name: 'Template Name' })
    const [sourceBox, nameBox] = await Promise.all([source.boundingBox(), name.boundingBox()])
    expect(sourceBox.y).toBeCloseTo(nameBox.y, 0)
    expect(sourceBox.height).toBeCloseTo(nameBox.height, 0)

    await source.click()
    await page.locator(`#${await source.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Audio - MP3 (Built-in)', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Media Type' })).toHaveText('Audio')
    await name.fill('Podcast')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates)
    })).toEqual([
      expect.objectContaining({
        name: 'Podcast',
        options: expect.objectContaining({ mode: 'audio', audioFormat: 'mp3' })
      })
    ])

    await page.getByRole('button', { name: 'Create Copy' }).click()
    await expect(name).toHaveValue('Podcast Copy')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates).map(template => template.name)
    })).toEqual(['Podcast', 'Podcast Copy'])
  })

  test('searches channels and keeps the template and media switches aligned', async ({ page }) => {
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()

    const manager = page.locator('.settingsSubpageContent')
    const search = manager.getByRole('textbox', { name: 'Search channels' })
    await search.fill('beta')
    await expect(manager.getByText('Beta Channel', { exact: true })).toBeVisible()
    await expect(manager.getByText('Alpha Channel', { exact: true })).toHaveCount(0)

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect.poll(() => page.evaluate((channelId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpAutomaticDownloadRules)[channelId]
    }, BETA_CHANNEL_ID)).toEqual(expect.objectContaining({
      template: 'video:best',
      includeVideos: true,
      includeShorts: false,
      includeLivestreams: false,
      enabledAt: expect.any(Number)
    }))

    const options = manager.locator('.templateAndTypes')
    const geometry = await options.evaluate((row) => {
      const controls = [
        row.querySelector('.select-text'),
        ...row.querySelectorAll('.switch-label')
      ].map(element => element.getBoundingClientRect())
      return {
        centers: controls.map(box => box.y + box.height / 2),
        widths: controls.map(box => box.width)
      }
    })
    for (const center of geometry.centers.slice(1)) {
      expect(center).toBeCloseTo(geometry.centers[0], 0)
    }
    expect(geometry.widths[0]).toBeGreaterThan(geometry.widths[1])
  })

  test('starts filtered automatic downloads without user activation and deduplicates them', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-automatic-yt-dlp.sh')
    const argumentsFile = path.join(app.userDataDir, 'automatic-yt-dlp-arguments.txt')
    await writeFile(executable, [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > ${argumentsFile}`,
      "printf '__OPENTUBEX_FILE__:ccccccccccc\\t120\\t1920\\t1080\\t/tmp/automatic.webm\\n'"
    ].join('\n'))
    await chmod(executable, 0o755)
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

    const payload = {
      videoId: 'ccccccccccc',
      title: 'Automatic video',
      mode: 'video',
      template: 'video:best',
      automatic: true,
      channelId: BETA_CHANNEL_ID,
      automaticMediaType: 'video',
      minDurationSeconds: 60,
      maxDurationSeconds: 180,
      minFileSizeMb: 5,
      maxFileSizeMb: 25,
      maxAgeDays: 7,
      customArgs: '--write-description'
    }
    expect(await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), payload)).toBeNull()
    await page.evaluate(async ({ channelId, rule }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpAutomaticDownloadRules', JSON.stringify({ [channelId]: rule }))
    }, {
      channelId: BETA_CHANNEL_ID,
      rule: {
        template: 'video:best',
        includeVideos: true,
        minDurationSeconds: 60,
        maxDurationSeconds: 180,
        minFileSizeMb: 5,
        maxFileSizeMb: 25,
        maxAgeDays: 7
      }
    })

    const result = await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), payload)
    expect(result).toEqual({ id: expect.any(Number) })
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, result.id)).toBe('completed')

    const args = (await readFile(argumentsFile, 'utf8')).trim().split('\n')
    expect(args).toEqual(expect.arrayContaining([
      '--match-filter',
      `channel_id = ${BETA_CHANNEL_ID} & duration >= 60 & duration <= 180`,
      '--min-filesize',
      '5M',
      '--max-filesize',
      '25M',
      '--dateafter',
      'now-7days',
      '--no-overwrites'
    ]))
    expect(args).not.toContain('--write-description')

    const duplicate = await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), payload)
    expect(duplicate).toEqual({ skipped: 'already-downloaded' })
  })
})
