import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const DAY = 86_400_000
const RETRY_INTERVAL = 300_000
const BACKUP_FILENAME = /^opentubex-scheduled-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[\da-f-]{36}\.zip$/

async function cleanStaleTemporaryArchives(directory, timestamp) {
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith('.') || !entry.name.endsWith('.tmp') ||
        !BACKUP_FILENAME.test(entry.name.slice(1, -4))) continue
      const filename = path.join(directory, entry.name)
      try {
        const { mtimeMs } = await fs.stat(filename)
        if (mtimeMs > timestamp || timestamp - mtimeMs >= DAY) await fs.unlink(filename)
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove incomplete backup', error)
      }
    }
  } catch (error) {
    console.error('Could not check incomplete backups', error)
  }
}

/** One main-process scheduler serves every window, including windows hidden in the tray. */
export function createScheduledBackups({ readConfiguration, createArchive, saveStatus, now = Date.now }) {
  let active = null
  let stopped = false
  let localRetryAttempt = null

  async function saveBackupStatus(status) {
    try {
      await saveStatus(status)
    } catch (error) {
      localRetryAttempt = { directory: status.directory, at: now() }
      throw error
    }
  }

  async function run() {
    const configuration = await readConfiguration()
    const { enabled, directory, interval, keepCount } = configuration
    if (enabled !== true || typeof directory !== 'string' || !path.isAbsolute(directory) ||
      ![1, 7, 30].includes(interval) || !Number.isInteger(keepCount) || keepCount < 1 || keepCount > 100) return

    const status = configuration.status?.directory === directory ? configuration.status : {}
    const timestamp = now()
    const isRecent = (at, duration) => Number.isFinite(at) && at <= timestamp && at > timestamp - duration
    if ((localRetryAttempt?.directory === directory && isRecent(localRetryAttempt.at, RETRY_INTERVAL)) ||
      isRecent(status.lastAttemptAt, RETRY_INTERVAL) ||
      (!status.error && isRecent(status.lastBackupAt, interval * DAY))) return

    const nextStatus = { ...status, directory, lastAttemptAt: timestamp, error: false }
    const filename = `opentubex-scheduled-backup-${new Date(timestamp).toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}.zip`
    const temporaryPath = path.join(directory, `.${filename}.tmp`)
    let cancelled = false
    async function configurationIsCurrent() {
      const current = await readConfiguration()
      return current.enabled === true && current.directory === directory
    }
    try {
      if (!(await fs.stat(directory)).isDirectory()) throw new Error('Backup destination is not a folder')
      await fs.access(directory, fs.constants.W_OK)
      await cleanStaleTemporaryArchives(directory, timestamp)
      const archive = await createArchive()
      if (!await configurationIsCurrent()) { cancelled = true; return }
      // Keep old backups until a complete new archive is committed in the selected folder.
      // A missing folder is an error, so an unmounted drive never redirects backups locally.
      await fs.writeFile(temporaryPath, archive, { flag: 'wx', mode: 0o600 })
      if (!await configurationIsCurrent()) { cancelled = true; return }
      await fs.rename(temporaryPath, path.join(directory, filename))
      nextStatus.lastBackupAt = timestamp
      try {
        // Keep the new archive even if older backups were named with an incorrect future clock.
        const files = (await fs.readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.name !== filename && entry.isFile() && BACKUP_FILENAME.test(entry.name))
          .map(entry => entry.name).sort().reverse()
        const current = await readConfiguration()
        if (current.enabled !== true || current.directory !== directory ||
          !Number.isInteger(current.keepCount) || current.keepCount < 1 || current.keepCount > 100) return
        for (const name of files.slice(current.keepCount - 1)) {
          await fs.unlink(path.join(directory, name)).catch(error => console.error('Scheduled backup retention failed', error))
        }
      } catch (error) {
        // A locked old file must not turn a completed backup into a five-minute retry loop.
        console.error('Scheduled backup retention failed', error)
      }
    } catch (error) {
      nextStatus.error = true
      console.error('Scheduled backup failed', error)
    } finally {
      await fs.unlink(temporaryPath).catch(error => {
        if (error.code !== 'ENOENT') console.error('Could not remove incomplete backup', error)
      })
      if (!cancelled) await saveBackupStatus(nextStatus)
    }
  }

  return {
    tick() {
      if (stopped) return Promise.resolve()
      active ??= run().finally(() => { active = null })
      return active
    },
    async stop() {
      stopped = true
      await active
    }
  }
}
