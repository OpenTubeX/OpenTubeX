<template>
  <div
    v-if="props.enabled"
    class="capacitorPhoneTabSwitcher"
  >
    <button
      ref="triggerRef"
      type="button"
      class="capacitorPhoneTabSwitcherButton"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      aria-controls="capacitor-phone-tab-dialog"
      @click="openSwitcher"
    >
      <FtIcon
        :icon="['fas', 'layer-group']"
        aria-hidden="true"
      />
      <span
        class="capacitorPhoneTabCount"
        aria-hidden="true"
      >{{ tabs.length }}</span>
    </button>

    <Teleport to="body">
      <Transition
        name="capacitor-tabs-dialog"
        :css="!skipDialogTransition"
        @after-leave="restoreTriggerFocus"
      >
        <div
          v-if="open"
          class="capacitorPhoneTabOverlay"
          :class="{ organizerGesture }"
          :aria-hidden="organizerGesture || undefined"
          @pointerdown.self.stop
          @click.self.stop="closeSwitcher"
          @keydown="handleDialogKeydown"
        >
          <section
            id="capacitor-phone-tab-dialog"
            ref="dialogRef"
            class="capacitorPhoneTabDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capacitor-phone-tab-dialog-title"
            :inert="organizerGesture || sessionToDelete !== null || sessionToOpen !== null"
          >
            <header class="capacitorPhoneTabHeader">
              <button
                v-if="activeView === 'history'"
                type="button"
                class="capacitorPhoneTabHeaderButton"
                :aria-label="t('Back')"
                @click="selectView('open', true)"
              >
                <FtIcon
                  :icon="['fas', 'arrow-left']"
                  aria-hidden="true"
                />
              </button>
              <div class="capacitorPhoneTabHeading">
                <h2 id="capacitor-phone-tab-dialog-title">
                  {{ activeView === 'history' ? t('Tab Organizer.Tab History') : t('Tab Organizer.Title') }}
                </h2>
                <span v-if="activeView === 'open'">
                  {{ t('Tab Organizer.Open Tab Count', { count: tabs.length }, tabs.length) }}
                </span>
                <span
                  v-else-if="activeView === 'history'"
                  dir="auto"
                >{{ presentedTab ? tabTitle(presentedTab) : '' }}</span>
                <span v-else>{{ t('Settings.Sync Settings.Tabs From Other Devices') }}</span>
              </div>
              <button
                v-if="activeView === 'open'"
                type="button"
                class="capacitorPhoneTabHeaderButton"
                :disabled="closedTabs.length === 0"
                :aria-label="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
                :title="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
                @click="restoreClosedTab"
              >
                <FtIcon
                  :icon="['fas', 'clock-rotate-left']"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                class="capacitorPhoneTabHeaderButton"
                :aria-label="t('Close')"
                :title="t('Close')"
                @click="closeSwitcher"
              >
                <FtIcon
                  :icon="['fas', 'times']"
                  aria-hidden="true"
                />
              </button>
            </header>
            <CapacitorTabSelectionControls
              v-if="selecting"
              :count="selectedTabIds.size"
              :busy="closingTabs || runningSelectionAction"
              :can-pin="canPinSelectedTabs"
              :can-unpin="canUnpinSelectedTabs"
              :can-load="canLoadSelectedTabs"
              :can-unload="canUnloadSelectedTabs"
              @action="runSelectedTabAction"
              @close="closeSelectedTabs"
              @cancel="clearSelection"
            />
            <div
              v-if="showSyncedTabsView && activeView !== 'history'"
              class="capacitorPhoneTabViewTabs"
              role="tablist"
              :aria-label="t('Tab Organizer.Title')"
            >
              <button
                id="capacitor-phone-open-tabs-tab"
                type="button"
                class="capacitorPhoneTabViewTab"
                role="tab"
                aria-controls="capacitor-phone-open-tabs-panel"
                :aria-selected="activeView === 'open'"
                :tabindex="activeView === 'open' ? 0 : -1"
                @click="selectView('open')"
                @keydown.right.prevent="selectView('synced', true)"
              >
                {{ t('Tab Organizer.Open Tab Count', { count: tabs.length }, tabs.length) }}
              </button>
              <button
                id="capacitor-phone-synced-tabs-tab"
                type="button"
                class="capacitorPhoneTabViewTab"
                role="tab"
                aria-controls="capacitor-phone-synced-tabs-panel"
                :aria-selected="activeView === 'synced'"
                :tabindex="activeView === 'synced' ? 0 : -1"
                @click="selectView('synced')"
                @keydown.left.prevent="selectView('open', true)"
              >
                {{ t('Settings.Sync Settings.Tabs From Other Devices') }}
              </button>
            </div>
            <div
              v-if="activeView === 'open'"
              id="capacitor-phone-open-tabs-panel"
              ref="openTabsScrollRef"
              v-overlay-scrollbars
              class="capacitorPhoneTabList"
              :role="showSyncedTabsView ? 'tabpanel' : undefined"
              :aria-labelledby="showSyncedTabsView ? 'capacitor-phone-open-tabs-tab' : undefined"
            >
              <div
                ref="openTabsContentRef"
                class="capacitorPhoneOpenTabs"
                role="tablist"
                :aria-label="t('Tab Organizer.Title')"
              >
                <div
                  v-for="tab in tabs"
                  :key="tab.id"
                  class="capacitorPhoneTabRow"
                  :class="{
                    active: tab.id === activeTabId,
                    pinned: tab.isPinned,
                    unloaded: tab.isUnloaded,
                    holding: drag.tabId === tab.id && drag.ready,
                    dragging: drag.tabId === tab.id && drag.moved && !dragSettling,
                    settling: drag.tabId === tab.id && dragSettling,
                    noTransition: suppressDragTransition
                  }"
                  :style="tabCardStyle(tab.id)"
                  @pointerdown="startTabGesture($event, tab.id)"
                  @pointermove="moveTabGesture"
                  @pointerup="finishTabGesture"
                  @pointercancel="cancelTabGesture"
                  @touchmove="preventHoldScroll"
                  @touchend="finishTabTouch"
                  @contextmenu.prevent="handleTabContextMenu($event, tab.id)"
                >
                  <button
                    type="button"
                    class="capacitorPhoneTabTarget"
                    role="tab"
                    :data-tab-id="tab.id"
                    :aria-selected="tab.id === activeTabId"
                    :aria-label="tabAriaLabel(tab)"
                    :tabindex="tab.id === activeTabId ? 0 : -1"
                    @click="activateTab(tab.id, $event)"
                    @keydown="handleTabTargetKeydown($event, tab.id)"
                  >
                    <CapacitorTabPreview :tab="tab" />
                    <span class="capacitorPhoneTabTitle">
                      <span
                        v-if="tab.isLoading"
                        class="tabLoadingDot"
                        aria-hidden="true"
                      />
                      <span dir="auto">{{ tabTitle(tab) }}</span>
                    </span>
                  </button>
                  <label
                    v-if="selecting"
                    class="capacitorPhoneTabSelection"
                    @pointerdown.stop
                  >
                    <input
                      type="checkbox"
                      :checked="selectedTabIds.has(tab.id)"
                      :aria-label="t('Tab Organizer.Select Tab', { title: tabTitle(tab) })"
                      @change="toggleTabSelection(tab.id)"
                    >
                  </label>
                  <button
                    v-else
                    type="button"
                    class="capacitorPhoneTabClose"
                    :aria-label="t('Tab Organizer.Close Tab', { title: tabTitle(tab) })"
                    :title="t('Close Tab')"
                    @click="closeTab(tab.id)"
                  >
                    <FtIcon
                      :icon="['fas', 'times']"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>
            <div
              v-else-if="activeView === 'synced'"
              id="capacitor-phone-synced-tabs-panel"
              class="capacitorPhoneSyncedView"
              role="tabpanel"
              aria-labelledby="capacitor-phone-synced-tabs-tab"
            >
              <div
                v-overlay-scrollbars
                class="capacitorPhoneSyncedSessionTabs"
              >
                <div
                  class="capacitorPhoneSyncedSessionTabsInner"
                  role="tablist"
                  :aria-label="t('Settings.Sync Settings.Tabs From Other Devices')"
                >
                  <button
                    v-for="(session, index) in otherDeviceSessions"
                    :id="syncedSessionTabId(index)"
                    :key="`${session.syncDeviceId}:${session.sessionId}`"
                    type="button"
                    class="capacitorPhoneSyncedSessionTab"
                    role="tab"
                    :aria-controls="syncedSessionPanelId"
                    :aria-selected="activeOtherDeviceSessionKey === otherDeviceSessionKey(session)"
                    :tabindex="activeOtherDeviceSessionKey === otherDeviceSessionKey(session) ? 0 : -1"
                    @click="selectOtherDeviceSession(session)"
                    @keydown.left.prevent="selectOtherDeviceSessionAt(index - 1, true)"
                    @keydown.right.prevent="selectOtherDeviceSessionAt(index + 1, true)"
                    @keydown.home.prevent="selectOtherDeviceSessionAt(0, true)"
                    @keydown.end.prevent="selectOtherDeviceSessionAt(otherDeviceSessions.length - 1, true)"
                  >
                    <FtIcon
                      :icon="session.syncPlatform === 'mobile' ? ['fas', 'smartphone'] : ['fas', 'display']"
                      aria-hidden="true"
                    />
                    <strong>{{ formatDeviceSessionLabel(session, t) }}</strong>
                  </button>
                </div>
              </div>
              <div
                ref="syncedTabsScrollRef"
                v-overlay-scrollbars
                class="capacitorPhoneSyncedTabs"
              >
                <div
                  ref="syncedTabsContentRef"
                  class="capacitorPhoneSyncedTabsContent"
                >
                  <article
                    v-if="activeOtherDeviceSession"
                    :id="syncedSessionPanelId"
                    :key="activeOtherDeviceSessionKey"
                    class="capacitorPhoneSyncedSession"
                    role="tabpanel"
                    :aria-labelledby="activeOtherDeviceSessionTabId"
                  >
                    <header class="capacitorPhoneSyncedSessionHeader">
                      <button
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedOpenAll"
                        @click="sessionToOpen = activeOtherDeviceSession"
                      >
                        <FtIcon
                          :icon="['fas', 'folder-open']"
                          aria-hidden="true"
                        />
                        {{ t('Settings.Sync Settings.Open All Tabs') }}
                      </button>
                      <button
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedDelete dangerButton"
                        :aria-label="`${t('Delete')}: ${formatDeviceSessionLabel(activeOtherDeviceSession, t)}`"
                        :title="t('Delete')"
                        @click="sessionToDelete = activeOtherDeviceSession"
                      >
                        <FtIcon
                          :icon="['fas', 'trash']"
                          aria-hidden="true"
                        />
                        {{ t('Delete') }}
                      </button>
                    </header>
                    <div class="capacitorPhoneSyncedTabList">
                      <button
                        v-for="tab in activeOtherDeviceTabs"
                        :key="tab.id"
                        type="button"
                        class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedTabTarget"
                        @click="openOtherDeviceSession({ ...activeOtherDeviceSession, tabs: [tab] })"
                      >
                        <CapacitorTabPreview :tab="tab" />
                        <span dir="auto">{{ formatTabTitle(tab.title) || tab.url }}</span>
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>
            <div
              v-else
              ref="historyScrollRef"
              v-overlay-scrollbars
              class="capacitorPhoneTabHistory"
            >
              <div
                ref="historyContentRef"
                class="capacitorPhoneTabHistoryContent"
              >
                <button
                  v-for="entry in tabHistoryEntries"
                  :key="entry.index"
                  type="button"
                  class="capacitorPhoneTabHistoryEntry"
                  :aria-current="entry.offset === 0 ? 'page' : undefined"
                  @click="jumpToHistory(entry.offset)"
                >
                  <FtIcon
                    :icon="entry.icon"
                    aria-hidden="true"
                  />
                  <span
                    class="historyEntryLabel"
                    dir="auto"
                  >{{ entry.label }}</span>
                  <span
                    v-if="entry.offset === 0"
                    class="currentPageLabel"
                  >{{ t('Tab Organizer.Current Page') }}</span>
                  <FtIcon
                    v-else
                    :icon="['fas', entry.offset < 0 ? 'arrow-left' : 'arrow-right']"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <button
              v-if="activeView === 'open' && !selecting"
              type="button"
              class="capacitorPhoneTabFab"
              :aria-label="t('New Tab')"
              :title="t('New Tab')"
              @click="createTab"
            >
              <FtIcon
                :icon="['fas', 'plus']"
                aria-hidden="true"
              />
            </button>
            <CapacitorTabActionsMenu
              :related-tab-ids="relatedTabIds"
              :tab="actionTab"
              :title="actionTab ? tabTitle(actionTab) : ''"
              :youtube-url="actionTabYoutubeUrl"
              :can-toggle-loaded="canToggleActionTabLoaded"
              :show-history="!selecting && actionTab?.id === presentedTabId && actionTab?.history.length > 1"
              mode="phone"
              @select="selectActionTab"
              @close-related="closeRelatedTabs"
              @close="closeActionTab"
              @copy-youtube-link="copyActionTabYoutubeLink"
              @dismiss="closeTabActions"
              @duplicate="duplicateActionTab"
              @reload="reloadActionTab"
              @history="openTabHistory"
              @toggle-loaded="toggleActionTabLoaded"
              @toggle-pinned="toggleActionTabPinned"
            />
          </section>
        </div>
      </Transition>
    </Teleport>
    <FtPrompt
      v-if="sessionToOpen"
      :busy="isOpeningSession"
      card-class="capacitorPhoneSessionPrompt"
      :label="t('Settings.Sync Settings.Open All Tabs Confirmation')"
      :extra-labels="[formatDeviceSessionLabel(sessionToOpen, t)]"
      :option-names="[t('Settings.Sync Settings.Open All Tabs'), t('Cancel')]"
      :option-values="['open', 'cancel']"
      :option-icons="[['fas', 'folder-open'], ['fas', 'xmark']]"
      autosize
      @click="handleOpenSessionPrompt"
    />
    <FtPrompt
      v-if="sessionToDelete"
      card-class="capacitorPhoneSessionPrompt"
      :label="t('Delete')"
      :extra-labels="[formatDeviceSessionLabel(sessionToDelete, t)]"
      :option-names="[t('Delete'), t('Cancel')]"
      :option-values="['delete', 'cancel']"
      is-first-option-destructive
      autosize
      @click="handleDeleteSessionPrompt"
    />
  </div>
