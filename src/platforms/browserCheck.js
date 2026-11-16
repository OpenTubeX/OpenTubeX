// @ts-check

/** The platform only shows the page to browsers that passed a check, such as a Cloudflare challenge */
export class PlatformBrowserCheckError extends Error {
  /**
   * @param {string} platform
   * @param {string} url the page that asked for the check
   */
  constructor(platform, url) {
    super(`${platform} asked for a browser check`)
    this.platform = platform
    this.url = url
  }
}
