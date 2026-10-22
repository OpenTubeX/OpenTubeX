import {
  captureConsole,
  createDiagnosticEntry,
  createDiagnosticLog,
  formatDiagnosticEntry,
} from '../../diagnosticLog.js'
import { getNightlyCommit } from './versionDisplay.js'
import packageDetails from '../../../package.json'

// Electron keeps one log in the main process for all tabs
const localLog = process.env.IS_ELECTRON ? null : createDiagnosticLog()

// Settings that change which code paths playback and data loading take. Only
// values that cannot identify the user belong here.
const REPORTED_SETTINGS = [
  'backendPreference',
  'backendFallback',
  'videoPlaybackEngine',
  'playbackEngineFallback',
  'defaultVideoFormat',
  'defaultQuality',
  'preferredVideoCodec',
  'proxyVideos',
  'useProxy',
  'proxyProtocol',
  'ytDlpSource',
  'ytDlpChannel',
  'ytDlpPlaybackAuthMode',
  'ytDlpPlaybackAlwaysUseCookies',
]

function record(level, args) {
  const entry = createDiagnosticEntry(level, 'renderer', args)
  if (process.env.IS_ELECTRON) {
    window.ftElectron.addDiagnosticLogEntry(entry)
  } else {
    localLog.add(entry)
  }
}

function recordError(event) {
  // Chromium reports this harmless layout notice as an error
  if (event.error == null && event.message?.startsWith('ResizeObserver loop')) return
  record('error', ['Uncaught', event.error ?? event.message])
}

function recordRejection(event) {
  record('error', ['Unhandled promise rejection', event.reason])
}

/** @type {(() => void) | null} */
let stopCapture = null

/**
 * Nothing is recorded until diagnostic logging is turned on, and turning it
 * off discards what was recorded. Electron's main process clears the shared
 * log when it sees the setting change.
 * @param {boolean} enabled
 */
export function setDiagnosticLogging(enabled) {
  if (enabled === (stopCapture !== null)) return

  if (enabled) {
    const restoreConsole = captureConsole(console, record)
    window.addEventListener('error', recordError)
    window.addEventListener('unhandledrejection', recordRejection)
    stopCapture = () => {
      restoreConsole()
      window.removeEventListener('error', recordError)
      window.removeEventListener('unhandledrejection', recordRejection)
    }
  } else {
    stopCapture()
    stopCapture = null
    localLog?.clear()
  }
}

export async function clearDiagnosticLog() {
  if (process.env.IS_ELECTRON) {
    await window.ftElectron.clearDiagnosticLog()
  } else {
    localLog.clear()
  }
}

async function getPlatformLines() {
  if (process.env.IS_ELECTRON) {
    const device = await window.ftElectron.getDeviceInfo()
    const runtime = window.ftElectron.runtimeVersions
    return [
      `Platform: ${device ? `${device.platform} ${device.release} (${device.architecture})` : 'unknown'}`,
      `Runtime: Electron ${runtime.electron}, Chromium ${runtime.chromium}, Node.js ${runtime.node}`,
    ]
  }

  const app = process.env.IS_IOS ? 'iOS' : process.env.IS_CAPACITOR ? 'Android' : 'Web'
  return [`Platform: ${app}`, `User agent: ${navigator.userAgent}`]
}

/**
 * @param {object} options
 * @param {(settingId: string) => unknown} options.getSetting
 * @param {string} options.locale
 * @returns {Promise<string>}
 */
export async function buildDiagnosticReport({ getSetting, locale }) {
  const [platformLines, entries] = await Promise.all([
    getPlatformLines(),
    process.env.IS_ELECTRON ? window.ftElectron.getDiagnosticLog() : localLog.entries(),
  ])
  const commit = getNightlyCommit(packageDetails.version, process.env.BUILD_COMMIT ?? '')

  return [
    'OpenTubeX diagnostic report',
    `Generated: ${new Date().toISOString()}`,
    `Version: v${packageDetails.version}${commit ? ` (${commit})` : ''}`,
    ...platformLines,
    `Locale: ${locale}`,
    '',
    'Settings:',
    ...REPORTED_SETTINGS.map(settingId => `  ${settingId}: ${JSON.stringify(getSetting(settingId))}`),
    '',
    `Log (${entries.length} entries, oldest first):`,
    ...entries.map(formatDiagnosticEntry),
    '',
  ].join('\n')
}
