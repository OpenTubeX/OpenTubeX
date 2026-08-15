import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

test('imports current OpenTubeX subscriptions without rejecting profile icons', async ({ page }) => {
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
      name: 'Profile.All Channels',
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
    const contents = [exportedProfile, exportedNamedProfile, exportedPrimaryNameProfile]
      .map(profile => JSON.stringify(profile))
      .join('\n') + '\n'

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
    return {
      hasSubscription: profile.subscriptions.some(({ id }) => id === 'UCcurrentFormatImport'),
      icon: profile.icon,
      unrelatedProfile: {
        hasSubscription: unrelatedProfile.subscriptions.some(({ id }) => id === 'UCnamedProfileImport'),
        icon: unrelatedProfile.icon
      },
      exactProfile: {
        hasSubscription: exactProfile.subscriptions.some(({ id }) => id === 'UCnamedProfileImport'),
        icon: exactProfile.icon
      },
      primaryNameProfile: {
        hasSubscription: primaryNameProfile.subscriptions.some(({ id }) => id === 'UCprimaryNameImport'),
        icon: primaryNameProfile.icon
      }
    }
  })).toEqual({
    hasSubscription: true,
    icon: { type: 'emoji', value: '🧪' },
    unrelatedProfile: {
      hasSubscription: false,
      icon: { type: 'emoji', value: '🚫' }
    },
    exactProfile: {
      hasSubscription: true,
      icon: { type: 'emoji', value: '🔎' }
    },
    primaryNameProfile: {
      hasSubscription: true,
      icon: { type: 'emoji', value: '🛰️' }
    }
  })
})
