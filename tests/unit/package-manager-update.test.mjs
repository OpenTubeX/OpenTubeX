import assert from 'node:assert/strict'
import test from 'node:test'

import { getPackageManagerUpdate } from '../../src/main/packageManagerUpdate.js'

const APP_PATH = '/opt/OpenTubeX/resources/app.asar'

/**
 * @param {Record<string, string | ((args: string[]) => string)>} commands output by command name; missing commands fail
 * @param {Record<string, string>} [files]
 */
function system (commands, files = {}, overrides = {}) {
  return {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    home: '/home/user',
    run: async (file, args) => {
      const output = commands[file]
      if (output === undefined) throw new Error(`${file} failed`)
      return typeof output === 'function' ? output(args) : output
    },
    readTextFile: async filePath => {
      if (!(filePath in files)) throw new Error('ENOENT')
      return files[filePath]
    },
    listDirectory: async directory => {
      const names = Object.keys(files)
        .filter(filePath => filePath.startsWith(`${directory}/`))
        .map(filePath => filePath.slice(directory.length + 1))
      if (names.length === 0) throw new Error('ENOENT')
      return names
    },
    exists: async filePath => filePath in files,
    ...overrides,
  }
}

test('updates Flatpak installs with flatpak update', async () => {
  const update = await getPackageManagerUpdate('/app/main/resources/app.asar', system({}, {}, {
    env: { FLATPAK_ID: 'org.opentubex.OpenTubeX' },
  }))
  assert.deepEqual(update, { packageManager: 'Flatpak', command: 'flatpak update org.opentubex.OpenTubeX' })
})

test('refreshes Snap Store installs but not snaps installed from a file', async () => {
  const snap = '/snap/opentubex/42/resources/app.asar'
  assert.deepEqual(
    await getPackageManagerUpdate(snap, system({}, {}, { env: { SNAP_NAME: 'opentubex', SNAP_REVISION: '42' } })),
    { packageManager: 'Snap', command: 'sudo snap refresh opentubex' }
  )
  assert.equal(
    await getPackageManagerUpdate(snap, system({}, {}, { env: { SNAP_NAME: 'opentubex', SNAP_REVISION: 'x1' } })),
    null
  )
})

test('upgrades the Nix profile entry that contains OpenTubeX', async () => {
  const storePath = '/nix/store/abc-opentubex-0.37.2'
  const update = await getPackageManagerUpdate(`${storePath}/share/opentubex/resources/app.asar`, system({}, {
    '/home/user/.nix-profile/manifest.json': JSON.stringify({
      version: 3,
      elements: {
        hello: { storePaths: ['/nix/store/def-hello'] },
        default: { storePaths: [storePath] },
      },
    }),
  }))
  assert.deepEqual(update, { packageManager: 'Nix', command: 'nix profile upgrade default' })
})

test('reads the Nix profile from the XDG state directory', async () => {
  const storePath = '/nix/store/abc-opentubex-0.37.2'
  const update = await getPackageManagerUpdate(`${storePath}/share/opentubex/resources/app.asar`, system({}, {
    '/home/user/.local/state/nix/profile/manifest.json': JSON.stringify({
      version: 3,
      elements: { opentubex: { storePaths: [storePath] } },
    }),
  }))
  assert.deepEqual(update, { packageManager: 'Nix', command: 'nix profile upgrade opentubex' })
})

test('keeps the website download for Nix installs outside the profile', async () => {
  const update = await getPackageManagerUpdate('/nix/store/abc-opentubex-0.37.2/share/opentubex/resources/app.asar', system({}))
  assert.equal(update, null)
})

test('upgrades the Homebrew cask on macOS', async () => {
  const appPath = '/Applications/OpenTubeX.app/Contents/Resources/app.asar'
  assert.deepEqual(
    await getPackageManagerUpdate(appPath, system({}, { '/opt/homebrew/Caskroom/opentubex': '' }, { platform: 'darwin' })),
    { packageManager: 'Homebrew', command: 'brew upgrade --cask opentubex' }
  )
  assert.equal(await getPackageManagerUpdate(appPath, system({}, {}, { platform: 'darwin' })), null)
  assert.equal(await getPackageManagerUpdate(
    '/Users/user/Downloads/OpenTubeX.app/Contents/Resources/app.asar',
    system({}, { '/opt/homebrew/Caskroom/opentubex': '' }, { platform: 'darwin' })
  ), null)
})

test('upgrades the nightly Homebrew cask on macOS', async () => {
  const appPath = '/Applications/OpenTubeX.app/Contents/Resources/app.asar'
  assert.deepEqual(
    await getPackageManagerUpdate(appPath, system({}, { '/usr/local/Caskroom/opentubex@nightly': '' }, { platform: 'darwin' })),
    { packageManager: 'Homebrew', command: 'brew upgrade --cask opentubex@nightly' }
  )
})

