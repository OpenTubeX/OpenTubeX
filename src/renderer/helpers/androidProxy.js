import { registerPlugin } from '@capacitor/core'

const AndroidProxy = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidProxy') : null

export const ANDROID_PROXY_SETTING_KEYS = [
  'useProxy', 'proxyProtocol', 'proxyHostname', 'proxyPort', 'proxyUsername', 'proxyPassword'
]

export function configureAndroidProxy(settings) {
  if (process.env.IS_IOS && settings.useProxy) {
    return Promise.reject(new Error('Proxy configuration is unavailable on iOS'))
  }
  if (!AndroidProxy) return Promise.resolve()
  return AndroidProxy.configure({
    enabled: settings.useProxy,
    protocol: settings.proxyProtocol,
    hostname: settings.proxyHostname,
    port: settings.proxyPort,
    username: settings.proxyUsername,
    password: settings.proxyPassword,
  })
}

export async function readAndroidProxySettings() {
  if (!AndroidProxy) return null
  const configuration = await AndroidProxy.getConfiguration()
  return {
    useProxy: configuration.enabled,
    proxyProtocol: configuration.protocol,
    proxyHostname: configuration.hostname,
    proxyPort: configuration.port,
    proxyUsername: configuration.username,
    proxyPassword: configuration.password,
  }
}
