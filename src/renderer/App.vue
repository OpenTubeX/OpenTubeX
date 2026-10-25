<template>
  <div
    v-if="dataReady"
    ref="appRoot"
    class="app"
    :class="[{
      hideOutlines: outlinesHidden,
      isLocaleRightToLeft: isLocaleRightToLeft,
      isSideNavOpen: isSideNavOpen,
      hideLabelsSideBar: hideLabelsSideBar && !isSideNavOpen,
      compactNavigation: compactNavigationLabels,
      capacitorTabs: isCapacitor,
      capacitorPhoneLayout: isCapacitor && !capacitorTabletLayout,
      capacitorTabletLayout,
      verticalTabs: useVerticalTabBar,
      verticalTabsLeft: tabBarPosition === 'left',
      verticalTabsRight: tabBarPosition === 'right',
      bottomTabs: isElectron && tabBarPosition === 'bottom',
      topTabs: (isElectron && tabBarPosition === 'top') || showTabletTabStrip,
      customTitleBar: hasCustomTitleBar,
      watchSideNavOverlay: useWatchSideNavOverlay,
      watchSideNavTransitionDisabled
    }, `tabBar-${tabBarPosition}`]"
    :style="appStyle"
  >
    <TabBar
      :inert="isAnyPromptOpen"
    />
    <WindowControls
      v-if="hasLinuxWindowControls"
      @insets="windowControlsInsets = $event"
    />
    <CapacitorTabletTabBar
      v-if="isCapacitor && store.getters.getTabsEnabled"
      :inert="isAnyPromptOpen"
      @request-exit="requestAndroidAppExit"
    />
    <TopNav
      ref="topNav"
      :inert="isAnyPromptOpen"
      @request-android-exit="requestAndroidAppExit"
      @pointerdown.capture="startPageSwipe"
      @pointermove.capture="movePageSwipe"
      @pointerup.capture="finishPageSwipe"
      @pointercancel.capture="cancelPageSwipe"
      @click.capture="suppressPageSwipeClick"
    />
    <SideNav
      :inert="isAnyPromptOpen"
      :force-expanded="useWatchSideNavOverlay"
      :data-watch-return-expanded="sideNavOpenBeforeWatchOverlay"
    />
    <Transition name="fade">
      <button
        v-if="useWatchSideNavOverlay && isSideNavOpen"
        type="button"
        class="sideNavBackdrop"
        :inert="isAnyPromptOpen"
        :aria-label="t('Close')"
        @click="closeSideNav"
      />
    </Transition>
    <!-- Fixed mini players must stay outside the route's query container. -->
    <div
      id="cross-tab-mini-player-layer"
      class="crossTabMiniPlayerLayer"
      :inert="isAnyPromptOpen"
    />
    <FtFlexBox
      class="flexBox routerView"
      role="main"
      :inert="isAnyPromptOpen"
    >
      <template v-if="usesLogicalTabs">
        <TabContent
          v-for="tab in tabContainers"
          :key="tab.id"
          :tab="tab"
          :page-swipe="pageSwipe"
          :prewarm="pageSwipeNeighborIds.includes(tab.id)"
        />
      </template>
      <RouterView
        v-else
        v-slot="{ Component }"
        class="routerView"
      >
        <Transition
          mode="out-in"
          name="fade"
        >
          <component :is="Component" />
        </Transition>
      </RouterView>
    </FtFlexBox>
    <!-- Leave keyframes avoid staging classes that restyle the settings subtree. -->
    <Transition
      name="settings-window"
      :css="!settingsWindowMorphing"
      leave-from-class=""
      leave-to-class=""
      v-bind="settingsWindowMorphing ? getUtilityWindowMorphHooks() : {}"
    >
      <KeepAlive>
        <SettingsWindow
          v-if="settingsWindowOpen"
          :hardware-keyboard-attached="hardwareKeyboardAttached"
          :search-target="settingsSearchTarget"
          @search-target-opened="clearSettingsSearchTarget"
        />
      </KeepAlive>
    </Transition>
    <FtTutorialOverlay
      v-if="showTutorial"
      @close="completeTutorial"
    />
    <FtCommandPalette
      v-if="commandPaletteOpen"
      :commands="commandPaletteCommands"
      :video-sources="commandPaletteVideoSources"
      :show-shortcuts="hardwareKeyboardAttached"
      @close="closeCommandPalette"
    />
    <TabOrganizer
      v-if="tabOrganizerOpen"
      @close="closeTabOrganizer"
    />
    <SubscriptionRefreshErrors />
    <FtPrompt
      v-if="showReleaseNotes"
      theme="readable-width"
      @click="closeReleaseNotes"
    >
      <template #label="{ labelId }">
        <h1
          :id="labelId"
          class="changeLogTitle"
        >
          {{ changeLogTitle }}
        </h1>
      </template>
      <div
        ref="changeLogScroller"
        v-overlay-scrollbars
        class="changeLogText"
        dir="ltr"
        lang="en"
      >
        <div
          ref="changeLogContent"
          v-safer-html.lenient="updateChangelog"
          class="changeLogContent"
        />
      </div>
      <FtFlexBox>
        <FtButton
          :label="t('Download From Site')"
          :icon="['fas', 'download']"
          @click="openDownloadsPage"
        />
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="closeReleaseNotes"
        />
      </FtFlexBox>
    </FtPrompt>
    <FtPrompt
      v-if="showExternalLinkOpeningPrompt"
      autosize
      :label="t('Are you sure you want to open this link?')"
      :extra-labels="[lastExternalLinkToBeOpened]"
      :option-names="externalLinkOpeningPromptNames"
      :option-values="EXTERNAL_LINK_OPENING_PROMPT_VALUES"
      @click="handleExternalLinkOpeningPromptAnswer"
    />
    <FtPrompt
      v-if="multipleTabsActionPrompt != null"
      autosize
      :label="multipleTabsActionPromptTitle"
      :extra-labels="[multipleTabsActionPromptMessage, t('Confirmations.Settings Hint')]"
      :option-names="multipleTabsActionPromptNames"
      :option-values="MULTIPLE_TABS_ACTION_PROMPT_VALUES"
      @click="handleMultipleTabsActionPromptAnswer"
    />
    <FtPrompt
      v-if="libraryNotice"
      :key="libraryNotices[0]"
      autosize
      :label="libraryNotice.title"
      @click="dismissLibraryNotice"
    >
      <p class="libraryNoticeText">
        <strong>{{ libraryNotice.message }}</strong>
      </p>
      <p class="libraryNoticeText">
        {{ libraryNotice.detail }}
      </p>
      <FtFlexBox>
        <FtButton
          :label="t('Ok')"
          :icon="['fas', 'check']"
          @click="dismissLibraryNotice"
        />
      </FtFlexBox>
    </FtPrompt>
    <FtPrompt
      v-if="showAndroidExitPrompt"
      autosize
      is-first-option-destructive
      :label="t('Close Confirmation.Title')"
      :extra-labels="[t('Close Confirmation.Message')]"
      :option-names="androidExitPromptNames"
      :option-values="ANDROID_EXIT_PROMPT_VALUES"
      @click="handleAndroidExitPromptAnswer"
    />
    <FtSearchFilters
      v-if="showSearchFilters"
      :key="presentedTabId"
    />
    <SharedYoutubeLinkPrompt
      v-if="sharedYoutubeLink"
      :key="sharedYoutubeLink.id"
      :url="sharedYoutubeLink.url"
      :video-id="sharedYoutubeLink.videoId"
      @open="openSharedYoutubeLink"
      @close="sharedYoutubeLink = null"
    />
    <FtPlaylistAddVideoPrompt
      v-if="showAddToPlaylistPrompt"
    />
    <FtCreatePlaylistPrompt
      v-if="showCreatePlaylistPrompt"
    />
    <FtContextMenu />
    <Teleport :to="mobileContextMenuTarget">
      <Transition
        :css="false"
        @enter="enterMobileContextSheet"
        @leave="leaveMobileContextSheet"
        @after-leave="releaseMobileContextSheet"
      >
        <div
          v-if="mobileContextLink || mobileContextActions"
          class="mobileLinkActionsBackdrop"
          @pointerdown.stop
          @touchstart.stop
          @touchend.stop
          @dblclick.stop
          @click.stop.self="closeMobileLinkActions"
          @keydown.esc.stop="backMobileContextMenu"
        >
          <section
            ref="mobileLinkActionsRef"
            class="mobileLinkActions"
            data-bottom-sheet
            role="menu"
            :aria-label="mobileContextMenuTitle"
            tabindex="-1"
            @pointerdown="startMobileContextDrag"
            @touchmove="moveMobileContextTouch"
            @scroll.capture="updateMobileContextScrollAction"
            @click.capture="filterMobileContextClick"
            @keydown.esc.stop="backMobileContextMenu"
          >
            <div
              class="bottomSheetHandle"
              aria-hidden="true"
            />
            <div class="mobileLinkActionsHeader">
              <button
                v-if="mobileContextMenuStack.length > 1"
                type="button"
                class="mobileLinkActionsBack"
                @click="backMobileContextMenu"
              >
                <FtIcon
                  :icon="['fas', 'arrow-left']"
                  aria-hidden="true"
                />
                {{ t('Back') }}
              </button>
              <strong
                v-if="mobileContextMenuStack.length === 1"
                dir="auto"
              >{{ mobileContextMenuTitle }}</strong>
            </div>
            <div
              v-if="mobileContextQuickActions.length"
              class="mobileLinkQuickActions"
            >
              <button
                v-for="action in mobileContextQuickActions"
                :key="action.label"
                type="button"
                role="menuitem"
                :title="action.label"
                :aria-label="action.label"
                :disabled="action.enabled === false"
                @click="runMobileContextAction(action)"
              >
                <FtIcon
                  :icon="action.icon"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div
              v-if="mobileContextThumbnailActions.length"
              class="mobileLinkQuickActions mobileThumbnailActionRow"
            >
              <button
                v-for="action in mobileContextThumbnailActions"
                :key="action.label"
                type="button"
                :role="action.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'"
                :title="action.label"
                :aria-label="action.label"
                :aria-checked="action.pressed"
                :disabled="action.enabled === false"
                @click="runMobileContextAction(action)"
              >
                <FtIcon
                  :icon="action.icon"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div
              ref="mobileLinkActionsScrollRef"
              v-overlay-scrollbars
              class="mobileLinkActionsScroll"
            >
              <div
                ref="mobileLinkActionsContentRef"
                class="mobileLinkActionsContent"
              >
                <template
                  v-for="(action, index) in mobileContextMenuRows"
                  :key="action.label ?? index"
                >
                  <div
                    v-if="action.type === 'separator'"
                    class="mobileLinkActionsSeparator"
                    role="separator"
                  />
                  <button
                    v-else
                    type="button"
                    role="menuitem"
                    :aria-label="action.label"
                    :disabled="action.enabled === false"
                    :aria-haspopup="action.submenu ? 'menu' : undefined"
                    @click="runMobileContextAction(action)"
                  >
                    <FtIcon
                      :icon="action.icon"
                      aria-hidden="true"
                    />
                    <span>{{ action.label }}</span>
                    <span
                      v-if="action.submenu"
                      class="mobileLinkSubmenuArrow"
                      aria-hidden="true"
                    />
                  </button>
                </template>
                <button
                  v-if="mobileContextLink"
                  type="button"
                  role="menuitem"
                  @click="openMobileContextLink(false)"
                >
                  <FtIcon :icon="['fas', 'link']" />
                  {{ t('Share.Open Link') }}
                </button>
                <button
                  v-if="mobileContextLinkCanOpenInTab"
                  type="button"
                  role="menuitem"
                  @click="openMobileContextLink(true)"
                >
                  <FtIcon :icon="['fas', 'arrow-up-right-from-square']" />
                  {{ t('Context Menu.Open in a New Tab') }}
                </button>
                <button
                  v-if="mobileContextLinkCopyUrl"
                  type="button"
                  role="menuitem"
                  @click="copyMobileContextLink"
                >
                  <FtIcon :icon="['fas', 'copy']" />
                  {{ t('Share.Copy Link') }}
                </button>
                <button
                  v-if="mobileContextLinkCopyUrl"
                  type="button"
                  role="menuitem"
                  @click="shareMobileContextLink"
                >
                  <FtIcon
                    :icon="['fas', 'share-alt']"
                    aria-hidden="true"
                  />
                  {{ t('Share.Share Link') }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
    <FtToast />
    <FtProgressBar
      v-if="showProgressBar"
      :progress="displayedProgressBarPercentage"
    />
    <div
      v-if="findbarVisible"
      class="findbar"
      role="search"
      @keydown.stop="handleFindbarNavigationShortcut"
    >
      <FtIcon
        :icon="['fas', 'search']"
        class="findbarIcon"
        aria-hidden="true"
      />
      <input
        ref="findbarInputRef"
        v-model="findbarQuery"
        class="findbarInput"
        type="search"
        :placeholder="t('Find in page')"
        :aria-label="t('Find in page')"
        @input="findInPage"
        @keydown.enter.prevent="findInPage($event.shiftKey)"
        @keydown.esc.prevent="closeFindbar"
      >
      <span
        class="findbarStatus"
        aria-live="polite"
      >
        {{ findbarStatus }}
      </span>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Previous match')"
        :title="t('Previous match')"
        @click="findInPage(true)"
      >
        <FtIcon
          :icon="['fas', 'angle-up']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Next match')"
        :title="t('Next match')"
        @click="findInPage(false)"
      >
        <FtIcon
          :icon="['fas', 'angle-down']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Close find bar')"
        :title="t('Close')"
        @click="closeFindbar"
      >
        <FtIcon
          :icon="['fas', 'xmark']"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-if="tabSwitcherVisible"
      class="tabSwitcherOverlay"
      data-tab-preview-overlay
      data-tab-preview-preserve-visibility
      @mousedown.prevent
      @wheel.prevent="handleTabSwitcherWheel"
    >
      <div
        ref="tabSwitcherRef"
        v-overlay-scrollbars
        class="tabSwitcher"
        :class="{
          pointerActive: tabSwitcherPointerActive,
          noPreviews: !showTabPreviews
        }"
        role="listbox"
        :aria-label="t('KeyboardShortcutPrompt.Tab Switcher')"
        :aria-activedescendant="tabSwitcherSelectedTabId"
        @pointermove="activateTabSwitcherPointer"
        @pointerleave="clearTabSwitcherSelection"
      >
        <button
          v-for="(tab, index) in tabSwitcherTabs"
          :id="`tab-switcher-option-${tab.id}`"
          :key="tab.id"
          type="button"
          class="tabSwitcherItem"
          :class="{ selected: index === tabSwitcherSelectedIndex }"
          :style="getTabSwitcherItemStyle(tab)"
          role="option"
          :aria-selected="index === tabSwitcherSelectedIndex"
          @pointermove="setTabSwitcherSelectedIndex(index)"
          @focus="setTabSwitcherSelectedIndex(index)"
          @click="commitTabSwitcherSelection(index)"
        >
          <span
            v-if="showTabPreviews"
            class="tabSwitcherPreview"
          >
            <FtRetryImage
              v-if="getUsableTabSwitcherPreviewUrl(tab)"
              :src="tabSwitcherPreviewUrls[tab.id]"
              :alt="`${formatTabTitle(tab.title)} preview`"
              loading="lazy"
              decoding="async"
              draggable="false"
              @error="handleTabSwitcherPreviewError(tab)"
            />
            <FtRetryImage
              v-else-if="!tabSwitcherPreviewPending[tab.id] && getUsableTabSwitcherAvatarUrl(tab)"
              :fallback-icon="getTabPageIcon(tab) || ['fas', 'display']"
              :src="getUsableTabSwitcherAvatarUrl(tab)"
              :alt="`${formatTabTitle(tab.title)} preview`"
              class="tabSwitcherPreviewAvatar"
              loading="lazy"
              decoding="async"
              draggable="false"
              @error="handleTabSwitcherAvatarError(tab)"
            />
            <span
              v-else-if="!tabSwitcherPreviewPending[tab.id]"
              class="tabSwitcherPreviewFallback"
              aria-hidden="true"
            >
              <FtIcon
                :icon="getTabPageIcon(tab) || ['fas', 'display']"
                class="tabSwitcherFallbackIcon"
              />
            </span>
          </span>
          <span class="tabSwitcherTitle">
            <FtRetryImage
              v-if="showTabIcons && getUsableTabSwitcherAvatarUrl(tab)"
              :fallback-icon="getTabPageIcon(tab) || ['fas', 'display']"
              :src="getUsableTabSwitcherAvatarUrl(tab)"
              class="tabSwitcherTitleAvatar"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              @error="handleTabSwitcherAvatarError(tab)"
            />
            <FtIcon
              v-else-if="showTabIcons && getTabPageIcon(tab)"
              :icon="getTabPageIcon(tab)"
              class="tabSwitcherTitleIcon"
              aria-hidden="true"
            />
            <span class="tabSwitcherTitleText">
              {{ formatTabTitle(tab.title) }}
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { installIosContextMenu } from './helpers/iosContextMenu'
import '@fontsource-variable/geist'
import '@fontsource-variable/google-sans'
import '@fontsource-variable/figtree'
import '@fontsource-variable/source-sans-3'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/plus-jakarta-sans'
import FtRetryImage from './components/FtRetryImage.vue'
import { initializeCapacitorYtDlp, ytDlp } from './helpers/ytDlp'
import { playDownloadedFile, refreshDownloadRecords } from './helpers/downloadPlayback'
import { supportsYtDlp } from './helpers/ytDlpCapabilities'
import { initializeShimmerVisibility } from './helpers/shimmerVisibility.js'
import { FtIcon } from '@opentubex/icons'
import { Capacitor } from '@capacitor/core'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, useTemplateRef, watch } from 'vue'
import { useScrollClamp } from './composables/useScrollClamp'
import { usePhoneLayout } from './composables/usePhoneLayout'
import { useTitleBarOverlay } from './composables/useTitleBarOverlay'
import { useAndroidBack } from './app/useAndroidBack'
import { useAppearance } from './app/useAppearance'
import { useCapacitorIntegrations } from './app/useCapacitorIntegrations'
import { useFindbar } from './app/useFindbar'
import { useManagedExternalSoftware } from './app/useManagedExternalSoftware'
import { useMobileContextMenu } from './app/useMobileContextMenu'
import { useMultipleTabsActionConfirmation } from './app/useMultipleTabsActionConfirmation'
import { usePageSwipe } from './app/usePageSwipe'
import { useSubscriptionAutoRefresh } from './app/useSubscriptionAutoRefresh'
import { useTabSwitcher } from './app/useTabSwitcher'
import { useI18n } from 'vue-i18n'
import { routerKey, useRoute, useRouter } from 'vue-router'