</template>

<script setup>
import { useChannelTabAvatars } from '../../composables/useChannelTabAvatars'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { createOrganizerSwipeAnimation, organizerSwipeProgress, shouldOpenSwipedOrganizer } from '../../helpers/organizerSwipe'
import { shouldCloseSwipedTab } from '../../helpers/capacitorTabSwipe'
import { lightHaptic } from '../../helpers/mobileHaptics'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { formatDeviceSessionLabel, shouldShowOtherDeviceSessions } from '../../helpers/sync-sessions'
import { showToast } from '../../helpers/utils'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { getSyncedTabPreview } from '../../tabs/tabPreview'
import { formatTabTitle } from '../../tabs/tabTitle'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import { captureBeforeTabOrganizer } from '../../tabs/capacitorTabPreviews'
import CapacitorTabPreview from './CapacitorTabPreview.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'
import CapacitorTabSelectionControls from './CapacitorTabSelectionControls.vue'
import CapacitorTabActionsMenu from './CapacitorTabActionsMenu.vue'
import { useCapacitorTabActions } from './useCapacitorTabActions'
import { getTabGridReorder } from './tabGridReorder'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getTabPageIcon } from '../../tabs/tabPageIcon'

const props = defineProps({
  enabled: {
    type: Boolean,
    default: process.env.IS_CAPACITOR,
  },
})
const emit = defineEmits(['request-exit'])
const { t } = useI18n()
const open = ref(false)
const organizerGesture = ref(false)
const skipDialogTransition = ref(false)
const activeView = ref('open')
const promptId = useId()
const syncedSessionIdPrefix = `capacitor-phone-synced-session-${useId().replaceAll(':', '')}`
const syncedSessionPanelId = `${syncedSessionIdPrefix}-panel`
const selectedOtherDeviceSessionKey = ref(null)
const sessionToDelete = ref(null)
const sessionToOpen = ref(null)
const isOpeningSession = ref(false)
const triggerRef = useTemplateRef('triggerRef')
const dialogRef = useTemplateRef('dialogRef')
const openTabsScrollRef = useTemplateRef('openTabsScrollRef')
const openTabsContentRef = useTemplateRef('openTabsContentRef')
const syncedTabsScrollRef = useTemplateRef('syncedTabsScrollRef')
const syncedTabsContentRef = useTemplateRef('syncedTabsContentRef')
const historyScrollRef = useTemplateRef('historyScrollRef')
const historyContentRef = useTemplateRef('historyContentRef')
const tabs = computed(() => store.getters.getTabs)
const closedTabs = computed(() => store.getters.getClosedTabs)
const activeTabId = computed(() => store.getters.getActiveTabId)
const presentedTabId = computed(() => store.getters.getPresentedTabId)
const presentedTab = computed(() => store.getters.getTabById(presentedTabId.value))
const tabHistoryEntries = computed(() => presentedTab.value?.history.map((entry, index) => ({
  index,
  offset: index - presentedTab.value.historyIndex,
  label: entry.title || entry.route.fullPath,
  icon: getTabPageIcon(entry),
})) ?? [])
const syncEnabled = computed(() => store.getters.getSyncServerEnabled)
const syncConnected = computed(() => store.getters.getSyncServerToken !== '')
const syncSessionsEnabled = computed(() => store.getters.getSyncServerSyncSessions)
const sharedTabsEnabled = computed(() => store.getters.getSyncServerSharedTabs)
const otherDeviceSessions = computed(() => store.getters.getSyncServerOtherDeviceSessions)
const activeOtherDeviceSession = computed(() => (
  otherDeviceSessions.value.find(session => (
    otherDeviceSessionKey(session) === selectedOtherDeviceSessionKey.value
  )) ?? otherDeviceSessions.value[0] ?? null
))
const activeOtherDeviceTabs = computed(() => (
  activeOtherDeviceSession.value?.tabs.map(getSyncedTabPreview) ?? []
))
useChannelTabAvatars(computed(() => open.value
  ? activeView.value === 'synced' ? activeOtherDeviceTabs.value : tabs.value
  : []))

