export function shouldUseGoogleVideoPostRequest(
  url,
  isSabrRequest,
  isCapacitor = Boolean(process.env.IS_CAPACITOR)
) {
  return !isCapacitor &&
    !isSabrRequest &&
    url.hostname.endsWith('.googlevideo.com') &&
    url.pathname === '/videoplayback'
}
