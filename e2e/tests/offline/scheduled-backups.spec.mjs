import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { createDesktopDatastore, desktopDatastorePaths } from '../../../src/datastores/sqliteNode.js'
import { BACKUP_SECTIONS, createUnifiedBackup, readUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'

test.describe('complete scheduled archives', () => {
  test.use({
    seed: {
      searchHistory: [{ _id: 'scheduled-query', query: 'scheduled backup query', lastUpdatedAt: 1 }],
      watchStats: [{ _id: 'scheduled-watch-time', date: '2026-10-18', seconds: 42 }],
      settings: {
        // Exercise worker archive preparation with a large section.
        forbiddenTitles: JSON.stringify(Array.from({ length: 10_000 }, (_, index) => `scheduled backup test title ${index}`)),
      },
    },
  })

  test('creates complete scheduled backups without sync and preserves the schedule after restart', async ({ app }, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-scheduled-backups-'))
    try {
      const { page, electronApp } = app
      const section = await goToSettingsSection(page, 'data')
      const controls = section.locator('.scheduledBackups')
      const toggle = controls.getByRole('checkbox', { name: 'Enable scheduled backups' })
      await expect(toggle).not.toBeChecked()
      await expect(toggle).toBeDisabled()
      await stubBackupFolder(electronApp, directory)
      await controls.getByRole('button', { name: 'Choose backup folder' }).click()
      await expect(controls.locator('.backupFolder')).toHaveText(directory)
      await expect(toggle).toBeEnabled()
      await controls.getByText('Enable scheduled backups', { exact: true }).click()
      await expect(controls.getByRole('status')).toContainText('Last scheduled backup:')
      const files = (await readdir(directory)).filter(name => name.endsWith('.zip'))
      expect(files).toHaveLength(1)
      const backupBytes = await readFile(path.join(directory, files[0]))
      const backup = await readUnifiedBackup(new Blob([backupBytes]))
      expect(backup.manifest.sections).toEqual(BACKUP_SECTIONS)
      expect(backup.data.searchHistory.some(entry => entry.query === 'scheduled backup query')).toBe(true)
      expect(backup.data.watchStats.records.some(entry => entry.date === '2026-10-18' && entry.seconds === 42)).toBe(true)
      expect(backup.data.settings.autoplayVideos).toBe(true)
      expect(backup.data.settings.landingPage).toBe('subscriptions')
      expect(backup.data.settings).not.toHaveProperty('scheduledBackupEnabled')
      expect(backup.data.settings).not.toHaveProperty('scheduledBackupFolderPath')
      expect(backup.data.settings).not.toHaveProperty('syncServerToken')
      expect(backup.data.settings).not.toHaveProperty('historyWatchedStatusMigrated')
      expect(backup.data.settings.forbiddenTitles.length).toBeGreaterThan(160_000)
      expect(await page.evaluate(() => window.$store.getters.getSyncServerEnabled)).toBe(false)
      await controls.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('scheduled-backups.png'), animations: 'disabled' })
      await page.evaluate(() => window.$store.dispatch('updateBaseTheme', 'dark'))
      await expect(page.locator('body')).toContainClass('dark')
      await page.screenshot({ path: testInfo.outputPath('scheduled-backups-dark.png'), animations: 'disabled' })
      const materialGlyphs = await controls.locator('.select-icon path').evaluateAll(paths => paths.map(path => path.getAttribute('d')))
      await page.evaluate(() => window.$store.dispatch('updateIconPack', 'remix'))
      await expect(controls.locator('.select-icon[data-icon-pack="remix"] svg')).toHaveCount(2)
      await expect.poll(() => controls.locator('.select-icon path').evaluateAll(paths => paths.map(path => path.getAttribute('d')))).not.toEqual(materialGlyphs)
      await page.screenshot({ path: testInfo.outputPath('scheduled-backups-remix.png'), animations: 'disabled' })

      await page.evaluate(() => window.$store.dispatch('updateAutoplayVideos', false))
      await expect.poll(() => page.evaluate(() => window.$store.getters.getAutoplayVideos)).toBe(false)
      await importArchive(page, section, backupBytes)
      await expect.poll(() => page.evaluate(() => window.$store.getters.getAutoplayVideos)).toBe(true)

      const restarted = await app.relaunch()
      const restartedSection = await goToSettingsSection(restarted.page, 'data')
      expect(await restarted.page.evaluate(() => window.$store.getters.getAutoplayVideos)).toBe(true)
      expect(await restarted.page.evaluate(() => window.$store.getters.getLandingPage)).toBe('subscriptions')
      await expect(restartedSection.getByRole('checkbox', { name: 'Enable scheduled backups' })).toBeChecked()
      await expect(restartedSection.locator('.backupFolder')).toHaveText(directory)
      await expect(restartedSection.locator('.scheduledBackups').getByRole('status')).toContainText('Last scheduled backup:')
      expect((await readdir(directory)).filter(name => name.endsWith('.zip'))).toEqual(files)

      const caughtUp = await app.relaunch(async () => {
        const { filename, legacy } = desktopDatastorePaths(app.userDataDir, 'settings')
        const db = createDesktopDatastore(filename, legacy)
        try {
          const status = { directory, lastBackupAt: Date.now() - 30 * 86_400_000, lastAttemptAt: 0, error: false }
          const result = await db.updateAsync({ _id: 'scheduledBackupStatus' }, { _id: 'scheduledBackupStatus', value: status })
          expect(result.numAffected).toBe(1)
        } finally {
          await db.driver.close()
        }
      })
      const caughtUpSection = await goToSettingsSection(caughtUp.page, 'data')
      await expect.poll(async () => (await readdir(directory)).filter(name => name.endsWith('.zip')).length).toBe(2)
      await expect(caughtUpSection.locator('.scheduledBackups').getByRole('status')).toContainText('Last scheduled backup:')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

test('reports unavailable destinations and schedules a retry without claiming success', async ({ app }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-unavailable-backup-'))
  try {
    const section = await goToSettingsSection(app.page, 'data')
    const controls = section.locator('.scheduledBackups')
    await stubBackupFolder(app.electronApp, directory)
    await controls.getByRole('button', { name: 'Choose backup folder' }).click()
    await expect(controls.locator('.backupFolder')).toHaveText(directory)
    await rm(directory, { recursive: true })
    await controls.getByText('Enable scheduled backups', { exact: true }).click()
    await expect(controls.getByRole('status')).toContainText('Backup failed.')
    await expect(controls.getByRole('status')).toContainText('Retrying in five minutes.')
    await expect(controls.getByRole('status')).toContainText('No scheduled backup yet')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('retention keeps the selected number of scheduled backups and leaves manual exports intact', async ({ app }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-backup-retention-'))
  try {
    const manual = 'opentubex-backup-2026-01-01.zip'
    const old = 'opentubex-scheduled-backup-2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip'
    await writeFile(path.join(directory, manual), 'manual backup')
    await writeFile(path.join(directory, old), 'old scheduled backup')
    const section = await goToSettingsSection(app.page, 'data')
    const controls = section.locator('.scheduledBackups')
    await controls.getByRole('combobox', { name: 'Backups to keep' }).click()
    await app.page.getByRole('option', { name: '1', exact: true }).click()
    await controls.getByRole('combobox', { name: 'Backup frequency' }).click()
    await app.page.getByRole('option', { name: 'Daily', exact: true }).click()
    await stubBackupFolder(app.electronApp, directory)
    await controls.getByRole('button', { name: 'Choose backup folder' }).click()
    await controls.getByText('Enable scheduled backups', { exact: true }).click()
    await expect(controls.getByRole('status')).toContainText('Last scheduled backup:')
    const files = await readdir(directory)
    expect(files).toHaveLength(2)
    expect(files).not.toContain(old)
    expect(await readFile(path.join(directory, manual), 'utf8')).toBe('manual backup')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('restoring a crafted ZIP cannot enable backups or replace their local configuration', async ({ app }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-backup-import-'))
  try {
    const old = 'opentubex-scheduled-backup-2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip'
    await writeFile(path.join(directory, old), 'existing archive')
    const { page } = app
    const section = await goToSettingsSection(page, 'data')
    const before = await readBackupSettings(page)
    const archive = createUnifiedBackup({
      settings: {
        autoplayVideos: !before.autoplayVideos,
        scheduledBackupEnabled: true,
        scheduledBackupFolderPath: directory,
        scheduledBackupInterval: 1,
        scheduledBackupKeepCount: 1,
        scheduledBackupStatus: { directory, lastBackupAt: 1, error: true },
      },
    })
    await importArchive(page, section, new Uint8Array(await archive.arrayBuffer()))
    const expected = { ...before, autoplayVideos: !before.autoplayVideos }
    expect(await readBackupSettings(page)).toEqual(expected)

    const restarted = await app.relaunch()
    await goToSettingsSection(restarted.page, 'data')
    expect(await readBackupSettings(restarted.page)).toEqual(expected)
    expect(await readdir(directory)).toEqual([old])
    expect(await readFile(path.join(directory, old), 'utf8')).toBe('existing archive')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('cancels folder selection without enabling backups and keeps controls usable at narrow widths', { tag: '@scale' }, async ({ app }) => {
  const section = await goToSettingsSection(app.page, 'data')
  const controls = section.locator('.scheduledBackups')
  await expect(section.locator('.dataStoragePanel > .scheduledBackups')).toBeVisible()
  await expect(section.locator('.dataStoragePanel > .scheduledBackups ~ *')).toHaveCount(0)
  await expect(controls.getByRole('heading', { name: 'Scheduled backups', level: 3 })).toBeVisible()
  await expect(controls.locator('.select-icon')).toHaveCount(2)
  await stubBackupFolder(app.electronApp)
  await controls.getByRole('button', { name: 'Choose backup folder' }).click()
  await expect(controls.locator('.backupFolder')).toHaveText('No backup folder selected')
  await expect(controls.getByRole('checkbox', { name: 'Enable scheduled backups' })).toBeDisabled()
  const viewport = app.page.locator('.settingsContent')
  for (const width of [1600, 390, 1600]) {
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
    await app.page.setViewportSize({ width, height: 900 })
    await expect.poll(() => viewport.evaluate(element => {
      const content = element.querySelector(':scope > [data-section="data"]')
      const renderedEnd = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
        element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
      const maximum = Math.max(0, renderedEnd - element.clientHeight)
      const nativeRange = element.scrollHeight - element.clientHeight
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      if (Math.abs(nativeRange - maximum) > 1 || element.scrollTop > maximum + 1) return false
      if (maximum <= 1) return scrollbar.classList.contains('os-scrollbar-unusable')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      return !scrollbar.classList.contains('os-scrollbar-unusable') &&
        Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
    }), { message: 'resizing leaves no empty scroll range and keeps the scrollbar proportional to the content' }).toBe(true)
    await controls.scrollIntoViewIfNeeded()
    await expect.poll(() => controls.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await expect.poll(() => controls.locator('.select').evaluateAll(selects => Math.max(...selects.map(select => {
      const label = select.querySelector('.select-label')
      const button = select.querySelector('.select-text')
      return Math.abs(label.getBoundingClientRect().left - button.getBoundingClientRect().left - 13)
    })))).toBeLessThanOrEqual(1)
    for (const name of ['Backup frequency', 'Backups to keep']) {
      const select = controls.getByRole('combobox', { name })
      await expect(select).toBeVisible()
      await select.click()
      await expect(app.page.getByRole('listbox')).toBeVisible()
      await select.press('Escape')
    }
  }
})

function readBackupSettings(page) {
  return page.evaluate(() => {
    const settings = window.$store.state.settings
    return {
      autoplayVideos: settings.autoplayVideos,
      scheduledBackupEnabled: settings.scheduledBackupEnabled,
      scheduledBackupFolderPath: settings.scheduledBackupFolderPath,
      scheduledBackupInterval: settings.scheduledBackupInterval,
      scheduledBackupKeepCount: settings.scheduledBackupKeepCount,
      scheduledBackupStatus: settings.scheduledBackupStatus,
    }
  })
}

async function importArchive(page, section, bytes) {
  await page.evaluate(bytes => {
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([new Uint8Array(bytes)], 'backup.zip', { type: 'application/zip' }),
    }]
  }, [...bytes])
  await section.getByRole('button', { name: 'Import backup' }).click()
  await page.locator('.settingsSubpageContent').getByRole('button', { name: 'Import selected data' }).click()
  await expect(page.locator('.toast', { hasText: 'Backup imported successfully' })).toBeVisible()
}

function stubBackupFolder(electronApp, folder = null) {
  return electronApp.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: folder === null, filePaths: folder === null ? [] : [folder] })
  }, folder)
}
