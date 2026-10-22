import { registerPlugin } from '@capacitor/core'

const AndroidLocalNetwork = process.env.IS_CAPACITOR && !process.env.IS_IOS
  ? registerPlugin('AndroidLocalNetwork')
  : null
let pendingPermission
/** @type {Promise<boolean> | undefined} */
let neverRequired

/**
 * Android 16 and lower, and a granted permission, need no check for any host.
 * A check without a host otherwise always reports the permission as required,
 * so one such check tells whether every later request can skip the bridge.
 */
function isAccessNeverRequired() {
  neverRequired ??= AndroidLocalNetwork.checkAccess({}).then(({ required }) => !required, () => false)
  return neverRequired
}

export async function ensureAndroidLocalNetworkAccess(options = {}) {
  if (!AndroidLocalNetwork || await isAccessNeverRequired()) return
  const { required } = await AndroidLocalNetwork.checkAccess(options)
  if (!required) return
  // Concurrent sync and discovery requests share the same system prompt.
  if (options.requestPermission !== false) {
    pendingPermission ??= AndroidLocalNetwork.requestPermissions()
      .finally(() => { pendingPermission = undefined })
  }
  const { localNetwork } = pendingPermission ? await pendingPermission : { localNetwork: 'denied' }
  if (localNetwork !== 'granted') {
    const { default: i18n } = await import('../i18n/index.js')
    throw Object.assign(new Error(i18n.global.t('Native Permissions.Local Network Denied')), { code: 'LOCAL_ACCESS_DENIED' })
  }
  neverRequired = Promise.resolve(true)
}
