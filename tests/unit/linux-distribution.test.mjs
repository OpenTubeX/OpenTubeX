import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getLinuxDistributionInfo,
  parseLsbRelease,
  parseReleaseFile,
} from '../../src/main/linuxDistribution.js'

test('reads the distribution name and rolling release from lsb_release', () => {
  assert.deepEqual(parseLsbRelease(`
Distributor ID:\tArch
Description:\tArch Linux
Release:\trolling
Codename:\tn/a
`), {
    platform: 'Arch Linux',
    release: 'rolling',
  })
})

test('does not repeat a version already included in PRETTY_NAME', () => {
  assert.deepEqual(parseReleaseFile(`
NAME="Ubuntu"
VERSION_ID="24.04"
PRETTY_NAME="Ubuntu 24.04.3 LTS"
`), {
    platform: 'Ubuntu 24.04.3 LTS',
    release: '',
  })
})

test('uses release files when lsb_release is unavailable', async () => {
  const files = new Map([
    ['/etc/os-release', `NAME="Fedora Linux"\nVERSION_ID="42"`],
  ])
  const info = await getLinuxDistributionInfo({
    getLsbRelease: async () => { throw new Error() },
    readReleaseFile: async filePath => {
      if (!files.has(filePath)) throw new Error()
      return files.get(filePath)
    },
    listEtcFiles: async () => ['fedora-release', 'os-release'],
  })

  assert.deepEqual(info, { platform: 'Fedora Linux', release: '42' })
})

test('prefers the host release file inside Flatpak', async () => {
  const info = await getLinuxDistributionInfo({
    isFlatpak: true,
    getLsbRelease: async () => 'Description:\tFreedesktop SDK\nRelease:\t24.08',
    readReleaseFile: async filePath => {
      if (filePath !== '/run/host/os-release') throw new Error()
      return 'PRETTY_NAME="openSUSE Tumbleweed"\nVERSION_ID="20250831"'
    },
    listEtcFiles: async () => [],
  })

  assert.deepEqual(info, {
    platform: 'openSUSE Tumbleweed',
    release: '20250831',
  })
})
