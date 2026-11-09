import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { usesInvidiousApi } from '../../src/apiBackends.js'

const readSource = path => readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export /gm, '')

for (const metadataOnly of [false, true]) {
  test(`watch fallback warns once before a direct ${metadataOnly ? 'downloaded metadata' : 'playback'} request`, async () => {
    const source = readSource('views/Watch/Watch.js')
    const start = source.indexOf('    getVideoInformationInvidious:')
    const end = source.indexOf('\n    async runIpBlockRecoveryScriptAndReload()', start)
    const events = []
    const methods = vm.runInNewContext(`({${source.slice(start, end)}})`, {
      process: { env: { SUPPORTS_LOCAL_API: true } },
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
      getConnectionState: () => 'online',
      invidiousGetVideoInformation: async () => { throw new Error('Invidious failed') },
      showInvidiousFallbackToast: backend => events.push(backend === 'yattee' ? 'yattee warning' : 'warning'),
      usesInvidiousApi,
      showApiErrorToast() {},
      console: { error() {} },
    })
    const watch = {
      ...methods,
      tabRoute: { params: { id: 'video' } },
      backendPreference: 'invidious', backendFallback: true,
      isCurrentVideoLoad: () => true,
      scheduleDownloadedPlaybackFallback() {},
      settleDownloadedPlaybackFallback: () => false,
      t: key => key,
      getVideoInformationLocal: async () => events.push('local'),
    }
    await watch.getVideoInformationInvidious(1, metadataOnly)
    assert.deepEqual(events, ['warning', 'local'])
  })
}
