import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'

test('imports current OpenTubeX subscriptions including null primary names and profile icons', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('createProfile', {
      _id: 'unrelated-test-profile',
      name: 'A Test',
      bgColor: '#111111',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '🚫' },
      subscriptions: []
    })
    await store.dispatch('createProfile', {
      _id: 'exact-test-profile',
      name: 'Test',
      bgColor: '#222222',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '⏳' },
      subscriptions: []
    })

    const exportedProfile = {
      _id: 'allChannels',
      name: null,
      bgColor: 'transparent',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '🧪' },
      subscriptions: [{
        id: 'UCcurrentFormatImport',
        name: 'Current Format Channel',
        thumbnail: null
      }]
    }
    const exportedNamedProfile = {
      _id: 'imported-test-profile',
      name: 'Test',
      bgColor: '#333333',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '🔎' },
      subscriptions: [{
        id: 'UCnamedProfileImport',
        name: 'Named Profile Channel',
        thumbnail: null
      }]
    }
    const exportedPrimaryNameProfile = {
      _id: 'primary-name-profile',
      name: 'Profile.All Channels',
      bgColor: '#444444',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '🛰️' },
      subscriptions: [{
        id: 'UCprimaryNameImport',
        name: 'Primary Name Channel',
        thumbnail: null
      }]
    }
    const exportedIdCollisionProfile = {
      _id: 'unrelated-test-profile',
      name: 'Collision Import',
      bgColor: '#555555',
      textColor: '#FFFFFF',
      icon: { type: 'emoji', value: '🛡️' },
      subscriptions: [{
        id: 'UCidCollisionImport',
        name: 'ID Collision Channel',
        thumbnail: null
      }]
    }
    const contents = [
      exportedProfile,
      exportedNamedProfile,
      exportedPrimaryNameProfile,
      exportedIdCollisionProfile
    ]
      .map(profile => JSON.stringify(profile))
      .join('\n')

    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        getFile: async () => new File(
          [contents],
          'opentubex-subscriptions.db',
          { type: 'application/x-freetube-db' }
        )
      }]
    })
  })

  await dataSection.getByRole('button', { name: 'Import subscriptions', exact: true }).click()

  await expect(page.locator('.toast', {
    hasText: 'All subscriptions and profiles have been successfully imported'
  })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Unknown data key' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const profiles = store.getters.getProfileList
    const profile = profiles[0]
    const unrelatedProfile = profiles.find(({ _id }) => _id === 'unrelated-test-profile')
    const exactProfile = profiles.find(({ _id }) => _id === 'exact-test-profile')
    const primaryNameProfile = profiles.find(({ _id }) => _id === 'primary-name-profile')
    const idCollisionProfile = profiles.find(({ name }) => name === 'Collision Import')
    return {
      hasSubscription: profile.subscriptions.some(({ id }) => id === 'UCcurrentFormatImport'),
      icon: profile.icon,
      unrelatedProfile: {
        hasSubscription: unrelatedProfile.subscriptions.some(({ id }) => id === 'UCnamedProfileImport'),
        hasIdCollisionSubscription: unrelatedProfile.subscriptions.some(({ id }) => id === 'UCidCollisionImport'),
        icon: unrelatedProfile.icon
      },
      exactProfile: {
        hasSubscription: exactProfile.subscriptions.some(({ id }) => id === 'UCnamedProfileImport'),
        icon: exactProfile.icon
      },
      primaryNameProfile: {
        hasSubscription: primaryNameProfile.subscriptions.some(({ id }) => id === 'UCprimaryNameImport'),
        icon: primaryNameProfile.icon
      },
      idCollisionProfile: {
        hasGeneratedId: idCollisionProfile._id !== 'unrelated-test-profile',
        hasSubscription: idCollisionProfile.subscriptions.some(({ id }) => id === 'UCidCollisionImport'),
        icon: idCollisionProfile.icon
      }
    }
  })).toEqual({
    hasSubscription: true,
    icon: { type: 'emoji', value: '🧪' },
    unrelatedProfile: {
      hasSubscription: false,
      hasIdCollisionSubscription: false,
      icon: { type: 'emoji', value: '🚫' }
    },
    exactProfile: {
      hasSubscription: true,
      icon: { type: 'emoji', value: '🔎' }
    },
    primaryNameProfile: {
      hasSubscription: true,
      icon: { type: 'emoji', value: '🛰️' }
    },
    idCollisionProfile: {
      hasGeneratedId: true,
      hasSubscription: true,
      icon: { type: 'emoji', value: '🛡️' }
    }
  })
})

async function blockSubscriptionImport(app, fail = false) {
  await app.electronApp.evaluate(({ ipcMain }, fail) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    globalThis.finishSubscriptionImport = null
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method !== 'importSubscriptionProfiles') return handler(event, request)
      return new Promise((resolve, reject) => {
        globalThis.finishSubscriptionImport = async () => {
          ipcMain.removeHandler('library-query')
          ipcMain.handle('library-query', handler)
          if (fail) reject(new Error('simulated subscription import write failure'))
          else {
            try { resolve(await handler(event, request)) } catch (error) { reject(error) }
          }
        }
      })
    })
  }, fail)
}