const activeOtherDeviceSessionKey = computed(() => (
  activeOtherDeviceSession.value ? otherDeviceSessionKey(activeOtherDeviceSession.value) : null
))
const activeOtherDeviceSessionTabId = computed(() => {
  const activeIndex = otherDeviceSessions.value.findIndex(session => (
    otherDeviceSessionKey(session) === activeOtherDeviceSessionKey.value
  ))
  return syncedSessionTabId(Math.max(0, activeIndex))
})
const showSyncedTabsView = computed(() => shouldShowOtherDeviceSessions({
  syncEnabled: syncEnabled.value,
  syncConnected: syncConnected.value,
  enhancedSyncEnabled: store.getters.getSyncServerPrivacyMode === 'enhanced' &&
    syncSessionsEnabled.value,
  sharedTabsEnabled: sharedTabsEnabled.value,
  sessions: otherDeviceSessions.value,
}))
const triggerLabel = computed(() => `${t('Tab Organizer.Title')}: ${t(
  'Tab Organizer.Open Tab Count',
  { count: tabs.value.length },
  tabs.value.length
)}`)
const TAB_HOLD_DELAY = 400
const TAB_MOVE_THRESHOLD = 8
let swipeResetTimer = null
let swipeFrame = null
let swipeElement = null
const pendingSwipeCloses = new Map()
let swipeCloseQueue = Promise.resolve()
let holdTimer = null
let activatedTouchPointerId = null
let pendingTouchTabId = null
let dropTimer = null
let dragFrame = null
let dragDirty = false
let dragRects = []
let dragScrollStart = 0
let dragMaximumScrollTop = 0
let dragLayout = null
const dragOffsets = ref({})
const dragSettling = ref(false)
const suppressDragTransition = ref(false)
let contentResizeObserver = null
const viewScrollTop = { open: 0, synced: 0, history: 0 }
// Pointer samples are transient: updating them must not render the entire grid.
const swipe = {
  tabId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  deltaX: 0,
  dragging: false,
  closing: false,
  suppressClick: false,
  rowWidth: 0,
}
const drag = reactive({
  tabId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  currentX: 0,
  currentY: 0,
  ready: false,
  moved: false,
})
const {
  selecting,
  selectedTabIds,
  closingTabs,
  runningSelectionAction,
  canPinSelectedTabs,
  canUnpinSelectedTabs,
  canLoadSelectedTabs,
  canUnloadSelectedTabs,
  clearSelection,
  toggleTabSelection,
  selectActionTab,
  relatedTabIds,
  closeRelatedTabs,
  closeSelectedTabs,
  runSelectedTabAction,
  actionTab,
  actionTabYoutubeUrl,
  activateTab: activateTabAction,
  canToggleActionTabLoaded,
  closeActionTab,
  closeTab,
  closeTabActions,
  createTab,
  copyActionTabYoutubeLink,
  duplicateActionTab,
  handleTabTargetKeydown,
  openTabActions,
  reloadActionTab,
  tabAriaLabel,
  tabTitle,
  toggleActionTabLoaded,
  toggleActionTabPinned,
} = useCapacitorTabActions({
  tabs,
  presentedTabId,
  afterSelect: tabId => {
    dialogRef.value?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus({ preventScroll: true })
  },
  requestExit: () => {
    closeSwitcher()
    emit('request-exit')
  },
  afterCreate: closeSwitcher,
  afterActivate: closeSwitcher,
  afterClose: async () => {
    await nextTick()
    focusActiveTab()
  },
  afterDuplicate: closeSwitcher,
  beforeOpenActions: () => {
    resetTabSwipe()
    swipe.suppressClick = true
  },
  afterCloseActions: () => {
    window.setTimeout(() => {
      swipe.suppressClick = false
    }, 0)
  },
})