test('updates Scoop installs from a bucket', async () => {
  const appDirectory = 'C:\\Users\\user\\scoop\\apps\\opentubex-nightly\\current'
  const appPath = `${appDirectory}\\resources\\app.asar`
  const windows = (files) => system({}, files, { platform: 'win32' })
  assert.deepEqual(
    await getPackageManagerUpdate(appPath, windows({ [`${appDirectory}\\install.json`]: '{"bucket":"opentubex","architecture":"64bit"}' })),
    { packageManager: 'Scoop', command: 'scoop update opentubex-nightly' }
  )
  assert.deepEqual(
    await getPackageManagerUpdate('D:\\scoop\\apps\\opentubex\\0.37.3-beta\\resources\\app.asar', windows({
      'D:\\scoop\\apps\\opentubex\\0.37.3-beta\\install.json': '{"bucket":"extras"}',
    })),
    { packageManager: 'Scoop', command: 'scoop update opentubex' }
  )
  assert.equal(await getPackageManagerUpdate(appPath, windows({
    [`${appDirectory}\\install.json`]: '{"url":"C:\\\\opentubex.json"}',
  })), null)
  assert.equal(await getPackageManagerUpdate(appPath, windows({})), null)
  assert.equal(await getPackageManagerUpdate('C:\\Program Files\\OpenTubeX\\resources\\app.asar', windows({})), null)
})

test('upgrades APT installs from the OpenTubeX repository', async () => {
  const update = await getPackageManagerUpdate(APP_PATH, system({
    'dpkg-query': `opentubex: ${APP_PATH}\n`,
    'apt-cache': 'opentubex:\n  Installed: 0.37.1\n  Version table:\n     0.37.2 500\n        500 https://apt.opentubex.org stable/main amd64 Packages\n',
  }))
  assert.deepEqual(update, { packageManager: 'APT', command: 'sudo apt update && sudo apt install --only-upgrade opentubex' })
})

test('keeps the website download for a manually installed .deb', async () => {
  const update = await getPackageManagerUpdate(APP_PATH, system({
    'dpkg-query': `opentubex: ${APP_PATH}\n`,
    'apt-cache': 'opentubex:\n  Installed: 0.37.1\n  Version table:\n *** 0.37.1 100\n        100 /var/lib/dpkg/status\n',
  }))
  assert.equal(update, null)
})

test('upgrades RPM installs with the tool whose repository provides OpenTubeX', async () => {
  const commands = { rpm: 'opentubex' }
  assert.deepEqual(
    await getPackageManagerUpdate(APP_PATH, system(commands, {
      '/etc/yum.repos.d/fedora.repo': '[fedora]\nbaseurl=https://example.org/fedora\n',
      '/etc/yum.repos.d/_copr:copr.fedorainfracloud.org:d3sox:opentubex.repo':
        '[copr]\nbaseurl=https://download.copr.fedorainfracloud.org/results/d3sox/opentubex/fedora-$releasever-$basearch/\n',
    })),
    { packageManager: 'DNF', command: 'sudo dnf upgrade opentubex' }
  )
  assert.deepEqual(
    await getPackageManagerUpdate(APP_PATH, system(commands, {
      '/etc/zypp/repos.d/opentubex.repo': '[opentubex]\nbaseurl=https://rpm.opentubex.org/opensuse/\n',
    })),
    { packageManager: 'Zypper', command: 'sudo zypper update opentubex' }
  )
  assert.equal(await getPackageManagerUpdate(APP_PATH, system(commands, {
    '/etc/yum.repos.d/fedora.repo': '[fedora]\nbaseurl=https://example.org/fedora\n',
  })), null)
  assert.equal(await getPackageManagerUpdate(APP_PATH, system(commands, {
    '/etc/yum.repos.d/opentubex.repo': '[opentubex]\nbaseurl=https://rpm.opentubex.org/\nenabled=0\n\n[other]\nbaseurl=https://example.org/\nenabled=1\n',
  })), null)
})

test('upgrades pacman installs from a repository and AUR installs with the AUR helper', async () => {
  assert.deepEqual(
    await getPackageManagerUpdate(APP_PATH, system({
      pacman: args => {
        if (args[0] === '-Qqm') throw new Error('not foreign')
        return 'opentubex\n'
      }
    })),
    { packageManager: 'pacman', command: 'sudo pacman -Syu' }
  )

  const aur = { pacman: 'opentubex-bin\n' }
  assert.deepEqual(
    await getPackageManagerUpdate(APP_PATH, system(aur, { '/usr/bin/yay': '' })),
    { packageManager: 'AUR', command: 'yay -Syu' }
  )
  assert.deepEqual(
    await getPackageManagerUpdate(APP_PATH, system(aur, { '/usr/bin/shelly': '' })),
    { packageManager: 'AUR', command: 'shelly upgrade all' }
  )
  assert.equal(await getPackageManagerUpdate(APP_PATH, system(aur)), null)
})

test('keeps the website download for unpackaged installs', async () => {
  assert.equal(await getPackageManagerUpdate('/home/user/OpenTubeX/resources/app.asar', system({})), null)
  assert.equal(await getPackageManagerUpdate('C:\\OpenTubeX\\resources\\app.asar', system({}, {}, { platform: 'win32' })), null)
})