import FtFlexBox from './components/ft-flex-box/ft-flex-box.vue'
import TopNav from './components/TopNav/TopNav.vue'
import SideNav from './components/SideNav/SideNav.vue'
import TabBar from './components/TabBar/TabBar.vue'
import WindowControls from './components/WindowControls/WindowControls.vue'
import CapacitorTabletTabBar from './components/TabBar/CapacitorTabletTabBar.vue'
import TabContent from './components/TabContent/TabContent.vue'
import FtPrompt from './components/FtPrompt/FtPrompt.vue'
import SharedYoutubeLinkPrompt from './components/SharedYoutubeLinkPrompt/SharedYoutubeLinkPrompt.vue'
import { initializeAndroidIncomingShare } from './helpers/androidIncomingShare'
import SubscriptionRefreshErrors from './components/SubscriptionRefreshErrors.vue'
import FtButton from './components/FtButton/FtButton.vue'
import FtToast from './components/FtToast/FtToast.vue'
import { initializeNetworkRecovery } from './helpers/networkRecovery'
import FtProgressBar from './components/FtProgressBar/FtProgressBar.vue'
import FtContextMenu from './components/FtContextMenu/FtContextMenu.vue'
import { vSaferHtml } from './directives/vSaferHtml.js'

import store from './store/index'
import {
  getAndroidHardwareKeyboardState,
  setAndroidPictureInPictureDocumentState
} from './helpers/androidUi'
import {
  applyThemeToDocument,
  handleCustomThemeUpdated,
  loadCustomThemes,
} from './helpers/customTheme'
import { repairSystemThemeSettings } from './helpers/customThemeSync'

import packageDetails from '../../package.json'
import { MULTIPLE_TABS_CONFIRM_THRESHOLD, KeyboardShortcuts } from '../constants'
import { matchesKeyboardShortcut } from './helpers/keyboardShortcuts'
import { hasVisibleGamepadLayer, initializeGamepadNavigation } from './helpers/gamepadNavigation'
import { getUtilityWindowMorphHooks } from './helpers/utilityWindowMorph'
import { keyboardEventInitFromShortcut, OPEN_COMMAND_PALETTE_EVENT } from './helpers/commandPalette'
import { createCommandPaletteRegistry } from './helpers/commandPaletteRegistry'
import {
  resolveExternalLinkAction,
  resolveMobileContextLinkCopyUrl,
} from './helpers/mobileLinkActions'
import { initializePlatformInfo, isLinuxWayland, supportsAutoPictureInPictureMinimize } from './helpers/platform'
import { revealStartupSplash } from './helpers/startupSplash'
import { mirrorAppState } from './helpers/rootClasses'
import { shouldUseProgressToast } from './helpers/progressPresentation'
import { fetchReleasePages, findUpdateReleases, formatReleaseChangelog } from './helpers/releaseUpdates'
import { copyToClipboard, isUnloadedBackgroundTabClick, openExternalLink, openInternalPath, showToast } from './helpers/utils'
import { translateWindowTitle } from './helpers/strings'
import { formatTabTitle } from './tabs/tabTitle'
import { canMarkHistoryEntryAsWatched } from './helpers/history'
import { usesCapacitorTabletLayout } from './helpers/capacitorLayout'
import {
  getNextTabBarPosition,
  isVerticalTabBarPosition,
  normalizeTabBarPosition
} from './constants/tabBarPosition'
import {
  getLastUsedVersion,
  getTutorialAudience,
  markTutorialCompleted,
  setLastUsedVersion,
  setTutorialAudience,
} from './helpers/tutorialState'
import { dismissAutoSyncNotice, shouldShowAutoSyncNotice, showAutoSyncNoticeOnce } from './helpers/sync-auto-sync-notice'
import { invalidateAllYtDlpPlaybackSources } from './helpers/player/ytDlpPlayback'
import { getTabNavigationService } from './tabs/TabNavigationService'
import { initializeCapacitorTabPreviews } from './tabs/capacitorTabPreviews'
import { initializeCapacitorTabService } from './tabs/CapacitorTabService'
import { tabMediaCoordinator } from './tabs/TabMediaCoordinator'
import { getTabPageIcon } from './tabs/tabPreview'
import { preloadResolvedRoute, preloadUtilityRoutes } from './router/index'
import { installRoutePreloadIntent } from './helpers/routePreloadIntent'
import { getTabsKeptLoaded } from './tabs/TabResidency'
import { initializeCapacitorPullToRefresh } from './helpers/capacitorPullToRefresh'
import { startMemoryPressureMonitor } from './helpers/memoryPressure'