let openingSwitcher = false
let disposed = false
async function openSwitcher() {
  if (openingSwitcher || open.value || organizerTransition) return
  openingSwitcher = true
  await captureBeforeTabOrganizer()
  openingSwitcher = false
  if (disposed || !props.enabled) return
  activeView.value = 'open'
  skipDialogTransition.value = false
  open.value = true
}

// The header owns pointer capture and direction locking. This component owns
// the destination geometry and only becomes modal after the gesture commits.
let organizerTransition = null
const organizerSwipe = {
  begin() {
    if (!props.enabled || open.value || openingSwitcher || organizerTransition || disposed) return false
    const page = document.querySelector('.app > .routerView')
    if (!page) return false
    const state = { distance: 0, height: window.innerHeight, animation: null, ready: null, restoreScroll: null }
    organizerTransition = state
    window.addEventListener('resize', organizerSwipe.cancel)
    organizerGesture.value = true
    skipDialogTransition.value = true
    activeView.value = 'open'
    state.ready = (async () => {
      await captureBeforeTabOrganizer()
      if (organizerTransition !== state || disposed || !props.enabled) return
      open.value = true
      // Let the open watcher restore the organizer viewport before measuring.
      await nextTick()
      await nextTick()
      if (organizerTransition !== state) return
      const target = dialogRef.value?.querySelector(`[data-tab-id="${CSS.escape(presentedTabId.value)}"]`)
      const scroll = openTabsScrollRef.value
      if (target && scroll) {
        const scrollTop = scroll.scrollTop
        state.restoreScroll = () => restoreOverlayScrollTop(scroll, scrollTop)
        const bounds = target.getBoundingClientRect()
        const viewport = scroll.getBoundingClientRect()
        const offset = bounds.top < viewport.top ? bounds.top - viewport.top : Math.max(0, bounds.bottom - viewport.bottom)
        restoreOverlayScrollTop(scroll, scroll.scrollTop + offset)
      }
      const preview = target?.querySelector('.capacitorTabPreview')
      if (!preview) { organizerSwipe.cancel(); return }
      state.animation = createOrganizerSwipeAnimation(page, preview, dialogRef.value.closest('.capacitorPhoneTabOverlay'))
      state.animation.update(organizerSwipeProgress(state.distance, state.height))
    })()
    return true
  },
  update(distance) {
    const state = organizerTransition
    if (!state) return
    state.distance = Math.max(0, distance)
    state.animation?.update(organizerSwipeProgress(state.distance, state.height))
  },
  async finish(elapsed, cancelled) {
    const state = organizerTransition
    if (!state) return
    if (cancelled) {
      organizerSwipe.cancel()
      return
    }
    // A ready organizer must accept a new touch immediately on release.
    if (!state.animation) await state.ready
    if (organizerTransition !== state) return
    const commit = shouldOpenSwipedOrganizer(state.distance, state.height, elapsed)
    // The next touch belongs to the organizer, even while the page is still
    // settling into its card. Selecting a tab cancels the remaining animation.
    if (commit) {
      state.restoreScroll = null
      organizerGesture.value = false
    }
    await state.animation?.finish(commit)
    if (organizerTransition !== state) return
    if (!commit) {
      state.restoreScroll?.()
      open.value = false
    }
    // Keep the paused final frame until Vue has made the organizer modal (or
    // removed it), so the live page never flashes back over the finished card.
    organizerGesture.value = false
    await nextTick()
    state.animation?.dispose()
    organizerTransition = null
    window.removeEventListener('resize', organizerSwipe.cancel)
    if (commit) {
      skipDialogTransition.value = false
      focusActiveTab()
    }
  },
  cancel() {
    window.removeEventListener('resize', organizerSwipe.cancel)
    if (!organizerTransition) return
    organizerTransition.animation?.dispose()
    organizerTransition.restoreScroll?.()
    organizerTransition = null
    open.value = false
    organizerGesture.value = false
  }
}
defineExpose({ organizerSwipe })

