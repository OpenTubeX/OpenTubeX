process.env.NODE_ENV = 'development'

const electron = require('electron')
const { rspack } = require('@rspack/core')
const { RspackDevServer } = require('@rspack/dev-server')
const kill = require('@magda/tree-kill')

const path = require('path')
const { createHash } = require('crypto')
const { spawn } = require('child_process')
const { mkdirSync, realpathSync } = require('fs')
const { tmpdir } = require('os')

const ProcessLocalesPlugin = require('./ProcessLocalesPlugin')

let electronProcess = null
let manualRestart = null
let restartTimer = null
let manualRestartResetTimer = null

const restartDebounceMs = 300
const manualRestartResetMs = 2500

const remoteDebugging = process.argv.indexOf('--remote-debug') !== -1
const web = process.argv.indexOf('--web') !== -1
const worktree = process.argv.indexOf('--worktree') !== -1

let mainConfig
let rendererConfig
let preloadConfig
let botGuardScriptConfig
let webConfig

if (remoteDebugging) {
  // disable dvtools open in electron
  process.env.RENDERER_REMOTE_DEBUGGING = true
}

// Define exit code for relaunch and set it in the environment
const relaunchExitCode = 69
process.env.OPENTUBEX_RELAUNCH_EXIT_CODE = relaunchExitCode

let port = 9080

function configureWorktree() {
  // Let the operating system atomically assign the port when the development
  // server starts, instead of probing a port that another process could claim.
  port = 0
  const projectPath = realpathSync(path.resolve(__dirname, '..'))
  const profileId = createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
  const profilePath = path.resolve(process.env.OPENTUBEX_DEV_USER_DATA_DIR || path.join(tmpdir(), `opentubex-dev-${profileId}`))
  mkdirSync(profilePath, { recursive: true, mode: 0o700 })

  process.env.OPENTUBEX_DEV_USER_DATA_DIR = profilePath

  console.log(`Using worktree profile ${profilePath}`)
}

function loadConfigs() {
  if (!web) {
    mainConfig = require('./rspack.main.config')
    rendererConfig = require('./rspack.renderer.config')
    preloadConfig = require('./rspack.preload.config.js')
    botGuardScriptConfig = require('./rspack.botGuardScript.config')
  } else {
    webConfig = require('./rspack.web.config')
  }
}

async function killElectron(pid) {
  return new Promise((resolve, reject) => {
    if (pid) {
      kill(pid, err => {
        if (err) reject(err)

        resolve()
      })
    } else {
      resolve()
    }
  })
}

async function restartElectron() {
  console.log('\nStarting electron...')

  const { pid } = electronProcess || {}
  await killElectron(pid)

  electronProcess = spawn(electron, [
    path.join(__dirname, '../dist/main.js'),
    // '--enable-logging', // Enable to show logs from all electron processes
    remoteDebugging ? '--inspect=9222' : '',
    remoteDebugging ? '--remote-debugging-port=9223' : ''
  ],
  // an unread pipe hides the logs and blocks Electron once it is full
  { stdio: 'inherit' }
  )

  electronProcess.on('exit', (code, _) => {
    if (code === relaunchExitCode) {
      electronProcess = null
      restartElectron()
      return
    }

    if (!manualRestart) process.exit(0)
  })
}

function scheduleElectronRestart() {
  manualRestart = true

  if (restartTimer) {
    clearTimeout(restartTimer)
  }

  if (manualRestartResetTimer) {
    clearTimeout(manualRestartResetTimer)
    manualRestartResetTimer = null
  }

  restartTimer = setTimeout(async () => {
    restartTimer = null

    try {
      await restartElectron()
    } catch (err) {
      console.error(err)
    }

    manualRestartResetTimer = setTimeout(() => {
      manualRestartResetTimer = null

      if (!restartTimer) {
        manualRestart = false
      }
    }, manualRestartResetMs)
  }, restartDebounceMs)
}

/**
 * @param {import('@rspack/core').Compiler} compiler
 * @param {RspackDevServer} devServer
 */
function setupNotifyLocaleUpdate(compiler, devServer) {
  const notifyLocaleChange = (update) => {
    devServer.sendMessage(devServer.webSocketServer.clients, 'freetube-locale-update', update)
  }

  compiler.options.plugins
    .filter(plugin => plugin instanceof ProcessLocalesPlugin)
    .forEach((/** @type {ProcessLocalesPlugin} */plugin) => {
      plugin.notifyLocaleChange = notifyLocaleChange
    })
}

