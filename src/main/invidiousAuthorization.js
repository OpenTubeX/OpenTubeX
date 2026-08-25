/**
 * @param {string} url
 * @param {string} instanceUrl
 */
export function isInvidiousInstanceUrl(url, instanceUrl) {
  let request
  let instance

  try {
    request = new URL(url)
    instance = new URL(instanceUrl)
  } catch {
    return false
  }

  if (request.origin !== instance.origin) return false

  const instancePath = instance.pathname.replace(/\/+$/, '')
  return instancePath === '' ||
    request.pathname === instancePath ||
    request.pathname.startsWith(`${instancePath}/`)
}