async function selectView(view, focus = false) {
  clearSelection()
  const previousView = activeView.value
  const outgoingScroll = activeScrollRef()
  if (outgoingScroll) viewScrollTop[activeView.value] = outgoingScroll.scrollTop
  stopObservingContent()
  activeView.value = view
  await nextTick()
  const incomingScroll = activeScrollRef()
  if (incomingScroll) restoreOverlayScrollTop(incomingScroll, viewScrollTop[view])
  observeActiveContent()
  if (!focus) return

  if (view === 'open' && (previousView === 'history' || !showSyncedTabsView.value)) {
    focusActiveTab()
    return
  }
  const id = view === 'synced'
    ? 'capacitor-phone-synced-tabs-tab'
    : 'capacitor-phone-open-tabs-tab'
  dialogRef.value?.querySelector(`#${id}`)?.focus({ preventScroll: true })
}

function activeScrollRef() {
  if (activeView.value === 'history') return historyScrollRef.value
  return activeView.value === 'open' ? openTabsScrollRef.value : syncedTabsScrollRef.value
}

function activeContentRef() {
  if (activeView.value === 'history') return historyContentRef.value
  return activeView.value === 'open' ? openTabsContentRef.value : syncedTabsContentRef.value
}

async function openTabHistory() {
  closeTabActions()
  viewScrollTop.history = 0
  await selectView('history')
  const current = historyContentRef.value?.querySelector('[aria-current="page"]')
  current?.focus({ preventScroll: true })
  current?.scrollIntoView({ block: 'nearest' })
}

async function jumpToHistory(offset) {
  if (presentedTabId.value && offset !== 0) {
    await getTabNavigationService().go(presentedTabId.value, offset)
  }
  closeSwitcher()
}

function clampActiveContentScroll() {
  if (drag.ready) cancelTabGesture()
  const scroll = activeScrollRef()
  const content = activeContentRef()
  if (scroll && content) clampOverlayScrollTop(scroll, content)
}

function observeActiveContent() {
  stopObservingContent()
  const content = activeContentRef()
  if (!content) return

  contentResizeObserver = new ResizeObserver(clampActiveContentScroll)
  contentResizeObserver.observe(content)
  clampActiveContentScroll()
}

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