const SettingsWindow = defineAsyncComponent(() => import('./views/Settings/Settings.vue'))
const FtPlaylistAddVideoPrompt = defineAsyncComponent(() => import('./components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue'))
const FtCreatePlaylistPrompt = defineAsyncComponent(() => import('./components/FtCreatePlaylistPrompt/FtCreatePlaylistPrompt.vue'))
const FtSearchFilters = defineAsyncComponent(() => import('./components/FtSearchFilters/FtSearchFilters.vue'))
const FtTutorialOverlay = defineAsyncComponent(() => import('./components/FtTutorialOverlay/FtTutorialOverlay.vue'))
const FtCommandPalette = defineAsyncComponent(() => import('./components/FtCommandPalette/FtCommandPalette.vue'))
const TabOrganizer = defineAsyncComponent(() => import('./components/TabOrganizer/TabOrganizer.vue'))
const OPEN_TAB_ORGANIZER_EVENT = 'opentubex:open-tab-organizer'

const route = useRoute()
const router = useRouter()
const availableRoutePaths = new Set(router.getRoutes().map(candidate => candidate.path))
const isElectron = process.env.IS_ELECTRON
const isCapacitor = process.env.IS_CAPACITOR
const usesLogicalTabs = isElectron || isCapacitor
const navigation = usesLogicalTabs ? getTabNavigationService() : null
const capacitorTabService = isCapacitor
  ? initializeCapacitorTabService(router, store, navigation)
  : null
if (usesLogicalTabs) {
  provide(routerKey, navigation.createPresentedRouterFacade())
}
const { locale, t, tm } = useI18n()
initializePlatformInfo()

const tabContainers = computed(() => {
  return store.getters.getTabContainerIds
    .map(tabId => store.getters.getTabById(tabId))
    .filter(Boolean)
})
const activeTabId = computed(() => store.getters.getActiveTabId)
const presentedTabId = computed(() => store.getters.getPresentedTabId)
const selectionRevision = computed(() => store.state.tabs.selectionRevision)

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => store.getters.getIsSideNavOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => store.getters.getHideLabelsSideBar)
const compactNavigationLabels = computed(() => store.getters.getCompactNavigationLabels)

const tabBarPosition = computed(() => isElectron
  ? normalizeTabBarPosition(store.getters.getTabBarPosition)
  : 'top')
const useVerticalTabBar = computed(() => isElectron && isVerticalTabBarPosition(tabBarPosition.value))
// Fixed when the window is created, so a changed setting waits for a restart.
const hasCustomTitleBar = isElectron && window.ftElectron.customTitleBar
// Linux has no native window controls overlay, so the renderer draws them.
const hasLinuxWindowControls = hasCustomTitleBar && process.platform === 'linux'
/** @type {import('vue').Ref<{ left: number, right: number } | null>} */
const windowControlsInsets = ref(null)
const tabletTabStripQuery = window.matchMedia('(min-width: 768px)')
const automaticTabletTabStrip = ref(tabletTabStripQuery.matches)
const capacitorLayoutMode = computed(() => store.getters.getCapacitorLayoutMode)
const capacitorTabletLayout = computed(() => isCapacitor && (
  usesCapacitorTabletLayout(capacitorLayoutMode.value, automaticTabletTabStrip.value)
))
const showTabletTabStrip = computed(() => capacitorTabletLayout.value && store.getters.getTabsEnabled)
tabletTabStripQuery.addEventListener('change', handleTabletTabStripChange)

const appStyle = computed(() => {
  const style = {}
  if (useVerticalTabBar.value) {
    style['--vertical-tab-bar-width'] = `${store.getters.getVerticalTabBarWidth}px`
  }
  if (showTabletTabStrip.value) style['--top-tab-bar-height'] = '48px'
  if (windowControlsInsets.value) {
    style['--title-bar-inset-left'] = `${windowControlsInsets.value.left}px`
    style['--title-bar-inset-right'] = `${windowControlsInsets.value.right}px`
    style['--title-bar-controls-height'] = '32px'
  }

  return Object.keys(style).length > 0 ? style : undefined
})

function handleTabletTabStripChange(event) {
  automaticTabletTabStrip.value = event.matches
}

/** @type {import('vue').ComputedRef<boolean>} */
const useWatchSideNavOverlay = computed(() => {
  return store.getters.getHideSideBarOnWatchPages && (route.path.startsWith('/watch/') || route.path === '/external-media')
})

const sideNavOpenBeforeWatchOverlay = ref(null)
const watchSideNavTransitionDisabled = ref(false)
let watchSideNavTransitionFrame = null

watch(useWatchSideNavOverlay, (enabled) => {
  if (enabled) {
    disableWatchSideNavTransitionForNextFrame()
    sideNavOpenBeforeWatchOverlay.value = isSideNavOpen.value
    closeSideNav()
  } else if (sideNavOpenBeforeWatchOverlay.value !== null) {
    // Leaving the overlay brings the sidebar back into normal flow and may
    // reopen it. Suppress its inline-size transition for the reflow so the
    // content snaps to its final position instead of sliding in from the right.
    disableWatchSideNavTransitionForNextFrame()

    if (isSideNavOpen.value !== sideNavOpenBeforeWatchOverlay.value) {
      store.commit('toggleSideNav')
    }

    sideNavOpenBeforeWatchOverlay.value = null
  }
}, { immediate: true })

function disableWatchSideNavTransitionForNextFrame() {
  cancelWatchSideNavTransitionReset()
  watchSideNavTransitionDisabled.value = true

  watchSideNavTransitionFrame = requestAnimationFrame(() => {
    watchSideNavTransitionFrame = requestAnimationFrame(() => {
      watchSideNavTransitionDisabled.value = false
      watchSideNavTransitionFrame = null
    })
  })
}

function cancelWatchSideNavTransitionReset() {
  if (watchSideNavTransitionFrame !== null) {
    cancelAnimationFrame(watchSideNavTransitionFrame)
    watchSideNavTransitionFrame = null
  }
}

