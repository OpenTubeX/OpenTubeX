import { test } from 'node:test'
import { verifySyncDeviceRemoval } from '../../e2e/helpers/sync-device-removal.mjs'
import { blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'

for (const options of [{ otherLogin: false }, { revokeFailsOnce: true }, { current: true, reconnectDuringCleanup: true }]) {
  let behavior = 'cleans up synced tabs and orphaned sets can be deleted'
  if (options.revokeFailsOnce) behavior = 'reports partial completion when revocation fails and can be retried'
  if (options.current) behavior = 'disconnects after preserving a reconnected login during current revocation'
  test(`Android device removal ${behavior}`, {
    skip: !process.env.ANDROID_CDP_URL,
  }, async () => {
    const { browser, page } = await connectAndroidApp()
    const keepAlive = setTimeout(() => {}, 120_000)
    try {
      await page.reload()
      const skip = page.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      // The restored tabs must not reach YouTube; the fixture serves sync.
      await blockAppNetwork(page)
      await verifySyncDeviceRemoval(page, { phone: true, ...options })
    } finally {
      clearTimeout(keepAlive)
      await page.evaluate(() => window.__androidTestNetwork?.restore()).catch(() => {})
      await browser.close()
    }
  })
}

for (const { conflict, intentionalDeletion, olderLogin, pendingRevocation, abandonRevocation } of [{ conflict: false }, { conflict: true }, { intentionalDeletion: true }, { olderLogin: true }, { pendingRevocation: true }, { abandonRevocation: true }]) {
  test(abandonRevocation ? 'Android cancelled revocation reports paused tab sync and can be completed' : pendingRevocation ? 'Android pending revocation blocks sync while preserving local tabs' : olderLogin ? 'Android upgrade reclaims tabs after an older client signs back in' : intentionalDeletion ? 'Android reauthentication preserves intentional tab-set deletion' : `Android revoked phone reconnects with its persisted device ID after ${conflict ? 'a conflict' : 'a failed upload'}`, {
    skip: !process.env.ANDROID_CDP_URL,
  }, async () => {
    const { verifySyncDeviceReconnection } = await import('../../e2e/helpers/sync-device-reconnection.mjs')
    const { browser, page } = await connectAndroidApp()
    const keepAlive = setTimeout(() => {}, 120_000)
    try {
      await page.reload()
      await blockAppNetwork(page)
      await verifySyncDeviceReconnection(page, { conflict, intentionalDeletion, olderLogin, pendingRevocation, abandonRevocation, phone: true })
    } finally {
      clearTimeout(keepAlive)
      await page.evaluate(() => window.__androidTestNetwork?.restore()).catch(() => {})
      await browser.close()
    }
  })
}
