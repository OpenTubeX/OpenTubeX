import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  configureApplicationDataPaths,
  configurePortableEnvironment
} from '../../src/main/applicationDataPaths.js'

function createPathRecorder () {
  const configuredPaths = new Map()
  const app = {
    setAppLogsPath (value) {
      configuredPaths.set('logs', value)
    },
    setPath (name, value) {
      configuredPaths.set(name, value)
    }
  }
  return { app, configuredPaths }
}

test('keeps Windows portable application data beside the executable', async () => {
  const portableDirectory = await mkdtemp(path.join(tmpdir(), 'opentubex-portable-'))
  const { app, configuredPaths } = createPathRecorder()

  try {
    configureApplicationDataPaths(app, {
      PORTABLE_EXECUTABLE_DIR: portableDirectory
    })

    const dataDirectory = path.join(portableDirectory, 'OpenTubeX-data')
    assert.deepEqual(Object.fromEntries(configuredPaths), {
      userData: dataDirectory,
      sessionData: dataDirectory,
      crashDumps: path.join(dataDirectory, 'Crashpad'),
      logs: path.join(dataDirectory, 'logs')
    })
    await Promise.all([
      stat(dataDirectory),
      stat(path.join(dataDirectory, 'Crashpad')),
      stat(path.join(dataDirectory, 'logs'))
    ])
  } finally {
    await rm(portableDirectory, { recursive: true, force: true })
  }
})

test('leaves installed builds on Electron default paths', () => {
  const { app, configuredPaths } = createPathRecorder()

  configureApplicationDataPaths(app, {})

  assert.equal(configuredPaths.size, 0)
})

test('detects marked Windows archive builds before configuring paths', () => {
  const environment = {}
  const checkedPaths = []

  configurePortableEnvironment(
    environment,
    'win32',
    'D:\\OpenTubeX\\OpenTubeX.exe',
    candidate => {
      checkedPaths.push(candidate)
      return candidate === 'D:\\OpenTubeX\\portable.marker'
    }
  )

  assert.deepEqual(checkedPaths, ['D:\\OpenTubeX\\portable.marker'])
  assert.equal(environment.PORTABLE_EXECUTABLE_DIR, 'D:\\OpenTubeX')
})

test('does not mark installed or non-Windows builds as portable', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const environment = {}
    configurePortableEnvironment(
      environment,
      platform,
      'C:\\Program Files\\OpenTubeX\\OpenTubeX.exe',
      () => false
    )
    assert.equal(environment.PORTABLE_EXECUTABLE_DIR, undefined)
  }
})

test('keeps test data overrides isolated from portable data', () => {
  const { app, configuredPaths } = createPathRecorder()

  configureApplicationDataPaths(app, {
    OPENTUBEX_E2E_USER_DATA_DIR: '/tmp/opentubex-e2e',
    PORTABLE_EXECUTABLE_DIR: '/portable'
  })

  assert.deepEqual(Object.fromEntries(configuredPaths), {
    userData: '/tmp/opentubex-e2e',
    sessionData: '/tmp/opentubex-e2e'
  })
})