function closeSideNav() {
  if (isSideNavOpen.value) {
    store.commit('toggleSideNav')
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const isAnyPromptOpen = computed(() => store.getters.isAnyPromptOpen)
const {
  pageSwipe,
  organizerSwipeActive,
  pageSwipeNeighborIds,
  startPageSwipe,
  movePageSwipe,
  suppressPageSwipeClick,
  finishPageSwipe,
  cancelPageSwipe
} = usePageSwipe({ isAnyPromptOpen, activeTabId, presentedTabId, capacitorTabService })

/** @type {import('vue').ComputedRef<boolean>} */
const showSearchFilters = computed(() => store.getters.getShowSearchFilters)

/** @type {import('vue').ComputedRef<boolean>} */
const isKeyboardShortcutPromptShown = computed(() => store.getters.getIsKeyboardShortcutPromptShown)
const settingsWindowOpen = computed(() => store.getters.getSettingsWindowOpen)
const settingsWindowMorphing = computed(() => store.getters.getSettingsWindowMorphing)

/** @type {import('vue').ComputedRef<boolean>} */
const showAddToPlaylistPrompt = computed(() => store.getters.getShowAddToPlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const showCreatePlaylistPrompt = computed(() => store.getters.getShowCreatePlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const localProgressBarVisible = computed(() => store.getters.getShowProgressBar)

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionRefreshInProgress = computed(() => store.getters.getSubscriptionFeedRefreshInProgress)
const progressUsesToast = computed(() => {
  return shouldUseProgressToast(store.getters.getShowProgressBarToast)
})

const showProgressBar = computed(() => {
  return (localProgressBarVisible.value && !progressUsesToast.value) ||
    (subscriptionRefreshInProgress.value && !progressUsesToast.value)
})
const displayedProgressBarPercentage = computed(() => {
  return localProgressBarVisible.value
    ? store.getters.getProgressBarPercentage
    : store.getters.getSubscriptionFeedRefreshProgress
})

const landingPage = computed(() => '/' + store.getters.getLandingPage)

/** @type {import('vue').ComputedRef<string>} */
const defaultInvidiousInstance = computed(() => store.getters.getDefaultInvidiousInstance)

/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)

const dataReady = ref(false)
// Page-wide and teleported styles read the layout from <html>.
watch(useTemplateRef('appRoot'), (app, _previous, onCleanup) => {
  if (app) onCleanup(mirrorAppState(app))
}, { flush: 'sync' })
useTitleBarOverlay(() => [dataReady.value, tabBarPosition.value])
const showTutorial = ref(false)
const {
  findbarVisible,
  findbarQuery,
  findbarStatus,
  openFindbar,
  closeFindbar,
  findInPage,
  handleFindbarNavigationShortcut
} = useFindbar({ presentedTabId, t })
const {
  tabSwitcherVisible,
  tabSwitcherTabs,
  tabSwitcherSelectedIndex,
  tabSwitcherSelectedTabId,
  tabSwitcherPreviewUrls,
  tabSwitcherPreviewPending,
  tabSwitcherPointerActive,
  showTabIcons,
  showTabPreviews,
  handleKeyboardShortcutKeyup,
  cycleTabSwitcher,
  isTabSwitcherActive,
  getUsableTabSwitcherAvatarUrl,
  getUsableTabSwitcherPreviewUrl,
  handleTabSwitcherAvatarError,
  handleTabSwitcherPreviewError,
  setTabSwitcherSelectedIndex,
  activateTabSwitcherPointer,
  clearTabSwitcherSelection,
  handleTabSwitcherWheel,
  commitTabSwitcherSelection,
  cancelTabSwitcher,
  getTabSwitcherItemStyle
} = useTabSwitcher()
const commandPaletteOpen = ref(false)
const hardwareKeyboardAttached = ref(!isCapacitor)
provide('hardwareKeyboardAttached', hardwareKeyboardAttached)
const {
  mobileContextLink,
  mobileContextActions,
  mobileContextMenuTarget,
  mobileContextMenuStack,
  mobileContextQuickActions,
  mobileContextThumbnailActions,
  mobileContextMenuRows,
  mobileContextMenuTitle,
  mobileLinkActionsRef,
  startMobileContextDrag,
  moveMobileContextTouch,
  filterMobileContextClick,
  updateMobileContextScrollAction,
  enterMobileContextSheet,
  leaveMobileContextSheet,
  mobileContextLinkCanOpenInTab,
  mobileContextLinkCopyUrl,
  releaseMobileContextSheet,
  handleMobileLinkContextMenu,
  closeOwnedMobileContextMenu,
  closeMobileLinkActions,
  backMobileContextMenu,
  runMobileContextAction,
  copyMobileContextLink,
  shareMobileContextLink,
  openMobileContextLink
} = useMobileContextMenu({ t, route, router, getEventLink, handleYoutubeLink, handleExternalLink })
const tabOrganizerOpen = ref(false)
const settingsSearchTarget = ref(null)
watch(() => store.getters.getSettingsWindowSectionRequest, request => {
  if (request) settingsSearchTarget.value = null
}, { flush: 'sync' })
watch(isKeyboardShortcutPromptShown, shown => {
  if (!shown) return
  settingsSearchTarget.value = null
  store.commit('setSettingsWindowSection', null)
}, { flush: 'sync' })
if (process.env.IS_ELECTRON) {
  // The main process adds the credentials to player, caption and image requests.
  watch(() => [store.getters.getApiServerAuthorization, store.getters.getApiServerUrl], ([authorization, url]) => {
    if (authorization) {
      window.ftElectron.setInvidiousAuthorization(authorization, url)
    } else {
      window.ftElectron.clearInvidiousAuthorization()
    }
  }, { immediate: true, flush: 'sync' })
}
const HISTORY_CLEANUP_INTERVAL = 60 * 60 * 1000
let historyCleanupTimer = null
let removeTabsStateListener = null
let stopMemoryPressureMonitor = null
let removeReloadRequestListener = null
let removeConfirmMultipleTabsActionListener = null
let removeLibraryNoticesListener = null
let removeOpenUrlListener = null
let removeRoutePreloadIntent = null
let removeCapacitorIntegrationListeners = null
let removeAndroidIncomingShare = null
let capacitorPullToRefreshSetup = null
let removeCapacitorTabPreviews = null
let removeYtDlpBinaryUpdatedListener = null
let removeAndroidYtDlpSettingsListener = null
let removeOpenTabOrganizerListener = null
let removeGamepadNavigation = () => {}
/** @type {number|null} */
let utilityRoutePreloadId = null
let utilityRoutePreloadUsesIdleCallback = false

function isSyncSettingsVisible() {
  const section = document.querySelector(
    '.settingsWindow .settingsContent > [data-section="sync"]'
  )
  return settingsWindowOpen.value && section !== null && section.getClientRects().length > 0
}

watch([dataReady, () => store.getters.getSyncServerError], ([ready, error]) => {
  if (!ready || error === '' || isSyncSettingsVisible()) return

  showToast({
    message: t('Settings.Sync Settings.Sync failed', { error }),
    icon: ['fas', 'circle-exclamation'],
  })
}, { flush: 'post' })

function scheduleUtilityRoutePreload() {
  if (utilityRoutePreloadId !== null) {
    return
  }

  const preload = () => {
    utilityRoutePreloadId = null
    preloadUtilityRoutes()
  }

  if (typeof window.requestIdleCallback === 'function') {
    utilityRoutePreloadUsesIdleCallback = true
    utilityRoutePreloadId = window.requestIdleCallback(preload, { timeout: 2000 })
  } else {
    utilityRoutePreloadUsesIdleCallback = false
    utilityRoutePreloadId = window.setTimeout(preload, 1000)
  }
}

function cancelUtilityRoutePreload() {
  if (utilityRoutePreloadId === null) {
    return
  }

  if (utilityRoutePreloadUsesIdleCallback) {
    window.cancelIdleCallback(utilityRoutePreloadId)
  } else {
    clearTimeout(utilityRoutePreloadId)
  }
  utilityRoutePreloadId = null
}

const { initializeManagedExternalSoftware } = useManagedExternalSoftware({ t })

async function initializeTutorial(hasExistingInstallation, lastUsedVersion, persistedAudience) {
  try {
    const audience = getTutorialAudience(persistedAudience)
    if (audience === 'completed' || audience === 'existing') return false
    if (hasExistingInstallation === null) return false

    if (audience !== 'new') {
      if (hasExistingInstallation || lastUsedVersion !== null) return false
      await setTutorialAudience('new')
    }

    return true
  } catch (error) {
    console.error('Failed to initialize tutorial', error)
    return false
  }
}

async function completeTutorial() {
  showTutorial.value = false
  await nextTick()

  if (isElectron) {
    try {
      await window.ftElectron.tabs.setShortcutsBlocked(false)
    } catch (error) {
      console.error('Failed to restore tab shortcuts', error)
    }
  }

  try {
    await markTutorialCompleted()
  } catch (error) {
    console.error('Failed to save tutorial completion', error)
  }
}

let removeInternetConnectivitySettingsListener = null
let removeIosContextMenu = null
let removeShimmerVisibility = null

onMounted(async () => {
  removeShimmerVisibility = initializeShimmerVisibility()
  removeGamepadNavigation = initializeGamepadNavigation({
    onBack: handleGamepadBack,
    onNavigate: () => store.dispatch('showOutlines'),
    onPlayPause: handleGamepadPlayPause,
  })
  let tabsReady = Promise.resolve()
  if (supportsYtDlp) {
    removeYtDlpBinaryUpdatedListener = ytDlp.addYtDlpBinaryUpdatedListener(invalidateAllYtDlpPlaybackSources)
  }

  if (isElectron) {
    tabsReady = store.dispatch('initializeTabs').then((removeListener) => {
      removeTabsStateListener = removeListener
      window.ftElectron.tabs.rendererReady()
    })
    stopMemoryPressureMonitor = startMemoryPressureMonitor({
      getHeapStatistics: window.ftElectron.getHeapStatistics,
      getSettings: () => ({
        enabled: store.getters.getAutoUnloadTabs,
        memoryThreshold: store.getters.getAutoUnloadMemoryThreshold,
        tabPercentage: store.getters.getAutoUnloadTabPercentage
      }),
      unloadTabs: percentage => window.ftElectron.tabs.unloadLeastRecentlyUsed(percentage, getTabsKeptLoaded()),
      notify: count => showToast({
        message: t('Tabs Unloaded To Free Memory', { count }, count),
        icon: ['fas', 'memory']
      })
    })
  }

  const settingsReady = store.dispatch('grabUserSettings').then(async tutorialState => {
    if (isCapacitor) {
      await store.dispatch('loadAndroidProxySettings').catch(() => {
        showToast({
          message: t('Settings.Proxy Settings["Error getting network information. Is your proxy configured properly?"]'),
          icon: ['fas', 'circle-exclamation'],
        })
      })
    }
    removeInternetConnectivitySettingsListener = store.watch(
      () => store.getters.getInternetConnectivityChecks,
      enabled => initializeNetworkRecovery().setInternetChecksEnabled(enabled),
      { immediate: true, flush: 'sync' }
    )
    removeAndroidYtDlpSettingsListener = initializeCapacitorYtDlp()
    return tutorialState
  })
  if (isCapacitor) {
    tabsReady = settingsReady.then(() => capacitorTabService.initialize(route))
    removeCapacitorTabPreviews = initializeCapacitorTabPreviews(store, computed(() => pageSwipe.value || organizerSwipeActive.value))
  }
  const customThemesReady = loadCustomThemes().catch((error) => {
    console.error('Failed to load custom theme:', error)
    return []
  })
  const invidiousInstancesReady = store.dispatch('fetchInvidiousInstancesFromFile')
  const profilesReady = settingsReady.then(() => (
    store.dispatch('grabAllProfiles', t('Profile.All Channels'))
  ))
  // The library needs only settings (history retention) and profiles
  // (subscriptions). Load it during the remaining startup work instead of after.
  const libraryReady = Promise.all([
    settingsReady.then(() => Promise.all([store.dispatch('grabHistory'), store.dispatch('grabAllPlaylists')])),
    profilesReady.then(() => store.dispatch('grabAllSubscriptions')),
  ])
  tabsReady.then(() => {
    const initialRoute = usesLogicalTabs ? store.getters.getActiveTab?.route : route
    if (initialRoute) {
      return preloadResolvedRoute(router.resolve(initialRoute.fullPath))
    }
  }).catch(error => {
    console.error('Failed to preload the initial route', error)
  })
  const [tutorialState, themes] = await Promise.all([
    settingsReady,
    customThemesReady,
    invidiousInstancesReady,
    tabsReady,
  ])
  const lastUsedVersion = getLastUsedVersion(tutorialState.lastUsedVersion)
  const showAutoSyncNotice = shouldShowAutoSyncNotice(lastUsedVersion, store.state.settings)
  if (tutorialState.landingPageToInitialize !== null) {
    await store.dispatch('updateLandingPage', tutorialState.landingPageToInitialize)
  }

  try {
    store.commit('setCustomThemes', themes)
    if (baseTheme.value === 'custom' && themes.length > 0) {
      await store.dispatch('updateBaseTheme', `custom:${themes[0].id}`)
    }
    await sanitizeAppearanceSettings(themes)
  } catch (error) {
    console.error('Failed to load custom theme:', error)
  }
  removeCustomThemeListener = handleCustomThemeUpdated(async (themes) => {
    store.commit('setCustomThemes', themes)
    await repairSystemThemeSettings(store, themes)
    updateTheme()
  })
  appearanceSettingsReady = true
  updateTheme()
  if (store.getters.getTrayIconPreset !== 'theme') refreshTrayIcon()

  if (defaultInvidiousInstance.value === '') {
    await store.dispatch('setRandomCurrentInvidiousInstance')
  }

  store.dispatch('fetchInvidiousInstances').then(() => {
    if (defaultInvidiousInstance.value === '') {
      store.dispatch('setRandomCurrentInvidiousInstance')
    }
  })

  profilesReady.then(async (hasExistingProfiles) => {
    const hasExistingInstallation = tutorialState.hasExistingSettings === true || hasExistingProfiles === true
      ? true
      : tutorialState.hasExistingSettings === null || hasExistingProfiles === null
        ? null
        : false
    const tutorialPending = await initializeTutorial(
      hasExistingInstallation,
      lastUsedVersion,
      tutorialState.tutorialAudience
    )
    if (hasExistingInstallation !== null || lastUsedVersion !== null) {
      await setLastUsedVersion(packageDetails.version)
    }

    store.dispatch('grabSearchHistoryEntries')

    // YouTube links have to be caught in both builds, otherwise the browser
    // navigates away from the app instead of opening the linked video,
    // channel, playlist or hashtag in it
    document.addEventListener('click', handleClick)
    document.addEventListener('auxclick', handleAuxClick)
    removeRoutePreloadIntent = installRoutePreloadIntent({
      preload: path => preloadResolvedRoute(router.resolve(path))
    })

    if (process.env.IS_ELECTRON) {
      store.dispatch('setupListenersToSyncWindows')
      removeOpenUrlListener = enableOpenUrl()
      store.dispatch('getExternalPlayerCmdArgumentsData')
      removeReloadRequestListener = window.ftElectron.tabs.onRequestReload(prepareAndReloadTab)
      removeConfirmMultipleTabsActionListener = window.ftElectron.tabs
        .onConfirmMultipleAction(handleConfirmMultipleTabsActionRequest)
    } else if (isCapacitor) {
      removeCapacitorIntegrationListeners = await enableCapacitorIntegrations()
    }

    await libraryReady
    store.dispatch('initializeSyncServer').catch(error => {
      console.error('Initial sync server sync failed', error)
    })

    dataReady.value = true

    if (process.env.IS_ELECTRON) {
      // Prompts teleport into .app, which renders once data is ready.
      nextTick(() => {
        removeLibraryNoticesListener = window.ftElectron.libraryNotices.onChanged(loadLibraryNotices)
        loadLibraryNotices()
      })
    }

    if (isCapacitor) {
      await listenForAndroidSubscriptionRefreshCancellation()
    }

    await nextTick()
    // Startup prompts teleport into .app, which only exists after dataReady renders.
    if (isCapacitor) {
      removeAndroidIncomingShare = await initializeAndroidIncomingShare(handleAndroidSharedText)
    }
    if (showAutoSyncNotice) {
      showAutoSyncNoticeOnce(release => {
        const dismissNotice = () => {
          dismissAutoSyncNotice()
          release()
        }
        showToast({
          message: t('Settings.Sync Settings.Previous Auto Sync Notice'),
          time: Infinity,
          dismissible: false,
          icon: ['fas', 'sync'],
          verticalButtons: true,
          buttons: [{
            label: t('Dismiss'),
            icon: ['fas', 'xmark'],
            action: dismissNotice,
          }, {
            label: t('Settings.Sync Settings.Enable Automatic Sync'),
            icon: ['fas', 'sync'],
            primary: true,
            action: async () => {
              try {
                await store.dispatch('setSyncServerAutoSync', true)
                dismissNotice()
              } catch (error) {
                showToast({ message: error.message })
              } finally {
                release()
              }
            },
          }],
        })
      })
    }
    scheduleUtilityRoutePreload()
    if (isCapacitor) {
      capacitorPullToRefreshSetup = initializeCapacitorPullToRefresh()
        .catch(error => console.error('Failed to initialize pull to refresh', error))
    }
    if (isElectron && tutorialPending) {
      try {
        await window.ftElectron.tabs.setShortcutsBlocked(true)
      } catch (error) {
        console.error('Failed to block tab shortcuts for tutorial', error)
      }
    }
    showTutorial.value = tutorialPending
    initializeManagedExternalSoftware().catch(error => console.error('Failed to initialize managed external software', error))

    setTimeout(() => {
      checkForNewUpdates()
    }, 500)
  })

  await router.isReady()

  if (isElectron) {
    const activeTab = store.getters.getActiveTab
    if (activeTab?.route.path === '/') {
      await navigation.replace(activeTab.id, { path: landingPage.value })
    }
  } else if (route.path === '/') {
    await router.replace({ path: landingPage.value })
  }

  setWindowTitle()

  document.addEventListener('keydown', handleKeyboardShortcuts)
  window.addEventListener('opentubex:close-context-menu', closeOwnedMobileContextMenu)
  window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette)
  window.addEventListener(OPEN_TAB_ORGANIZER_EVENT, openTabOrganizer)
  if (isCapacitor) {
    window.addEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
    window.addEventListener('opentubex:hardware-keyboard', handleHardwareKeyboardChange)
    if (process.env.IS_IOS) removeIosContextMenu = installIosContextMenu(document)
    document.addEventListener('contextmenu', handleMobileLinkContextMenu, true)
    hardwareKeyboardAttached.value = await getAndroidHardwareKeyboardState()
  }
  document.addEventListener('keyup', handleKeyboardShortcutKeyup)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('pointermove', handleNumberInputPointer, { passive: true })
  document.addEventListener('pointerdown', handleNumberInputPointer, { capture: true, passive: true })
  document.addEventListener('pointerup', handleNumberInputPointer, { capture: true, passive: true })
  document.addEventListener('pointerout', handleNumberInputPointer, { passive: true })
  document.addEventListener('dragstart', handleDragStart)
  window.addEventListener('blur', cancelTabSwitcher)
  if (process.env.IS_ELECTRON) {
    removeOpenTabOrganizerListener = window.ftElectron.tabs.onOpenOrganizer(openTabOrganizer)
  }
  addSubscriptionRefreshListeners()
})

onBeforeUnmount(() => {
  cancelPageSwipe()
  removeShimmerVisibility?.()
  removeInternetConnectivitySettingsListener?.()
  tabletTabStripQuery.removeEventListener('change', handleTabletTabStripChange)
  capacitorTabService?.dispose()
  removeCapacitorTabPreviews?.()
  document.documentElement.classList.remove('hideOutlines')
  removeGamepadNavigation()
  removeCustomThemeListener()
  cancelUtilityRoutePreload()
  cancelTabSwitcher()
  if (isElectron) {
    window.ftElectron.tabs.setPreviewCapturePaused(false)
    window.ftElectron.tabs.setShortcutsBlocked(false).catch(() => {})
  }
  cancelWatchSideNavTransitionReset()
  clearInterval(historyCleanupTimer)
  store.dispatch('stopSyncServerAutoSync')
  document.removeEventListener('keydown', handleKeyboardShortcuts)
  window.removeEventListener('opentubex:close-context-menu', closeOwnedMobileContextMenu)
  window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette)
  window.removeEventListener(OPEN_TAB_ORGANIZER_EVENT, openTabOrganizer)
  window.removeEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
  window.removeEventListener('opentubex:hardware-keyboard', handleHardwareKeyboardChange)
  removeIosContextMenu?.()
  document.removeEventListener('contextmenu', handleMobileLinkContextMenu, true)
  document.removeEventListener('keyup', handleKeyboardShortcutKeyup)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('pointermove', handleNumberInputPointer)
  document.removeEventListener('pointerdown', handleNumberInputPointer, true)
  document.removeEventListener('pointerup', handleNumberInputPointer, true)
  document.removeEventListener('pointerout', handleNumberInputPointer)
  document.removeEventListener('dragstart', handleDragStart)
  document.removeEventListener('click', handleClick)
  document.removeEventListener('auxclick', handleAuxClick)
  window.removeEventListener('blur', cancelTabSwitcher)
  removeTabsStateListener?.()
  stopMemoryPressureMonitor?.()
  removeReloadRequestListener?.()
  removeConfirmMultipleTabsActionListener?.()
  removeLibraryNoticesListener?.()
  removeOpenUrlListener?.()
  removeRoutePreloadIntent?.()
  removeCapacitorIntegrationListeners?.()
  removeAndroidIncomingShare?.()
  capacitorPullToRefreshSetup?.then(remove => remove?.())
  removeYtDlpBinaryUpdatedListener?.()
  removeAndroidYtDlpSettingsListener?.()
  removeOpenTabOrganizerListener?.()
})

watch([activeTabId, selectionRevision], ([tabId, revision]) => {
  if (isElectron && tabId) {
    navigation.requestPresentation(tabId, revision)
  }
}, { immediate: true })

const STARTUP_PRELOAD_TIMEOUT_MS = 5000

watch([
  dataReady,
  presentedTabId,
  () => store.getters.getActiveTab?.loadState,
  () => store.getters.getTabById(presentedTabId.value)?.route.fullPath,
], async ([ready, presented, loadState, fullPath], _, onCleanup) => {
  if (!usesLogicalTabs || !ready || (!presented && loadState !== 'unloaded') || !document.getElementById('startup-splash')) return
  let cancelled = false
  let preloadTimeout
  onCleanup(() => {
    cancelled = true
    clearTimeout(preloadTimeout)
  })
  if (presented && fullPath) {
    try {
      // Tab presentation acknowledges its container before an async route has
      // loaded. Wait for its content, but expose the shell if the chunk stalls.
      await Promise.race([
        preloadResolvedRoute(router.resolve(fullPath)),
        new Promise(resolve => { preloadTimeout = setTimeout(resolve, STARTUP_PRELOAD_TIMEOUT_MS) })
      ])
    } catch (error) {
      // A failed route must still expose the shell so navigation can recover.
      console.error('Failed to load the startup route', error)
    } finally {
      clearTimeout(preloadTimeout)
    }
  }
  await nextTick()
  if (!cancelled) revealStartupSplash()
}, { flush: 'post' })

watch(historyRetentionDays, scheduleHistoryCleanup)

function scheduleHistoryCleanup(days) {
  clearInterval(historyCleanupTimer)
  historyCleanupTimer = null

  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return
  }

  historyCleanupTimer = setInterval(() => {
    store.dispatch('removeHistoryOlderThan', parsedDays)
  }, HISTORY_CLEANUP_INTERVAL)
}