function closeSwitcher() {
  organizerSwipe.cancel()
  clearSelection()
  closeTabActions()
  resetTabSwipe()
  resetTabDrag()
  open.value = false
}

function restoreTriggerFocus() {
  triggerRef.value?.focus({ preventScroll: true })
}

async function restoreClosedTab() {
  if (closedTabs.value.length === 0) return

  await getCapacitorTabService().restoreClosedTab()
  closeSwitcher()
}

async function activateTab(tabId, event) {
  if (event?.detail !== 0 && event?.pointerId === activatedTouchPointerId) return
  if (swipe.suppressClick) return
  await activateTabAction(tabId)
}

function otherDeviceSessionKey(session) {
  return `${session.syncDeviceId}:${session.sessionId}`
}

function syncedSessionTabId(index) {
  return `${syncedSessionIdPrefix}-tab-${index}`
}

async function selectOtherDeviceSession(session, focus = false) {
  selectedOtherDeviceSessionKey.value = otherDeviceSessionKey(session)
  await nextTick()
  clampActiveContentScroll()
  if (!focus) return

  const index = otherDeviceSessions.value.findIndex(candidate => (
    otherDeviceSessionKey(candidate) === selectedOtherDeviceSessionKey.value
  ))
  dialogRef.value?.querySelector(`#${syncedSessionTabId(index)}`)?.focus({ preventScroll: true })
}

function selectOtherDeviceSessionAt(index, focus = false) {
  const sessions = otherDeviceSessions.value
  if (sessions.length === 0) return
  const wrappedIndex = (index + sessions.length) % sessions.length
  selectOtherDeviceSession(sessions[wrappedIndex], focus)
}

async function openOtherDeviceSession(session) {
  if (await store.dispatch('openSyncServerSession', session)) closeSwitcher()
}

async function handleOpenSessionPrompt(option) {
  if (isOpeningSession.value) return
  const session = sessionToOpen.value
  if (option !== 'open' || !session) {
    sessionToOpen.value = null
    return
  }

  isOpeningSession.value = true
  try {
    await openOtherDeviceSession(session)
  } catch (error) {
    showToast({
      message: t('Settings.Sync Settings.Sync failed', { error: error.message }),
      icon: ['fas', 'circle-exclamation'],
    })
  } finally {
    sessionToOpen.value = null
    isOpeningSession.value = false
  }
}

