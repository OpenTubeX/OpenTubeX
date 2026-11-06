import { ipcMain } from 'electron'

import { IpcChannels } from '../constants'
import {
  captureConsole,
  createDiagnosticEntry,
  createDiagnosticLog,
  DIAGNOSTIC_ENTRY_MAX_LENGTH,
  DIAGNOSTIC_LOG_LEVELS,
} from '../diagnosticLog'
import { isOpenTubeXUrl } from './utils'

// One log for the main process and every tab, so a report from any tab
// includes the yt-dlp and PO token failures that only the main process sees.
const diagnosticLog = createDiagnosticLog()

/** @type {(() => void) | null} */
let restoreConsole = null

/**
 * Nothing is recorded until diagnostic logging is turned on, and turning it
 * off discards what was recorded.
 * @param {boolean} enabled
 */
export function setDiagnosticLogging(enabled) {
  if (enabled === (restoreConsole !== null)) return

  if (enabled) {
    restoreConsole = captureConsole(console, (level, args) => {
      diagnosticLog.add(createDiagnosticEntry(level, 'main', args))
    })
  } else {
    restoreConsole()
    restoreConsole = null
    diagnosticLog.clear()
  }
}

export function setupDiagnosticLogIpc() {
  ipcMain.on(IpcChannels.DIAGNOSTIC_LOG_ADD, (event, entry) => {
    if (
      restoreConsole === null ||
      !isOpenTubeXUrl(event.senderFrame?.url) ||
      !DIAGNOSTIC_LOG_LEVELS.includes(entry?.level) ||
      typeof entry.message !== 'string'
    ) return

    diagnosticLog.add({
      time: Number.isFinite(entry.time) ? entry.time : Date.now(),
      level: entry.level,
      source: `renderer ${event.sender.id}`,
      message: entry.message.slice(0, DIAGNOSTIC_ENTRY_MAX_LENGTH),
    })
  })

  ipcMain.handle(IpcChannels.DIAGNOSTIC_LOG_GET, (event) => {
    return isOpenTubeXUrl(event.senderFrame?.url) ? diagnosticLog.entries() : []
  })

  ipcMain.handle(IpcChannels.DIAGNOSTIC_LOG_CLEAR, (event) => {
    if (isOpenTubeXUrl(event.senderFrame?.url)) diagnosticLog.clear()
  })
}