function startBotGuardScript() {
  rspack(botGuardScriptConfig, (err) => {
    if (err) console.error(err)

    console.log(`\nCompiled ${botGuardScriptConfig.name} script!`)
  })
}

function startMain() {
  const compiler = rspack(mainConfig)
  const { name } = compiler

  compiler.hooks.afterEmit.tap('afterEmit', async () => {
    console.log(`\nCompiled ${name} script!`)

    scheduleElectronRestart()

    console.log(`\nWatching file changes for ${name} script...`)
  })

  compiler.watch({
    aggregateTimeout: 500,
  },
  err => {
    if (err) console.error(err)
  })
}

function startPreload() {
  const compiler = rspack(preloadConfig)
  const { name } = compiler

  let firstTime = true

  compiler.hooks.afterEmit.tap('afterEmit', async () => {
    console.log(`\nCompiled ${name} script!`)

    if (firstTime) {
      firstTime = false
    } else {
      scheduleElectronRestart()
    }

    console.log(`\nWatching file changes for ${name} script...`)
  })

  compiler.watch({
    aggregateTimeout: 500,
  },
  err => {
    if (err) console.error(err)
  })
}

/**
 * Logs each compilation of a dev server compiler.
 * @param {import('@rspack/core').Compiler} compiler
 * @returns {Promise<void>} resolves after the first compilation
 */
function logCompilations(compiler) {
  const { name } = compiler
  return new Promise(resolve => {
    compiler.hooks.done.tap('DevRunner', stats => {
      console.log('\n' + stats.toString({ colors: true }))
      console.log(`\nCompiled ${name} script!\n\nWatching file changes for ${name} script...`)
      resolve()
    })
  })
}

function startRenderer(callback) {
  const compiler = rspack({ ...rendererConfig, watchOptions: { aggregateTimeout: 250 } })

  const server = new RspackDevServer({
    client: {
      overlay: {
        runtimeErrors: false
      }
    },
    static: [
      {
        directory: path.resolve(__dirname, '..', 'static'),
        watch: {
          ignored: [
            /(dashFiles|storyboards)\/*/,
            /\.DS_Store/,
            path.resolve(__dirname, '..', 'static', 'locales'),
            path.resolve(__dirname, '..', 'static', 'pwabuilder-sw.js'),
            path.resolve(__dirname, '..', 'static', 'manifest.json')
          ]
        },
        publicPath: '/static'
      },
      {
        directory: path.dirname(require.resolve('shaka-player/ui/locales/en.json')),
        publicPath: '/static/shaka-player-locales'
      }
    ],
    port
  }, compiler)

  setupNotifyLocaleUpdate(compiler, server)

  // The dev server watches the files, so wait for its first compilation
  Promise.all([server.start(), logCompilations(compiler)])
    .then(() => callback(server.server.address().port))
    .catch(error => {
      console.error(error)
      process.exitCode = 1
      return server.stop()
    })
}

function startWeb () {
  const compiler = rspack({ ...webConfig, watchOptions: { aggregateTimeout: 250 } })

  const server = new RspackDevServer({
    open: true,
    static: [
      {
        directory: path.resolve(__dirname, '..', 'static'),
        watch: {
          ignored: [
            /(dashFiles|storyboards)\/*/,
            /\.DS_Store/,
            path.resolve(__dirname, '..', 'static', 'locales')
          ]
        },
        publicPath: '/static'
      },
      {
        directory: path.dirname(require.resolve('shaka-player/ui/locales/en.json')),
        publicPath: '/static/shaka-player-locales'
      }
    ],
    port
  }, compiler)

  setupNotifyLocaleUpdate(compiler, server)
  logCompilations(compiler)

  server.start().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

async function start() {
  if (worktree) configureWorktree()
  loadConfigs()

  if (!web) {
    if (process.platform === 'win32') {
      const { prepareWindowsShare } = await import('./windowsShare.mjs')
      await prepareWindowsShare()
    } else if (process.platform === 'darwin') {
      const { prepareMacosNative } = await import('./macosNative.mjs')
      await prepareMacosNative()
    }
    startRenderer(devServerPort => {
      if (worktree) {
        process.env.OPENTUBEX_DEV_SERVER_PORT = String(devServerPort)
        console.log(`Using development server port ${devServerPort}`)
      }
      startBotGuardScript()
      startPreload()
      startMain()
    })
  } else {
    startWeb()
  }
}

start().catch(error => {
  console.error(error)
  process.exitCode = 1
})