async function handleDeleteSessionPrompt(option) {
  const session = sessionToDelete.value
  sessionToDelete.value = null
  if (option !== 'delete' || !session) return

  try {
    if (!await store.dispatch('deleteSyncServerSession', session)) return
    await nextTick()
    if (activeView.value === 'synced') {
      dialogRef.value
        ?.querySelector(`#${activeOtherDeviceSessionTabId.value}`)
        ?.focus({ preventScroll: true })
    } else {
      focusActiveTab()
    }
  } catch (error) {
    showToast({
      message: t('Settings.Sync Settings.Sync failed', { error: error.message }),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

function tabCardStyle(tabId) {
  const offset = dragOffsets.value[tabId]
  if (offset) return { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }
  return undefined
}

function startTabGesture(event, tabId) {
  activatedTouchPointerId = null
  pendingTouchTabId = null
  if (selecting.value || dragSettling.value || pendingSwipeCloses.has(event.currentTarget) ||
      event.button !== 0 || event.target.closest('.capacitorPhoneTabClose')) return

  resetTabDrag()
  resetTabSwipe()
  drag.tabId = tabId
  drag.pointerId = event.pointerId
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.startTime = event.timeStamp
  drag.currentX = event.clientX
  drag.currentY = event.clientY
  const target = event.target.closest('.capacitorPhoneTabTarget')
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    dragRects = Array.from(openTabsContentRef.value.querySelectorAll('.capacitorPhoneTabRow')).map(row => {
      const rect = row.getBoundingClientRect()
      const id = row.querySelector('[data-tab-id]').dataset.tabId
      return {
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        isPinned: tabs.value.find(tab => tab.id === id).isPinned === true,
      }
    })
    dragScrollStart = openTabsScrollRef.value.scrollTop
    const viewport = openTabsScrollRef.value
    const contentBottom = openTabsContentRef.value.getBoundingClientRect().bottom
    dragMaximumScrollTop = Math.max(0, contentBottom - viewport.getBoundingClientRect().top +
      dragScrollStart + Number.parseFloat(getComputedStyle(viewport).paddingBottom) - viewport.clientHeight)
    drag.ready = true
    target?.setPointerCapture(event.pointerId)
    openTabActions(tabId)
    lightHaptic()
  }, TAB_HOLD_DELAY)

  const tab = tabs.value.find(candidate => candidate.id === tabId)
  if (tab?.isPinned) return

  swipeElement = event.currentTarget
  swipe.tabId = tabId
  swipe.pointerId = event.pointerId
  swipe.startX = event.clientX
  swipe.startY = event.clientY
  swipe.startTime = performance.now()
  swipe.rowWidth = event.currentTarget.getBoundingClientRect().width
}

function moveTabGesture(event) {
  if (dragSettling.value) return
  if (drag.pointerId === event.pointerId) {
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > TAB_MOVE_THRESHOLD
    if (drag.ready) {
      if (moved) drag.moved = true
      if (drag.moved) {
        event.preventDefault()
        if (actionTab.value) closeTabActions()
        drag.currentX = event.clientX
        drag.currentY = event.clientY
        dragDirty = true
        startDragAutoScroll()
      }
      return
    }
    if (moved) resetTabDrag()
  }
  moveTabSwipe(event)
}

function preventHoldScroll(event) {
  // touch-action cannot change halfway through a gesture. Cancel native
  // scrolling only after the hold, so a quick vertical swipe still scrolls.
  if (drag.ready && event.touches.length === 1) event.preventDefault()
}

function finishTabGesture(event) {
  if (dragSettling.value) return
  if (drag.pointerId === event.pointerId && drag.ready) {
    swipe.suppressClick = true
    if (drag.moved) {
      stopDragAutoScroll()
      if (dragDirty) updateTabDrag()
      const tabId = drag.tabId
      const targetIndex = dragLayout.targetIndex
      dragSettling.value = true
      dragOffsets.value = { ...dragOffsets.value, [tabId]: dragLayout.dropOffset }
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
      dropTimer = window.setTimeout(() => {
        dropTimer = null
        if (dragRects[targetIndex].id !== tabId) {
          if (getCapacitorTabService().moveTab(tabId, targetIndex)) lightHaptic()
        }
        resetTabDrag()
        scheduleSwipeReset()
      }, duration)
    } else {
      resetTabDrag()
    }
    return
  }
  // Android can deliver a complete touch without synthesizing a click just
  // after the header swipe. Resolve short taps in the existing gesture handler;
  // moving, holding and cancelled pointers still follow their own paths.
  const tappedTab = event.pointerType === 'touch' && drag.pointerId === event.pointerId &&
    event.timeStamp - drag.startTime < TAB_HOLD_DELAY &&
    Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= TAB_MOVE_THRESHOLD &&
    event.target.closest('.capacitorPhoneTabTarget')?.dataset.tabId === drag.tabId
    ? drag.tabId
    : null
  resetTabDrag()
  finishTabSwipe(event)
  if (tappedTab !== null) {
    activatedTouchPointerId = event.pointerId
    pendingTouchTabId = tappedTab
  }
}

function finishTabTouch(event) {
  if (pendingTouchTabId === null) return
  // Cancel the compatibility click before removing the organizer, otherwise
  // Android can send that click to a control on the newly revealed page.
  event.preventDefault()
  const tabId = pendingTouchTabId
  pendingTouchTabId = null
  activateTab(tabId)
}

function cancelTabGesture() {
  pendingTouchTabId = null
  const wasHeld = drag.ready
  resetTabDrag()
  if (wasHeld) {
    swipe.suppressClick = true
    scheduleSwipeReset()
  }
  cancelTabSwipe()
}

function handleTabContextMenu(event, tabId) {
  // The hold timer already handles touch menus; right-click stays instant.
  if (drag.tabId === tabId || (event.pointerType === 'touch' && swipe.suppressClick)) return
  openTabActions(tabId)
}

function updateTabDrag() {
  dragDirty = false
  const scrollDelta = openTabsScrollRef.value.scrollTop - dragScrollStart
  dragLayout = getTabGridReorder(
    dragRects, drag.tabId,
    drag.currentX - drag.startX,
    drag.currentY - drag.startY + scrollDelta
  )
  dragOffsets.value = dragLayout.offsets
}

function startDragAutoScroll() {
  if (dragFrame !== null) return
  let previousTime = performance.now()
  const scroll = (time) => {
    const viewport = openTabsScrollRef.value
    const bounds = viewport.getBoundingClientRect()
    const edge = 48
    const speed = drag.currentY < bounds.top + edge
      ? -Math.min(1, (bounds.top + edge - drag.currentY) / edge)
      : Math.max(0, Math.min(1, (drag.currentY - bounds.bottom + edge) / edge))
    const before = viewport.scrollTop
    // Transforms can extend scrollHeight. Bound scrolling by the real grid,
    // otherwise the floating card continuously creates room beneath itself.
    viewport.scrollTop = Math.max(0, Math.min(dragMaximumScrollTop,
      before + speed * Math.min(time - previousTime, 32) * 0.6))
    previousTime = time
    if (dragDirty || viewport.scrollTop !== before) updateTabDrag()
    dragFrame = requestAnimationFrame(scroll)
  }
  dragFrame = requestAnimationFrame(scroll)
}

function stopDragAutoScroll() {
  cancelAnimationFrame(dragFrame)
  dragFrame = null
}

function resetTabDrag() {
  const hadOffsets = Object.keys(dragOffsets.value).length > 0
  if (hadOffsets) suppressDragTransition.value = true
  stopDragAutoScroll()
  window.clearTimeout(dropTimer)
  dropTimer = null
  dragSettling.value = false
  dragOffsets.value = {}
  dragRects = []
  dragLayout = null
  dragDirty = false
  window.clearTimeout(holdTimer)
  holdTimer = null
  drag.tabId = null
  drag.pointerId = null
  drag.ready = false
  drag.moved = false
  if (hadOffsets) {
    nextTick(() => {
      if (openTabsScrollRef.value && openTabsContentRef.value) {
        clampOverlayScrollTop(openTabsScrollRef.value, openTabsContentRef.value)
      }
      requestAnimationFrame(() => {
        suppressDragTransition.value = false
      })
    })
  }
}

function moveTabSwipe(event) {
  if (swipe.pointerId !== event.pointerId || swipe.closing) return

  const deltaX = event.clientX - swipe.startX
  const deltaY = event.clientY - swipe.startY
  if (!swipe.dragging) {
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > TAB_MOVE_THRESHOLD) {
      cancelTabSwipe()
      return
    }
    if (Math.abs(deltaX) < TAB_MOVE_THRESHOLD) return
    swipe.dragging = true
    swipeElement.setAttribute('data-tab-swiping', '')
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  event.preventDefault()
  swipe.deltaX = deltaX
  if (swipeFrame === null) swipeFrame = requestAnimationFrame(renderTabSwipe)
}

function renderTabSwipe() {
  swipeFrame = null
  if (!swipeElement) return
  swipeElement.style.setProperty('--tab-swipe-transform', `translate3d(${swipe.deltaX}px, 0, 0)`)
  swipeElement.style.setProperty('--tab-swipe-opacity',
    String(Math.max(0.25, 1 - Math.abs(swipe.deltaX) / Math.max(swipe.rowWidth, 1))))
}

function clearTabSwipeElement(element) {
  element.removeAttribute('data-tab-swiping')
  element.removeAttribute('data-tab-closing')
  element.style.removeProperty('--tab-swipe-transform')
  element.style.removeProperty('--tab-swipe-opacity')
}

function finishTabSwipe(event) {
  if (swipe.pointerId !== event.pointerId) return
  if (!swipe.dragging) {
    resetTabSwipe()
    return
  }

  cancelAnimationFrame(swipeFrame)
  swipeFrame = null
  // Release may arrive before the queued frame, with a newer pointer sample.
  swipe.deltaX = event.clientX - swipe.startX
  swipe.pointerId = null
  swipe.suppressClick = true
  swipeElement.removeAttribute('data-tab-swiping')
  const close = shouldCloseSwipedTab({
    distance: swipe.deltaX,
    elapsed: performance.now() - swipe.startTime,
    width: swipe.rowWidth,
  })
  if (!close) {
    swipe.dragging = false
    swipe.deltaX = 0
    renderTabSwipe()
    scheduleSwipeReset()
    return
  }

  const tabId = swipe.tabId
  swipe.dragging = false
  swipe.closing = true
  swipe.deltaX = Math.sign(swipe.deltaX || 1) * swipe.rowWidth
  swipeElement.setAttribute('data-tab-closing', '')
  renderTabSwipe()
  const element = swipeElement
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160
  // An accepted close belongs to this card, not to the next pointer session.
  let finishing = false
  const finish = async () => {
    if (finishing) return
    finishing = true
    // Presenting an active tab's replacement must finish before another close.
    const closing = swipeCloseQueue.then(() => closeTab(tabId))
    swipeCloseQueue = closing.catch(() => {})
    try {
      await closing
    } finally {
      pendingSwipeCloses.delete(element)
      clearTabSwipeElement(element)
    }
  }
  const timer = window.setTimeout(finish, delay)
  pendingSwipeCloses.set(element, { timer, finish })
  scheduleSwipeReset()
}

function cancelTabSwipe() {
  if (swipe.tabId === null) return
  if (swipe.closing) return
  cancelAnimationFrame(swipeFrame)
  swipeFrame = null
  swipe.pointerId = null
  swipe.dragging = false
  swipe.deltaX = 0
  swipeElement?.removeAttribute('data-tab-swiping')
  renderTabSwipe()
  scheduleSwipeReset()
}

function scheduleSwipeReset() {
  window.clearTimeout(swipeResetTimer)
  swipeResetTimer = window.setTimeout(resetTabSwipe, 170)
}

function resetTabSwipe() {
  cancelAnimationFrame(swipeFrame)
  swipeFrame = null
  if (swipeElement && !pendingSwipeCloses.has(swipeElement)) clearTabSwipeElement(swipeElement)
  swipeElement = null
  window.clearTimeout(swipeResetTimer)
  swipeResetTimer = null
  swipe.tabId = null
  swipe.pointerId = null
  swipe.deltaX = 0
  swipe.dragging = false
  swipe.closing = false
  swipe.suppressClick = false
  swipe.rowWidth = 0
}

function focusActiveTab() {
  dialogRef.value
    ?.querySelector('.capacitorPhoneTabTarget[aria-selected="true"]')
    ?.focus({ preventScroll: true })
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (activeView.value === 'history') selectView('open', true)
    else closeSwitcher()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(dialogRef.value?.querySelectorAll('button:not(:disabled), input:not(:disabled)') ?? [])
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    const scroll = activeScrollRef()
    if (scroll) restoreOverlayScrollTop(scroll, viewScrollTop[activeView.value])
    observeActiveContent()
    if (!organizerGesture.value) focusActiveTab()
  } else {
    const scroll = activeScrollRef()
    if (scroll) viewScrollTop[activeView.value] = scroll.scrollTop
    stopObservingContent()
  }
})

