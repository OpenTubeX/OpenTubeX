import * as refreshData from '../../src/renderer/helpers/androidSubscriptionRefreshData.js'
import { importWithStubs, sourceUrl } from './module-stubs.mjs'

/**
 * Stand-ins for the composable's platform and store dependencies. Tests
 * replace the functions they care about; each fixture resets them.
 */
export const hooks = {}

function resetHooks() {
  Object.assign(hooks, {
    store: createStore(),
    isAppHidden: () => false,
    acknowledge: async () => {},
    addCancelledListener: async () => () => {},
    configureAndroid: async () => {},
    getAndroidState: async () => ({ inProgress: false, ownedByRenderer: true }),
    getNextResult: async () => null,
    requestNotificationPermission: async () => false,
    startAndroid: async () => ({ acquired: true, notificationsDenied: false }),
    updateAndroid: () => {},
    cancelSubscriptionRefresh: () => {},
    notifySubscriptionChannelRefreshed: () => {},
    refresh: async () => [],
    enrichSubscriptionRssEntries: async entries => entries,
    enrichSubscriptionShortDates: async entries => entries,
    reconcileFetchedSubscriptionEntries: entries => entries,
    shouldHideMembersOnlyContent: () => false,
    invidiousGetVideoInformation: async () => { throw new Error('Unexpected Invidious request') },
  })
}

/**
 * @param {Record<string, unknown>} [getters]
 */
export function createStore(getters = {}) {
  const store = {
    commits: [],
    dispatches: [],
    getters: {
      getSubscriptionFeedAutoRefreshInterval: '0',
      getSubscriptionShortsAutoRefreshInterval: '0',
      getSubscriptionLiveAutoRefreshInterval: '0',
      getSubscriptionPostsAutoRefreshInterval: '0',
      getActiveProfile: { _id: 'all' },
      getProfileList: [{ _id: 'all', subscriptions: [] }],
      profileById: id => store.getters.getProfileList.find(profile => profile._id === id),
      getSubscriptionCacheReady: true,
      getSubscriptionFeedRefreshInProgress: false,
      getSubscriptionFeedRefreshTab: null,
      getSubscriptionFeedRefreshProgress: 0,
      ...getters,
    },
    commit(type, value) {
      store.commits.push([type, value])
      if (type === 'setSubscriptionFeedRefreshInProgress') store.getters.getSubscriptionFeedRefreshInProgress = value
      if (type === 'setSubscriptionFeedRefreshTab') store.getters.getSubscriptionFeedRefreshTab = value
      if (type === 'setSubscriptionFeedRefreshProgress') store.getters.getSubscriptionFeedRefreshProgress = value
    },
    dispatch: async (type, value) => {
      store.dispatches.push(type)
      return store.onDispatch?.(type, value)
    },
  }
  return store
}

export const events = {
  cancelled: 'opentubex-subscription-refresh-cancelled',
  completed: 'opentubex-subscription-refresh-completed',
  finished: 'opentubex-subscription-refresh-finished',
  progress: 'opentubex-subscription-refresh-progress',
  started: 'opentubex-subscription-refresh-started',
}
export const PROGRESS_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.inProgress'
export const deadlineKey = (profileId, tab) => `opentubex.subscriptionAutoRefresh.deadline.${encodeURIComponent(profileId)}/${tab}`

let variant = 0

/**
 * Imports the composable for one platform. Its platform checks run when the
 * module loads, so each platform gets its own module instance.
 * @param {{ IS_ELECTRON?: string, IS_CAPACITOR?: string, IS_IOS?: string }} env
 * @returns {Promise<typeof import('../../src/renderer/composables/useSubscriptionAutoRefresh.js')>}
 */
