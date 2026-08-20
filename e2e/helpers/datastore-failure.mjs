/**
 * Permanently replaces a datastore handler for this isolated E2E app process.
 * Install it after startup has finished loading the datastore.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} channel
 * @param {number} [delayMs]
 */
export function rejectDatastoreRequests(electronApp, channel, delayMs = 0) {
  return electronApp.evaluate(({ ipcMain }, options) => {
    ipcMain.removeHandler(options.channel)
    ipcMain.handle(options.channel, async () => {
      if (options.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs))
      }
      throw new Error('Synthetic datastore failure')
    })
  }, { channel, delayMs })
}