const {
  addSubscriptionRefreshListeners,
  listenForAndroidSubscriptionRefreshCancellation
} = useSubscriptionAutoRefresh({ dataReady, t })

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => store.getters.getBaseTheme)
let appearanceSettingsReady = false
let removeCustomThemeListener = () => {}
const {
  systemUsesDarkTheme,
  refreshTrayIcon,
  cacheCapacitorStartupAppearance,
  updateSystemBarsStyle,
  sanitizeAppearanceSettings
} = useAppearance({ baseTheme, updateTheme, isAppearanceSettingsReady: () => appearanceSettingsReady })

watch(baseTheme, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const mainColor = computed(() => store.getters.getMainColor)

watch(mainColor, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const secColor = computed(() => store.getters.getSecColor)

watch(secColor, updateTheme)

function updateTheme() {
  // Keep Android's cached native background until the saved theme is known.
  // Applying the store's temporary system default can otherwise flash white.
  if (isCapacitor && Capacitor.getPlatform() === 'android' && !appearanceSettingsReady) return
  const effectiveTheme = baseTheme.value === 'system'
    ? (systemUsesDarkTheme.value ? store.getters.getSystemDarkTheme : store.getters.getSystemLightTheme)
    : baseTheme.value
  const customThemes = store.getters.getCustomThemes
  const customTheme = customThemes.find(theme => `custom:${theme.id}` === effectiveTheme) ??
    (effectiveTheme === 'custom' ? customThemes[0] : null) ?? null
  applyThemeToDocument(effectiveTheme, mainColor.value, secColor.value, customTheme, store.getters.getMaterialSeedColor)
  cacheCapacitorStartupAppearance()
  if (store.getters.getTrayIconPreset === 'theme') refreshTrayIcon()
  updateSystemBarsStyle()
}

updateTheme()

const showReleaseNotes = ref(false)
const changeLogTitle = ref('')
const updateChangelog = ref('')
useScrollClamp(useTemplateRef('changeLogScroller'), useTemplateRef('changeLogContent'))
const DISMISSED_UPDATE_VERSION_STORAGE_KEY = 'opentubex-dismissed-update-version'
/** @type {{ tagName: string, versionNumber: string } | null} */
let availableUpdate = null
let releaseNotesMarkdownPromise = null

function getReleaseNotesMarkdown() {
  releaseNotesMarkdownPromise ??= import('./helpers/releaseNotesMarkdown')
    .then(({ createReleaseNotesMarkdown }) => createReleaseNotesMarkdown())
  return releaseNotesMarkdownPromise
}

/** @type {import('vue').ComputedRef<boolean>} */
const checkForUpdates = computed(() => store.getters.getCheckForUpdates)

function dismissAvailableUpdate() {
  if (availableUpdate !== null) {
    sessionStorage.setItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY, availableUpdate.tagName)
  }
}

function showAvailableUpdateToast() {
  const update = availableUpdate
  if (
    update === null ||
    sessionStorage.getItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY) === update.tagName
  ) {
    return
  }

  showToast({
    message: t('Version {versionNumber} is now available.', {
      versionNumber: update.versionNumber
    }),
    time: Infinity,
    dismissible: false,
    icon: ['fas', 'sync'],
    verticalButtons: true,
    buttons: [
      {
        label: t('Dismiss'),
        icon: ['fas', 'xmark'],
        action: dismissAvailableUpdate
      },
      {
        label: t('See changes and update'),
        icon: ['fas', 'file-lines'],
        primary: true,
        action: () => {
          showReleaseNotes.value = true
        }
      }
    ]
  })
}

async function checkForNewUpdates() {
  if (!checkForUpdates.value) {
    return
  }

  const releasesUrl = 'https://api.github.com/repos/OpenTubeX/OpenTubeX/releases?per_page=100'

  try {
    const availableReleases = await fetchReleasePages(releasesUrl, fetch)
    const releases = findUpdateReleases(availableReleases, packageDetails.version)
    if (releases.length === 0) {
      return
    }

    const release = releases[0]
    const tagName = release.tag_name
    const versionNumber = tagName.replace('v', '').replace('-beta', '')
    if (sessionStorage.getItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY) === tagName) {
      return
    }

    const changelog = formatReleaseChangelog(releases)
      // Link usernames to their GitHub profiles
      .replaceAll(/@(\S+)\b/g, '[@$1](https://github.com/$1)')
      // Shorten pull request links to #1234
      .replaceAll(/https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/pull\/(\d+)/g, '[#$1]($&)')

    const releaseNotesMarkdown = await getReleaseNotesMarkdown()
    updateChangelog.value = releaseNotesMarkdown.parse(changelog)
    changeLogTitle.value = t('Update to {version}', { version: release.name ?? tagName })
    availableUpdate = { tagName, versionNumber }
    showAvailableUpdateToast()
  } catch (error) {
    console.error('errored while checking for updates', releasesUrl, error)
  }
}