export async function loadSubscriptionAutoRefresh(env) {
  for (const name of ['IS_ELECTRON', 'IS_CAPACITOR', 'IS_IOS']) {
    if (env[name]) process.env[name] = env[name]
    else delete process.env[name]
  }
  installBrowserGlobals()
  resetHooks()
  const call = name => (...args) => hooks[name](...args)
  const [module] = await importWithStubs([`${sourceUrl('src/renderer/composables/useSubscriptionAutoRefresh.js')}?${variant++}`], {
    [sourceUrl('src/renderer/store/index.js')]: {
      default: new Proxy({}, { get: (_target, key) => hooks.store[key] }),
    },
    [sourceUrl('src/renderer/helpers/appVisibility.js')]: { isAppHidden: call('isAppHidden') },
    [sourceUrl('src/renderer/helpers/ytDlpCapabilities.js')]: { supportsYtDlp: false },
    [sourceUrl('src/renderer/helpers/utils.js')]: {
      getInvidiousApiErrorMessage: () => 'Invidious API Error',
      showApiErrorToast: () => {},
      showToast: () => {},
    },
    [sourceUrl('src/renderer/helpers/capacitorUi.js')]: { openNotificationSettings: () => {} },
    [sourceUrl('src/renderer/helpers/androidSubscriptionRefresh.js')]: {
      acknowledgeAndroidSubscriptionRefreshResult: call('acknowledge'),
      addAndroidSubscriptionRefreshCancelledListener: call('addCancelledListener'),
      configureAndroidSubscriptionRefresh: call('configureAndroid'),
      getAndroidSubscriptionRefreshState: call('getAndroidState'),
      getNextAndroidSubscriptionRefreshResult: call('getNextResult'),
      requestAndroidSubscriptionRefreshNotificationPermission: call('requestNotificationPermission'),
      startAndroidSubscriptionRefresh: call('startAndroid'),
      updateAndroidSubscriptionRefresh: call('updateAndroid'),
    },
    [sourceUrl('src/renderer/helpers/uploadNotifications.js')]: { configureUploadNotifications: async () => {} },
    [sourceUrl('src/renderer/helpers/androidSubscriptionRefreshData.js')]: {
      ...refreshData,
      // The configuration reads every subscription setting; these tests don't configure it.
      createAndroidSubscriptionRefreshConfiguration: () => ({ intervals: {} }),
    },
    [sourceUrl('src/renderer/helpers/restricted-playback.js')]: {
      hasConfiguredRestrictedPlaybackAuthentication: () => false,
      shouldHideMembersOnlyContent: call('shouldHideMembersOnlyContent'),
    },
    [sourceUrl('src/renderer/helpers/api/local.js')]: { normalizeLocalSubscriptionFeed: () => [] },
    [sourceUrl('src/renderer/helpers/api/invidious.js')]: {
      invidiousGetVideoInformation: call('invidiousGetVideoInformation'),
      normalizeInvidiousSubscriptionFeed: () => [],
    },
    [sourceUrl('src/renderer/helpers/subscription-entries.js')]: {
      reconcileFetchedSubscriptionEntries: call('reconcileFetchedSubscriptionEntries'),
    },
    [sourceUrl('src/renderer/helpers/subscriptions.js')]: {
      enrichSubscriptionRssEntries: call('enrichSubscriptionRssEntries'),
      enrichSubscriptionShortDates: call('enrichSubscriptionShortDates'),
      cancelSubscriptionRefresh: call('cancelSubscriptionRefresh'),
      notifySubscriptionChannelRefreshed: call('notifySubscriptionChannelRefreshed'),
      refreshSubscriptionLiveFromRemote: call('refresh'),
      refreshSubscriptionPostsFromRemote: call('refresh'),
      refreshSubscriptionShortsFromRemote: call('refresh'),
      refreshSubscriptionVideosFromRemote: call('refresh'),
      SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY: 'opentubex.subscriptionAutoRefresh.cancel',
      SUBSCRIPTION_REFRESH_CANCELLED_EVENT: events.cancelled,
      SUBSCRIPTION_REFRESH_COMPLETED_EVENT: events.completed,
      SUBSCRIPTION_REFRESH_FINISHED_EVENT: events.finished,
      SUBSCRIPTION_REFRESH_LOCK_NAME: 'opentubex-subscription-refresh',
      SUBSCRIPTION_REFRESH_PROGRESS_EVENT: events.progress,
      SUBSCRIPTION_REFRESH_STARTED_EVENT: events.started,
    },
  })
  return module
}

/** A window, document, localStorage and navigator like a renderer's. */
function installBrowserGlobals() {
  if (globalThis.window?.isSubscriptionAutoRefreshFixture) return
  const window = new EventTarget()
  window.isSubscriptionAutoRefreshFixture = true
  globalThis.window = window
  globalThis.document = new EventTarget()
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear(),
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true, locks: null },
    configurable: true,
    writable: true,
  })
}

/** Lets every already resolved promise chain finish. */
export function settle() {
  return new Promise(resolve => setImmediate(resolve))
}