let modalLocked = false
function releaseModalLock() {
  if (!modalLocked) return
  modalLocked = false
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
}

watch(() => open.value && !organizerGesture.value, modal => {
  if (modal) {
    lockBodyScroll()
    modalLocked = true
    store.commit('addOpenPrompt', promptId)
    if (showSyncedTabsView.value) {
      store.dispatch('refreshSyncServerDevices').catch(error => {
        console.error('Failed to refresh sync device names:', error)
      })
    }
  } else {
    releaseModalLock()
  }
})

watch(() => [props.enabled, presentedTabId.value, store.getters.isAnyPromptOpen], () => {
  if (organizerGesture.value) organizerSwipe.cancel()
})

watch(showSyncedTabsView, (visible) => {
  if (!visible && activeView.value === 'synced') selectView('open')
})

watch(() => tabs.value.map(tab => `${tab.id}:${tab.isPinned}`).join(','), () => {
  if (drag.ready) cancelTabGesture()
})

watch(
  () => [tabs.value.length, tabHistoryEntries.value.length, ...otherDeviceSessions.value.map(session => session.tabs.length)],
  async () => {
    await nextTick()
    clampActiveContentScroll()
  }
)

onBeforeUnmount(() => {
  disposed = true
  for (const { timer, finish } of pendingSwipeCloses.values()) {
    window.clearTimeout(timer)
    finish()
  }
  organizerSwipe.cancel()
  resetTabSwipe()
  resetTabDrag()
  stopObservingContent()
  releaseModalLock()
})
</script>

<style scoped src="./CapacitorPhoneTabSwitcher.css" />

<style scoped src="./TabLoadingDot.css" />
