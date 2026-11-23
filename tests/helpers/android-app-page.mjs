/**
 * Returns the app's page in an Android WebView CDP connection, or undefined
 * while it hasn't loaded yet. The first page isn't always the app: the PO token
 * attestation WebView stays alive as an `about:blank` target after a video
 * load and can be listed before it.
 * @param {import('@playwright/test').Browser} browser
 */
export function appPage(browser) {
  return browser.contexts()
    .flatMap(context => context.pages())
    .find(page => page.url().startsWith('https://localhost/'))
}
