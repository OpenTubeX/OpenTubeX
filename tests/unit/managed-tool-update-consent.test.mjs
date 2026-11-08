import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { createDefaultSettings } from '../../src/settingsDefaults.js'

const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const promptSource = source.slice(
  source.indexOf('function showManagedExternalSoftwareUpdatePrompt('),
  source.indexOf('const MANAGED_TOOLS_UPDATE_PREVIEW_EVENT')
)

function showPrompt(isCapacitor) {
  const toasts = []
  const context = vm.createContext({
    isCapacitor,
    t: key => key.split('.').at(-1),
    showToast: toast => toasts.push(toast),
    initializeManagedExternalSoftware: async () => {},
    console,
  })
  vm.runInContext(`${promptSource}\nshowManagedExternalSoftwareUpdatePrompt(['yt-dlp'])`, context)
  return toasts[0].message
}

test('Android asks before downloading yt-dlp updates', () => {
  assert.equal(createDefaultSettings({ supportsLocalApi: true, isElectron: false }).externalSoftwareUpdateMode, 'ask')
  assert.equal(createDefaultSettings({ supportsLocalApi: true, isElectron: true }).externalSoftwareUpdateMode, 'automatic')
})

test('the Android update prompt explains that app stores do not check the download', () => {
  assert.equal(showPrompt(true), 'Managed Tools Update Available Template Managed Tools Update Source Notice')
  assert.equal(showPrompt(false), 'Managed Tools Update Available Template')
})