for (const failure of [false, true]) {
  test(`legacy subscription import waits for durable writes and preserves existing data, failure: ${failure}`, async ({ app, page }) => {
    const dataSection = await goToSettingsSection(page, 'data')
    await blockSubscriptionImport(app, failure)
    const before = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const before = JSON.parse(JSON.stringify(store.getters.getProfileList))
      window.__subscriptionImportMessages = []
      const dispatchEvent = EventTarget.prototype.dispatchEvent
      EventTarget.prototype.dispatchEvent = function (event) {
        if (event.type === 'toast-open') window.__subscriptionImportMessages.push(event.detail.message)
        return dispatchEvent.call(this, event)
      }
      const profile = {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#123456',
        textColor: '#FFFFFF',
        icon: { type: 'emoji', value: '🧪' },
        subscriptions: [{ id: 'UCdurableImport', name: 'Imported', thumbnail: null }]
      }
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{ getFile: async () => new File([JSON.stringify(profile)], 'legacy.db', { type: 'application/x-freetube-db' }) }]
      })
      return before
    })
    await dataSection.getByRole('button', { name: 'Import subscriptions', exact: true }).click()
    await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.finishSubscriptionImport)).toBe('function')
    const success = 'All subscriptions and profiles have been successfully imported'
    expect(await page.evaluate(() => window.__subscriptionImportMessages)).not.toContain(success)
    const read = () => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getProfileList)))
    expect(await read()).toStrictEqual(before)
    await app.electronApp.evaluate(() => globalThis.finishSubscriptionImport())
    if (failure) {
      await expect.poll(() => page.evaluate(() => window.__subscriptionImportMessages)).toContain('Import failed')
      expect(await page.evaluate(() => window.__subscriptionImportMessages)).not.toContain(success)
      expect(await read()).toStrictEqual(before)
      expect(await page.evaluate(action => window.ftElectron.dbProfiles(action), DBActions.GENERAL.FIND)).toStrictEqual(before)
    } else {
      await expect.poll(() => page.evaluate(() => window.__subscriptionImportMessages)).toContain(success)
      await expect.poll(read).toStrictEqual([{ ...before[0], icon: { type: 'emoji', value: '🧪' }, subscriptions: [{ id: 'UCdurableImport', name: 'Imported', thumbnail: null }] }])
    }
  })
}

test('legacy subscription import retains concurrent additions, removals, settings and profile metadata', async ({ app, page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const before = await page.evaluate(async action => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const profile = { ...JSON.parse(JSON.stringify(store.getters.getProfileList[0])), name: 'Original', subscriptions: [{ id: 'kept', showMembersOnly: false }, { id: 'removed' }], futureMetadata: { keep: true } }
    await window.ftElectron.dbProfiles(action, profile)
    await store.dispatch('grabAllProfiles')
    const imported = { ...profile, name: 'Imported old name', subscriptions: [{ id: 'kept', showMembersOnly: false }, { id: 'imported' }] }
    delete imported.futureMetadata
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{ getFile: async () => new File([JSON.stringify(imported)], 'concurrent.db', { type: 'application/x-freetube-db' }) }]
    })
    return profile
  }, DBActions.GENERAL.UPSERT)
  await blockSubscriptionImport(app)
  await dataSection.getByRole('button', { name: 'Import subscriptions', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.finishSubscriptionImport)).toBe('function')
  const current = { ...before, name: 'Concurrent profile name', subscriptions: [{ id: 'kept', showMembersOnly: true, futureSetting: 42 }, { id: 'concurrent' }] }
  await page.evaluate(({ action, profile }) => window.ftElectron.dbProfiles(action, profile), { action: DBActions.GENERAL.UPSERT, profile: current })
  await app.electronApp.evaluate(() => globalThis.finishSubscriptionImport())
  const expected = { ...current, subscriptions: [...current.subscriptions, { id: 'imported' }] }
  await expect.poll(() => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getProfileList)))).toStrictEqual([expected])
  expect(await page.evaluate(action => window.ftElectron.dbProfiles(action), DBActions.GENERAL.FIND)).toStrictEqual([expected])
})

test('imports the older channel-per-line subscription format into desktop SQLite', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(() => {
    const channel = {
      _id: 'old-channel-record',
      channelId: 'UColderFormatImport',
      channelName: 'Older Format Channel',
      channelThumbnail: 'https://example.com/legacy.png',
      profile: [{ value: 'Legacy Profile' }]
    }
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{ getFile: async () => new File([JSON.stringify(channel)], 'older.db', { type: 'application/x-freetube-db' }) }]
    })
  })
  await dataSection.getByRole('button', { name: 'Import subscriptions', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const profiles = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getProfileList
    return profiles.filter(profile => profile.subscriptions.some(channel => channel.id === 'UColderFormatImport')).map(profile => profile._id)
  })).toEqual(['allChannels', 'old-channel-record'])
})
