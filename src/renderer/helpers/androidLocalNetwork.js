import { registerPlugin } from '@capacitor/core'

const AndroidLocalNetwork = process.env.IS_CAPACITOR && !process.env.IS_IOS
  ? registerPlugin('AndroidLocalNetwork')
  : null
let pendingPermission

export async function ensureAndroidLocalNetworkAccess(options = {}) {
  if (!AndroidLocalNetwork) return
  const { required } = await AndroidLocalNetwork.checkAccess(options)
  if (!required) return
  // Concurrent sync and discovery requests share the same system prompt.
  pendingPermission ??= AndroidLocalNetwork.requestPermissions()
    .finally(() => { pendingPermission = undefined })
  const { localNetwork } = await pendingPermission
  if (localNetwork !== 'granted') {
    const { default: i18n } = await import('../i18n/index.js')
    throw Object.assign(new Error(i18n.global.t('Native Permissions.Local Network Denied')), { code: 'LOCAL_ACCESS_DENIED' })
  }
}
