/**
 * Permanently replaces a datastore handler for this isolated E2E app process.
 * Install it after startup has finished loading the datastore.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} channel
 */
export function rejectDatastoreRequests(electronApp, channel) {
  return electronApp.evaluate(({ ipcMain }, channel_) => {
    ipcMain.removeHandler(channel_)
    ipcMain.handle(channel_, () => {
      throw new Error('Synthetic datastore failure')
    })
  }, channel)
}