function closeReleaseNotes() {
  showReleaseNotes.value = false
  showAvailableUpdateToast()
}

function openDownloadsPage() {
  dismissAvailableUpdate()
  openExternalLink('https://opentubex.org/downloads/')
  showReleaseNotes.value = false
}

/** @type {import('vue').ComputedRef<boolean>} */
const outlinesHidden = computed(() => store.getters.getOutlinesHidden)

watch(outlinesHidden, hidden => {
  document.documentElement.classList.toggle('hideOutlines', hidden)
}, { flush: 'sync', immediate: true })

const phoneLayout = usePhoneLayout()
const commandPaletteDownloads = computed(previous => {
  const downloads = Object.values(store.getters.getYtDlpDownloads).map(({ id, title, status }) => ({ id, title, status }))
  return previous?.length === downloads.length && downloads.every((download, index) => (
    download.id === previous[index].id && download.title === previous[index].title && download.status === previous[index].status
  ))
    ? previous
    : downloads
})
const commandPaletteVideoSources = computed(() => ({
  history: store.getters.getHistoryCacheSorted,
  saveVideoHistoryWithLastViewedPlaylist: store.getters.getSaveVideoHistoryWithLastViewedPlaylist,
  playlists: store.getters.getAllPlaylists,
  downloads: store.getters.getYtDlpDownloads,
  queue: store.getters.getWatchQueue,
  group: t('CommandPalette.Groups.Local Videos'),
  sources: {
    history: t('History.History'),
    playlists: t('Playlists'),
    downloads: t('Settings.Download Settings.Download Settings'),
    queue: t('Video.Queue'),
  },
  playLibraryVideo: playLibraryVideoFromCommandPalette,
  playDownloadedVideo: playDownloadedVideoFromCommandPalette,
  playQueuedVideo: playQueuedVideoFromCommandPalette,
  removeQueuedVideo: id => store.commit('removeVideoFromWatchQueue', id),
}))
const commandPaletteCommands = computed(() => createCommandPaletteRegistry({
  t,
  tm,
  locale: locale.value,
  routePath: route.path,
  store,
  downloads: commandPaletteDownloads.value,
  isElectron,
  isCapacitor,
  phoneLayout: phoneLayout.value,
  hardwareKeyboardAttached: hardwareKeyboardAttached.value,
  navigate: navigateFromCommandPalette,
  openSettingsSection,
  openSettingsSearchResult,
  openSettingsView,
  goHistory: goHistoryFromCommandPalette,
  openFindbar,
  focusSearch: focusSearchFromCommandPalette,
  showKeyboardShortcuts: () => store.dispatch('showKeyboardShortcutPrompt'),
  createTab: () => store.dispatch('createTab', { makeActive: true }),
  closeTabs: closeTabsFromCommandPalette,
  reloadTabs: reloadTabsFromCommandPalette,
  runShortcut: runShortcutFromCommandPalette,
  createWindow: createWindowFromCommandPalette,
  routeAvailable: path => availableRoutePaths.has(path),
  supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
  isMac: process.platform === 'darwin',
  isLinuxWayland: isLinuxWayland.value,
  supportsAutoPictureInPictureMinimize: supportsAutoPictureInPictureMinimize.value,
  systemUsesDarkTheme: systemUsesDarkTheme.value,
}))

function openCommandPalette() {
  if (showTutorial.value || (!commandPaletteOpen.value && isAnyPromptOpen.value)) return
  commandPaletteOpen.value = true
}

function closeCommandPalette() {
  commandPaletteOpen.value = false
}

function openTabOrganizer() {
  if (!isElectron || showTutorial.value || (!tabOrganizerOpen.value && isAnyPromptOpen.value)) return
  tabOrganizerOpen.value = true
}

function closeTabOrganizer() {
  tabOrganizerOpen.value = false
}

function navigateFromCommandPalette(location) {
  if (isElectron) {
    return navigation.push(presentedTabId.value, location)
  }
  return router.push(location)
}

function playLibraryVideoFromCommandPalette(video, location) {
  if (!isElectron || store.getters.getExternalPlayer === '' || store.getters.getDefaultViewingMode !== 'external_player') {
    return navigateFromCommandPalette(location)
  }
  const history = store.getters.getHistoryCacheById[video.videoId]
  const saveProgress = ['auto', 'semi-auto'].includes(store.getters.getWatchedProgressSavingMode)
  tabMediaCoordinator.dispatchAction('pause', {}, presentedTabId.value)
  window.ftElectron.openInExternalPlayer({
    videoId: video.videoId,
    // Palette results have no position within a remote playlist.
    playlistId: null,
    startTime: saveProgress ? history?.watchProgress ?? 0 : 0,
    playbackRate: store.getters.getDefaultPlayback,
  })
  if (store.getters.getRememberHistory && canMarkHistoryEntryAsWatched(video)) {
    store.dispatch('updateHistory', {
      ...video,
      ...history,
      watchProgress: history?.watchProgress ?? 0,
      isWatched: true,
      timeWatched: history?.timeWatched ?? Date.now(),
      type: 'video',
    })
  }
}

function playQueuedVideoFromCommandPalette(location) {
  const currentRoute = usesLogicalTabs ? store.getters.getTabById(presentedTabId.value)?.route : route
  const withoutTimestamp = fullPath => {
    const url = new URL(fullPath, 'https://opentubex.invalid')
    url.searchParams.delete('timestamp')
    return `${url.pathname}${url.search}${url.hash}`
  }
  if (currentRoute && withoutTimestamp(router.resolve(location).fullPath) === withoutTimestamp(currentRoute.fullPath)) {
    const mediaTabId = usesLogicalTabs ? presentedTabId.value : 'web'
    tabMediaCoordinator.dispatchAction('seekto', { seekTime: 0 }, mediaTabId)
    tabMediaCoordinator.dispatchAction('play', {}, mediaTabId)
    return
  }
  return navigateFromCommandPalette(location)
}

function playDownloadedVideoFromCommandPalette(id, file) {
  return playDownloadedFile(id, file, {
    refreshDownloads: () => refreshDownloadRecords(ytDlp, store),
    playNative: (id, path) => ytDlp.ytDlpPlayDownload(id, path),
    navigate: navigateFromCommandPalette,
    fileNotFound: () => showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] }),
  })
}

function goHistoryFromCommandPalette(offset) {
  if (usesLogicalTabs) {
    return navigation.go(presentedTabId.value, offset)
  }
  return router.go(offset)
}

function handleAndroidPictureInPictureChange(event) {
  setAndroidPictureInPictureDocumentState(event.active === true, event)
}

function handleHardwareKeyboardChange(event) {
  hardwareKeyboardAttached.value = event.attached === true
  if (!hardwareKeyboardAttached.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
  }
}

function openSettingsView(view) {
  settingsSearchTarget.value = null
  store.commit('setSettingsWindowSection', null)
  store.dispatch('showSettingsWindow', view)
}

function openSettingsSection(section) {
  settingsSearchTarget.value = null
  store.commit('setSettingsWindowSection', section)
  store.dispatch('showSettingsWindow')
}

function openSettingsSearchResult(section, match) {
  settingsSearchTarget.value = { section, ...match }
  store.commit('setSettingsWindowSection', null)
  store.dispatch('showSettingsWindow')
}

function clearSettingsSearchTarget(target) {
  if (settingsSearchTarget.value === target) {
    settingsSearchTarget.value = null
  }
}

function focusSearchFromCommandPalette() {
  window.dispatchEvent(new CustomEvent('opentubex:focus-search'))
}

function createWindowFromCommandPalette() {
  if (isElectron) {
    openInternalPath({
      path: landingPage.value,
      doCreateNewWindow: true
    })
    return
  }

  const url = new URL(window.location.href)
  url.hash = landingPage.value
  window.open(url.toString(), '_blank', 'noreferrer')
}

async function closeTabsFromCommandPalette() {
  const hasRemainingTabs = await closeShortcutTabs()
  if (!hasRemainingTabs) window.close()
}

function reloadTabsFromCommandPalette() {
  for (const tabId of getShortcutTabIds()) prepareAndReloadTab(tabId)
}

function runShortcutFromCommandPalette(shortcut) {
  nextTick(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInitFromShortcut(shortcut)))
  })
}

function handleGamepadPlayPause() {
  document.dispatchEvent(new KeyboardEvent(
    'keydown',
    keyboardEventInitFromShortcut(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY)
  ))
}

