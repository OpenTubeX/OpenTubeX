import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const PORTABLE_DATA_DIRECTORY_NAME = 'OpenTubeX-data'
const WINDOWS_PORTABLE_MARKER_NAME = 'portable.marker'

export function isPortableBuild (environment = process.env) {
  return typeof environment.PORTABLE_EXECUTABLE_DIR === 'string' &&
    environment.PORTABLE_EXECUTABLE_DIR.length > 0
}

export function configurePortableEnvironment (
  environment = process.env,
  platform = process.platform,
  executablePath = process.execPath,
  fileExists = existsSync
) {
  if (platform !== 'win32' || isPortableBuild(environment)) return

  const executableDirectory = path.win32.dirname(executablePath)
  if (fileExists(path.win32.join(executableDirectory, WINDOWS_PORTABLE_MARKER_NAME))) {
    environment.PORTABLE_EXECUTABLE_DIR = executableDirectory
  }
}

export function configureApplicationDataPaths (app, environment = process.env) {
  const developmentDataPath = environment.OPENTUBEX_E2E_USER_DATA_DIR ??
    environment.OPENTUBEX_DEV_USER_DATA_DIR

  if (developmentDataPath) {
    app.setPath('userData', developmentDataPath)
    app.setPath('sessionData', developmentDataPath)
    return
  }

  if (!isPortableBuild(environment)) return

  const dataPath = path.join(
    environment.PORTABLE_EXECUTABLE_DIR,
    PORTABLE_DATA_DIRECTORY_NAME
  )
  const crashDumpsPath = path.join(dataPath, 'Crashpad')
  const logsPath = path.join(dataPath, 'logs')

  for (const directory of [dataPath, crashDumpsPath, logsPath]) {
    mkdirSync(directory, { recursive: true })
  }

  app.setPath('userData', dataPath)
  app.setPath('sessionData', dataPath)
  app.setPath('crashDumps', crashDumpsPath)
  app.setAppLogsPath(logsPath)
}
