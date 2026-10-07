import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { verifySyncDeviceRemoval } from '../../e2e/helpers/sync-device-removal.mjs'

for (const options of [{ otherLogin: false }, { otherLogin: true }, { otherLogin: true, otherLoginExpires: true }, { revokeFailsOnce: true }, { revokeResponseLost: true }, { loginDisappears: true }, { reconnectDuringCleanup: true }, { postCleanupFailsOnce: true }, { current: true, reconnectDuringCleanup: true }]) {
  let behavior = `${options.otherLogin ? 'preserves tabs used by another login' : 'cleans up synced tabs'} and orphaned sets can be deleted`
  if (options.otherLoginExpires) behavior = 'reconfirms tab deletion when another login expires'
  if (options.revokeFailsOnce) behavior = 'reports partial completion when revocation fails and can be retried'
  if (options.revokeResponseLost) behavior = 'finishes after a lost revocation response without repeating deletion'
  if (options.loginDisappears) behavior = 'cleans up tabs when the login disappears before confirmation'
  if (options.reconnectDuringCleanup) behavior = 'preserves tabs when another login reconnects during a conflict retry'
  if (options.postCleanupFailsOnce) behavior = 'finishes released-client cleanup after revocation and retries without another DELETE'
  if (options.current) behavior = 'disconnects after preserving a reconnected login during current revocation'
  test(`Android device removal ${behavior}`, {
    skip: !process.env.ANDROID_CDP_URL,
  }, async () => {
    const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    const keepAlive = setTimeout(() => {}, 120_000)
    try {
      const page = browser.contexts()[0].pages()[0]
      await page.reload()
      const skip = page.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      await verifySyncDeviceRemoval(page, { phone: true, ...options })
    } finally {
      clearTimeout(keepAlive)
      await browser.close()
    }
  })
}

for (const { conflict, intentionalDeletion, olderLogin, pendingRevocation, abandonRevocation } of [{ conflict: false }, { conflict: true }, { intentionalDeletion: true }, { olderLogin: true }, { pendingRevocation: true }, { abandonRevocation: true }]) {
  test(abandonRevocation ? 'Android cancelled revocation reports paused tab sync and can be completed' : pendingRevocation ? 'Android pending revocation blocks sync while preserving local tabs' : olderLogin ? 'Android upgrade reclaims tabs after an older client signs back in' : intentionalDeletion ? 'Android reauthentication preserves intentional tab-set deletion' : `Android revoked phone reconnects with its persisted device ID after ${conflict ? 'a conflict' : 'a failed upload'}`, {
    skip: !process.env.ANDROID_CDP_URL,
  }, async () => {
    const { verifySyncDeviceReconnection } = await import('../../e2e/helpers/sync-device-reconnection.mjs')
    const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    const keepAlive = setTimeout(() => {}, 120_000)
    try {
      const page = browser.contexts()[0].pages()[0]
      await page.reload()
      await verifySyncDeviceReconnection(page, { conflict, intentionalDeletion, olderLogin, pendingRevocation, abandonRevocation, phone: true })
    } finally {
      clearTimeout(keepAlive)
      await browser.close()
    }
  })
}
