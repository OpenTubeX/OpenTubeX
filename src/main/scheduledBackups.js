import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const DAY = 86_400_000
const RETRY_INTERVAL = 300_000
const BACKUP_FILENAME = /^opentubex-scheduled-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[\da-f-]{36}\.zip$/

/** One main-process scheduler serves every window, including windows hidden in the tray. */
export function createScheduledBackups({ readConfiguration, createArchive, saveStatus, now = Date.now }) {
  let active = null
  let stopped = false

  async function run() {
    const configuration = await readConfiguration()
    const { enabled, directory, interval, keepCount } = configuration
    if (enabled !== true || typeof directory !== 'string' || !path.isAbsolute(directory) ||
      ![1, 7, 30].includes(interval) || !Number.isInteger(keepCount) || keepCount < 1 || keepCount > 100) return

    const status = configuration.status?.directory === directory ? configuration.status : {}
    const timestamp = now()
    if (status.lastAttemptAt > timestamp - RETRY_INTERVAL ||
      (!status.error && status.lastBackupAt > timestamp - interval * DAY)) return

    const nextStatus = { ...status, directory, lastAttemptAt: timestamp, error: false }
    const filename = `opentubex-scheduled-backup-${new Date(timestamp).toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}.zip`
    const temporaryPath = path.join(directory, `.${filename}.tmp`)
    let cancelled = false
    async function configurationIsCurrent() {
      const current = await readConfiguration()
      return current.enabled === true && current.directory === directory
    }
    try {
      const archive = await createArchive()
      if (!await configurationIsCurrent()) { cancelled = true; return }
      // Keep old backups until a complete new archive is committed in the selected folder.
      // A missing folder is an error, so an unmounted drive never redirects backups locally.
      await fs.writeFile(temporaryPath, archive, { flag: 'wx', mode: 0o600 })
      if (!await configurationIsCurrent()) { cancelled = true; return }
      await fs.rename(temporaryPath, path.join(directory, filename))
      nextStatus.lastBackupAt = timestamp
      try {
        if (!await configurationIsCurrent()) return
        const files = (await fs.readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.isFile() && BACKUP_FILENAME.test(entry.name))
          .map(entry => entry.name).sort().reverse()
        for (const name of files.slice(keepCount)) await fs.unlink(path.join(directory, name))
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
      if (!cancelled) await saveStatus(nextStatus)
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