function handleGamepadBack() {
  const hadOpenLayer = hasVisibleGamepadLayer()
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  })

  if (!target.dispatchEvent(escapeEvent) || hadOpenLayer) {
    return
  }
  if (document.fullscreenElement !== null) {
    document.exitFullscreen()
    return
  }

  goHistoryFromCommandPalette(-1)
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  if (showTutorial.value) return

  if (event.key === 'Escape' && (mobileContextLink.value || mobileContextActions.value)) {
    event.preventDefault()
    backMobileContextMenu()
    return
  }

  const shortcuts = KeyboardShortcuts.APP.GENERAL

  if (matchesKeyboardShortcut(event, shortcuts.OPEN_COMMAND_PALETTE)) {
    event.preventDefault()
    if (commandPaletteOpen.value) {
      closeCommandPalette()
    } else {
      openCommandPalette()
    }
    return
  }

  if (isElectron && !commandPaletteOpen.value &&
    matchesKeyboardShortcut(event, shortcuts.OPEN_TAB_ORGANIZER) &&
    (tabOrganizerOpen.value || !isTypingTarget(event.target))) {
    event.preventDefault()
    if (event.repeat) return
    if (tabOrganizerOpen.value) closeTabOrganizer()
    else openTabOrganizer()
    return
  }

  if (commandPaletteOpen.value || tabOrganizerOpen.value) return

  if (matchesKeyboardShortcut(event, shortcuts.COPY_CURRENT_URL)) {
    event.preventDefault()
    const appUrl = window.location.href.split('#')[0]
    const publicUrl = resolveMobileContextLinkCopyUrl(window.location.href, appUrl)
    if (publicUrl) {
      copyToClipboard(publicUrl, {
        messageOnSuccess: t('Share.YouTube URL copied to clipboard')
      })
    }
    return
  }

  if (matchesKeyboardShortcut(event, shortcuts.FIND_IN_PAGE)) {
    event.preventDefault()
    store.dispatch('showOutlines')
    openFindbar()
    return
  }

  if (supportsYtDlp && matchesKeyboardShortcut(event, shortcuts.NAVIGATE_TO_DOWNLOADS)) {
    event.preventDefault()
    store.dispatch('showSettingsWindow', 'downloads')
    return
  }

  if (findbarVisible.value && handleFindbarNavigationShortcut(event)) {
    return
  }

  if (event.key === 'Escape' && isTabSwitcherActive()) {
    event.preventDefault()
    cancelTabSwitcher()
    return
  }

  if (findbarVisible.value && event.key === 'Escape') {
    event.preventDefault()
    closeFindbar()
    return
  }

  if (findbarVisible.value && event.key === 'Enter' && !isTypingTarget(event.target)) {
    event.preventDefault()
    findInPage(event.shiftKey)
    return
  }

  if (matchesKeyboardShortcut(event, shortcuts.SHOW_SHORTCUTS) && !isTypingTarget(event.target)) {
    event.preventDefault()
    store.dispatch(isKeyboardShortcutPromptShown.value && settingsWindowOpen.value
      ? 'hideSettingsWindow'
      : 'showKeyboardShortcutPrompt')
  }

  if (event.key === 'Tab' && !event.ctrlKey) {
    store.dispatch('showOutlines')
  }

  // Tab keyboard shortcuts (Electron only)
  if (process.env.IS_ELECTRON) {
    // Ctrl+1..9: Switch to tab by number
    if (matchesKeyboardShortcut(event, shortcuts.SWITCH_TO_TAB)) {
      if (!isTypingTarget(event.target)) {
        const index = parseInt(event.key, 10) - 1
        const tabs = store.state.tabs.tabs
        if (index < tabs.length) {
          event.preventDefault()
          store.dispatch('activateTab', tabs[index].id)
          return
        }
      }
    }

    // F1: Toggle between horizontal and vertical tabs
    if (matchesKeyboardShortcut(event, shortcuts.TOGGLE_TAB_ORIENTATION) && !isTypingTarget(event.target)) {
      event.preventDefault()
      cycleTabLayout()
      return
    }

    // Ctrl+T: New tab
    if (matchesKeyboardShortcut(event, shortcuts.NEW_TAB)) {
      event.preventDefault()
      store.dispatch('createTab', { makeActive: true })
      return
    }

    if (matchesKeyboardShortcut(event, shortcuts.RESTORE_CLOSED_WINDOW)) {
      event.preventDefault()
      window.ftElectron.reopenClosedWindow()
      return
    }

    // Ctrl+Shift+T: Restore closed tab
    if (matchesKeyboardShortcut(event, shortcuts.RESTORE_CLOSED_TAB)) {
      event.preventDefault()
      store.dispatch('restoreClosedTab')
      return
    }

    // Ctrl+W: Close tab (handled in menu, but also here for robustness)
    if (matchesKeyboardShortcut(event, shortcuts.CLOSE_TAB)) {
      event.preventDefault()
      closeShortcutTabs().then((hasRemainingTabs) => {
        if (!hasRemainingTabs) {
          window.close()
        }
      })
      return
    }

    // Ctrl+Tab: Next tab
    if (matchesKeyboardShortcut(event, shortcuts.NEXT_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(1)
      return
    }

    // Ctrl+Shift+Tab: Previous tab
    if (matchesKeyboardShortcut(event, shortcuts.PREV_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(-1)
      return
    }

    // Reload tab unless the current view handles refresh itself
    if ([shortcuts.RELOAD_TAB, shortcuts.RELOAD_TAB_ALT]
      .some(shortcut => matchesKeyboardShortcut(event, shortcut))) {
      const tabIds = getShortcutTabIds()
      if (tabIds.length === 1 && route.path.startsWith('/subscriptions')) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      for (const tabId of tabIds) {
        prepareAndReloadTab(tabId)
      }
    }
  }
}

/**
 * The setting is only committed to the store once it has been persisted, so
 * consecutive presses are queued to keep every one of them from advancing
 * from the same stale value.
 */
let pendingTabLayoutUpdate = Promise.resolve()

function cycleTabLayout() {
  pendingTabLayoutUpdate = pendingTabLayoutUpdate.then(() =>
    store.dispatch('updateTabBarPosition', getNextTabBarPosition(tabBarPosition.value))
  )
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

async function prepareAndReloadTab(tabId = activeTabId.value) {
  const tab = store.getters.getTabById(tabId)
  if (!tab) {
    return
  }

  if (tab.route.path.startsWith('/watch/')) {
    const timestamp = store.getters.getWatchTimestamp(tabId)
    if (typeof timestamp === 'number' && timestamp > 0) {
      navigation.prepareReload(tabId, {
        path: tab.route.path,
        query: { ...tab.route.query, oneTimeTimestamp: Math.floor(timestamp) }
      })
    }
  }
  store.dispatch('reloadTab', tabId)
}

function getShortcutTabIds() {
  const selectedTabIds = store.getters.getSelectedTabIds
  return selectedTabIds.length > 1
    ? [...selectedTabIds]
    : activeTabId.value ? [activeTabId.value] : []
}

/** @type {import('vue').Ref<Array<'olderVersionChanges' | 'libraryFormatChanged'>>} */
const libraryNotices = ref([])
const libraryNotice = computed(() => {
  switch (libraryNotices.value[0]) {
    case 'olderVersionChanges':
      return {
        title: t('Older Version Changes.Title'),
        message: t('Older Version Changes.Message'),
        detail: t('Older Version Changes.Detail'),
      }
    case 'libraryFormatChanged':
      return {
        title: t('Library Format Changed.Title'),
        message: t('Library Format Changed.Message'),
        detail: t('Library Format Changed.Detail'),
      }
    default:
      return null
  }
})

async function loadLibraryNotices() {
  try {
    libraryNotices.value = await window.ftElectron.libraryNotices.get()
  } catch (error) {
    console.error('Failed to load library notices', error)
  }
}

function dismissLibraryNotice() {
  const notice = libraryNotices.value.shift()
  if (notice) window.ftElectron.libraryNotices.dismiss(notice)
}

const {
  multipleTabsActionPrompt,
  MULTIPLE_TABS_ACTION_PROMPT_VALUES,
  multipleTabsActionPromptTitle,
  multipleTabsActionPromptMessage,
  multipleTabsActionPromptNames,
  confirmMultipleTabsAction,
  handleMultipleTabsActionPromptAnswer,
  handleConfirmMultipleTabsActionRequest
} = useMultipleTabsActionConfirmation({ t })

async function closeShortcutTabs() {
  const tabIds = getShortcutTabIds()
  if (tabIds.length >= MULTIPLE_TABS_CONFIRM_THRESHOLD && !await confirmMultipleTabsAction(tabIds.length, 'close')) {
    return true
  }

  if (tabIds.length === 0) {
    return true
  }
  if (tabIds.length === 1) {
    return await store.dispatch('closeTab', tabIds[0])
  }

  return await store.dispatch('closeTabs', tabIds)
}

function handleMouseDown() {
  store.dispatch('hideOutlines')
}

/** @param {PointerEvent} event */
function handleNumberInputPointer(event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.type !== 'number') return
  if (event.type === 'pointerout') {
    if (event.relatedTarget !== input) {
      input.style.removeProperty('--number-step-up-color')
      input.style.removeProperty('--number-step-down-color')
    }
    return
  }
  if (input.disabled || input.readOnly) return

  // Chromium exposes both native step arrows as one pseudo-element. Split its
  // paint at the content's center while keeping native stepping and key repeat.
  const bounds = input.getBoundingClientRect()
  const style = getComputedStyle(input)
  const rtl = style.direction === 'rtl'
  const edge = rtl ? bounds.left + parseFloat(style.paddingLeft) + 4 : bounds.right - parseFloat(style.paddingRight) - 4
  const middle = bounds.top + (bounds.height + parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / 2
  let hoveredStep = ''
  if (Math.abs(event.clientX - edge) <= 12 && Math.abs(event.clientY - middle) <= 14) {
    hoveredStep = event.clientY < middle ? 'up' : 'down'
  }
  const highlight = event.buttons & 1 ? 'var(--primary-color-active)' : 'var(--primary-color)'
  for (const step of ['up', 'down']) {
    const property = `--number-step-${step}-color`
    const color = hoveredStep === step ? highlight : ''
    if (input.style.getPropertyValue(property) !== color) {
      if (color) input.style.setProperty(property, color)
      else input.style.removeProperty(property)
    }
  }
}

const lastExternalLinkToBeOpened = ref('')
const showExternalLinkOpeningPrompt = ref(false)
const EXTERNAL_LINK_OPENING_PROMPT_VALUES = ['yes', 'no']

const externalLinkOpeningPromptNames = computed(() => [
  t('Yes, Open Link'),
  t('No')
])

/** @type {import('vue').ComputedRef<'' | 'openLinkAfterPrompt' | 'doNothing'>} */
const externalLinkHandling = computed(() => store.getters.getExternalLinkHandling)

/**
 * @param {'yes' | 'no' | null} option
 */
function handleExternalLinkOpeningPromptAnswer(option) {
  showExternalLinkOpeningPrompt.value = false

  if (option === 'yes' && lastExternalLinkToBeOpened.value.length > 0) {
    // Maybe user should be notified
    // if `lastExternalLinkToBeOpened` is empty

    // Open links externally
    openExternalLink(lastExternalLinkToBeOpened.value)
  }
}

/**
 * @param {PointerEvent} event
 * @returns {HTMLAnchorElement | null}
 */
function getEventLink(event) {
  const target = event.target instanceof Element ? event.target : null
  const link = target?.closest('a[href]')
  return link instanceof HTMLAnchorElement ? link : null
}

/**
 * @param {HTMLAnchorElement} link
 */
function isExternalLink(link) {
  return link.origin !== window.location.origin
}

/**
 * Opens modified clicks on ordinary internal links through the app's tab and
 * window APIs. Components with specialized navigation can opt out by calling
 * preventDefault() before the event reaches the document.
 * @param {PointerEvent} event
 * @param {HTMLAnchorElement | null} link
 */
function handleInternalLinkShortcut(event, link) {
  if (!process.env.IS_ELECTRON || event.defaultPrevented || link === null || isExternalLink(link)) {
    return false
  }

  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const ctrlOrCmdPressed = process.platform === 'darwin' ? event.metaKey : event.ctrlKey
  const isCtrlOrCmdClick = event.type === 'click' && event.button === 0 && ctrlOrCmdPressed && !event.altKey
  if (!isMiddleClick && !isCtrlOrCmdClick) {
    return false
  }

  const hashRoute = new URL(link.href).hash.slice(1)
  if (!hashRoute.startsWith('/')) {
    return false
  }

  const destination = router.resolve(hashRoute)
  event.preventDefault()
  openInternalPath({
    path: destination.path,
    query: destination.query,
    title: link.dataset.tabTitle || undefined,
    doCreateNewWindow: event.shiftKey,
    doCreateNewTab: !event.shiftKey,
    makeActive: isCtrlOrCmdClick,
    lazyLoad: isUnloadedBackgroundTabClick(event)
  })
  return true
}

/**
 * @param {PointerEvent} event
 */
function handleClick(event) {
  const link = getEventLink(event)
  if (handleInternalLinkShortcut(event, link)) {
    return
  }

  if (link !== null && isExternalLink(link)) {
    handleLinkClick(event, link)
  }
}

/**
 * @param {PointerEvent} event
 */
function handleAuxClick(event) {
  const link = getEventLink(event)

  // auxclick fires for all clicks not performed with the primary button
  // only handle the link click if it was the middle button,
  // otherwise the context menu breaks
  if (event.button === 1 && handleInternalLinkShortcut(event, link)) {
    return
  }

  if (link !== null && isExternalLink(link) && event.button === 1) {
    handleLinkClick(event, link)
    return
  }

  // The tab rework replaced the browser's navigation history with a per-tab
  // logical history, so Chromium's native mouse back/forward buttons no longer
  // navigate anything. Route buttons 3 (back) and 4 (forward) through the tab
  // navigation service instead. auxclick fires once per click, avoiding the
  // double dispatch seen with mousedown/mouseup for these buttons.
  // The web build has no logical tabs and the browser's own history still
  // works there, so those buttons are left alone.
  if (process.env.IS_ELECTRON && (event.button === 3 || event.button === 4)) {
    event.preventDefault()

    const tabId = activeTabId.value
    if (tabId != null) {
      navigation.go(tabId, event.button === 3 ? -1 : 1)
    }
  }
}

/**
 * @param {string} href
 */
function handleExternalLink(href) {
  const action = resolveExternalLinkAction(externalLinkHandling.value)
  if (action === 'disabled') {
    showToast({
      message: t('External link opening has been disabled in Settings → Privacy'),
      icon: ['fas', 'link-slash'],
    })
  } else if (action === 'prompt') {
    lastExternalLinkToBeOpened.value = href
    showExternalLinkOpeningPrompt.value = true
  } else {
    openExternalLink(href)
  }
}

provide('handleExternalLink', handleExternalLink)

/**
 * @param {PointerEvent} event
 * @param {HTMLAnchorElement} link
 */
function handleLinkClick(event, link) {
  const href = link.href
  event.preventDefault()

  // Check if it's a YouTube link, but exclude live chat pop out
  const youtubeUrlPattern = /^https?:\/\/((www\.|m\.)?youtube\.com(\/embed)?|youtu\.be)\/(?!.*live_chat).*$/
  const isYoutubeLink = youtubeUrlPattern.test(href)

  // Determine if we should open in new tab or new window.
  // `process.platform` is `undefined` in the web build, where the app can be
  // opened from any OS, so both modifiers count there.
  const ctrlOrCmdPressed = process.env.IS_ELECTRON
    ? ((process.platform !== 'darwin' && event.ctrlKey) || (process.platform === 'darwin' && event.metaKey))
    : (event.ctrlKey || event.metaKey)
  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const doCreateNewTab = ctrlOrCmdPressed || isMiddleClick
  const doCreateNewWindow = event.shiftKey

  if (isYoutubeLink) {
    handleYoutubeLink(href, {
      doCreateNewWindow,
      doCreateNewTab,
      isMiddleClick,
      lazyLoad: isUnloadedBackgroundTabClick(event)
    })
  } else {
    handleExternalLink(href)
  }
}

async function handleYoutubeLink(href, {
  doCreateNewWindow = false,
  doCreateNewTab = false,
  isMiddleClick = false,
  lazyLoad = false,
  tabId = null
} = {}) {
  const result = await store.dispatch('getYoutubeUrlInfo', tabId ? { url: href, tabId } : href)
  // Middle clicks should open tabs in background (not make them active)
  const makeActive = !isMiddleClick
  const openPath = (options) => {
    if (isElectron && tabId && !options.doCreateNewWindow && !options.doCreateNewTab) {
      return navigation.push(tabId, { path: options.path, query: options.query })
    }
    return openInternalPath({ ...options, lazyLoad })
  }

  switch (result.urlType) {
    case 'video': {
      const { videoId, timestamp, playlistId, commentId, isShort } = result

      const query = {}
      if (isShort) {
        query.short = 'true'
      }
      if (timestamp) {
        query.timestamp = timestamp
      }
      if (playlistId && playlistId.length > 0) {
        query.playlistId = playlistId
      }
      if (commentId) {
        query.commentId = commentId
      }

      openPath({
        path: `/watch/${videoId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'playlist': {
      const { playlistId, query } = result

      openPath({
        path: `/playlist/${playlistId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'search': {
      const { searchQuery, query } = result

      openPath({
        path: `/search/${encodeURIComponent(searchQuery)}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        searchQueryText: searchQuery
      })
      break
    }

    case 'hashtag': {
      const { hashtag } = result
      openPath({
        path: `/hashtag/${encodeURIComponent(hashtag)}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'post': {
      const { postId, query } = result

      openPath({
        path: `/post/${postId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'channel': {
      const { channelId, subPath, url } = result

      openPath({
        path: `/channel/${channelId}/${subPath}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        query: {
          url
        }
      })
      break
    }

    case 'trending':
    case 'subscriptions':
    case 'history':
    case 'userplaylists':
      openPath({
        path: `/${result.urlType}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break

    case 'invalid_url': {
      // Do nothing
      break
    }

    default: {
      // Unknown URL type
      showToast({
        message: t('Unknown YouTube url type, cannot be opened in app'),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  }
}

function enableOpenUrl() {
  return window.ftElectron.handleOpenUrl((url, tabId) => {
    if (url) {
      handleYoutubeLink(url, { tabId })
    }
  })
}

const windowTitle = computed(() => {
  const routePath = route.path
  if (
    !routePath.startsWith('/channel/') &&
    !routePath.startsWith('/watch/') &&
    !routePath.startsWith('/hashtag/') &&
    !routePath.startsWith('/playlist/') &&
    !routePath.startsWith('/search/')
  ) {
    return translateWindowTitle(route.meta.title)
  } else {
    return null
  }
})

/** @type {import('vue').ComputedRef<string>} */
const appTitle = computed(() => {
  if (isElectron) {
    const tab = store.getters.getTabById(presentedTabId.value)
    return tab?.contentTitle ?? ''
  }
  return store.getters.getAppTitle
})

function publishAppTitle(value) {
  if (value.length > 0) {
    document.title = `${value} - ${packageDetails.productName}`
  } else {
    document.title = packageDetails.productName
  }

  if (isElectron && presentedTabId.value) {
    window.ftElectron.setWindowTitle(document.title, presentedTabId.value)
  }
}

watch(appTitle, publishAppTitle)

// Also watch the route: the title string alone can stay identical across a
// route change (e.g. '/' and '/subscriptions' share the same title), which
// would leave a tab's placeholder title in place when the route-match guard
// in setWindowTitle deferred an earlier update.
watch([windowTitle, () => route.fullPath], setWindowTitle)

function setWindowTitle() {
  if (windowTitle.value === null) {
    return
  }

  const titleTabId = store.state.tabs.transitionTargetTabId ?? presentedTabId.value
  if (usesLogicalTabs && titleTabId) {
    // During startup the shared router briefly sits on its initial route while
    // the restored tab's own route hasn't been projected yet. Only attribute
    // the router's title to the tab when it is actually on this route.
    const tab = store.getters.getTabById(titleTabId)
    if (tab && tab.route.fullPath !== route.fullPath) {
      return
    }
    navigation.setTitle(titleTabId, windowTitle.value)
  } else {
    store.commit('setAppTitle', windowTitle.value)
    publishAppTitle(windowTitle.value)
  }
}

const isLocaleRightToLeft = computed(() => {
  const locale_ = locale.value

  return locale_ === 'ar' || locale_ === 'fa' || locale_ === 'he' ||
  locale_ === 'ur' || locale_ === 'yi' || locale_ === 'ku'
})

watch(locale, (value) => {
  document.documentElement.lang = value

  document.body.dir = isLocaleRightToLeft.value ? 'rtl' : 'ltr'
}, { immediate: true })

// Follows isLocaleRightToLeft, which sets the direction of Back previews.
const {
  showAndroidExitPrompt,
  ANDROID_EXIT_PROMPT_VALUES,
  androidExitPromptNames,
  requestAndroidAppExit,
  handleAndroidExitPromptAnswer,
  handleAndroidBack,
  shouldInterceptAndroidBack,
  getAndroidBackPreview
} = useAndroidBack({
  t,
  navigation,
  presentedTabId,
  settingsWindowOpen,
  isAnyPromptOpen,
  isSideNavOpen,
  closeSideNav,
  useWatchSideNavOverlay,
  isLocaleRightToLeft,
  mobileContextLink,
  mobileContextActions,
  mobileLinkActionsRef,
  backMobileContextMenu
})

const {
  sharedYoutubeLink,
  handleAndroidSharedText,
  openSharedYoutubeLink,
  enableCapacitorIntegrations
} = useCapacitorIntegrations({
  t,
  locale,
  dataReady,
  isAnyPromptOpen,
  handleYoutubeLink,
  handleAndroidBack,
  getAndroidBackPreview,
  shouldInterceptAndroidBack
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/**
 * Transforms dragged in-app URLs into YouTube ones, so they they can be dragged into other applications.
 * Cancels the drag operation if the URL is FreeTube specific and cannot be transformed e.g. user playlist URLs
 * @param {DragEvent} event
 */
function handleDragStart(event) {
  if (!event.dataTransfer.types.includes('text/uri-list')) {
    return
  }

  const originalUrlString = event.dataTransfer.getData('text/uri-list')
  const originalUrl = new URL(originalUrlString)

  // Check if this is an in-app URL
  if (originalUrl.origin !== window.location.origin || originalUrl.pathname !== window.location.pathname) {
    return
  }

  const [path, query] = originalUrl.hash.slice(2).split('?')
  const pathParts = path.split('/')
  const params = new URLSearchParams(query)

  let transformed = false
  let transformedURL = new URL('https://www.youtube.com')

  switch (pathParts[0]) {
    case 'watch':
      transformedURL.pathname = '/watch'
      transformedURL.searchParams.set('v', pathParts[1])

      if (params.has('timestamp')) {
        transformedURL.searchParams.set('t', params.get('timestamp') + 's')
      }

      if (params.has('playlistId') && params.get('playlistType') !== 'user') {
        transformedURL.searchParams.set('list', params.get('playlistId'))
      }

      transformed = true
      break
    case 'playlist':
      if (params.get('playlistType') !== 'user') {
        transformedURL.pathname = '/playlist'
        transformedURL.searchParams.set('list', pathParts[1])

        transformed = true
      }
      break
    case 'channel':
      transformedURL.pathname = `/channel/${pathParts[1]}`

      if (pathParts[2]) {
        switch (pathParts[2]) {
          case 'community':
            transformedURL.pathname += '/posts'
            break
          case 'search':
            transformedURL.pathname += '/search'
            if (params.has('searchQueryText')) {
              transformedURL.searchParams.set('query', params.get('searchQueryText'))
            }
            break
          case 'videos':
          case 'shorts':
          case 'releases':
          case 'podcasts':
          case 'courses':
          case 'playlists':
          case 'about':
            transformedURL.pathname += `/${pathParts[2]}`
            break
        }
      }

      transformed = true
      break
    case 'search':
      transformedURL.pathname = '/results'
      transformedURL.searchParams.set('search_query', decodeURIComponent(pathParts[1]))
      transformed = true
      break
    case 'hashtag':
    case 'post':
      transformedURL.pathname = `/${pathParts[0]}/${pathParts[1]}`
      transformed = true
      break
    case 'subscriptions':
    case 'history':
      transformedURL.pathname = `/feed/${pathParts[1]}`
      transformed = true
      break
    case 'userplaylists':
      transformedURL.pathname = '/feed/playlists'
      transformed = true
      break
    case 'settings':
      transformedURL.pathname = '/account'
      transformed = true
      break
    case 'about':
      transformedURL.pathname = '/about'
      transformed = true
      break
    case 'popular':
      transformedURL = new URL(`${currentInvidiousInstanceUrl.value}/feed/popular`)
      transformed = true
      break
  }

  if (transformed) {
    const transformedURLString = transformedURL.toString()

    event.dataTransfer.setData('text/uri-list', transformedURLString)

    const plainText = event.dataTransfer.getData('text/plain')
    if (plainText.length > 0) {
      event.dataTransfer.setData('text/plain', plainText.replaceAll(originalUrlString, transformedURLString))
    }

    const html = event.dataTransfer.getData('text/html')
    if (html.length > 0) {
      const originalUrlStringEncoded = originalUrlString.replaceAll('&', '&amp;')
      const transformedURLStringEncoded = transformedURLString.replaceAll('&', '&amp;')

      event.dataTransfer.setData('text/html', html.replaceAll(originalUrlStringEncoded, transformedURLStringEncoded))
    }
  } else {
    // Cancel the drag operation for FreeTube specific URLs that cannot be transformed such as user playlist URLs
    event.preventDefault()
    event.stopPropagation()
  }
}
</script>

<style src="./themes.css" />
<style scoped src="./App.css" />
