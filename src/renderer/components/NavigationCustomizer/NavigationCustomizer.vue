<template>
  <div class="settingButtonWithSync">
    <FtButton
      data-settings-subpage="navigation"
      :label="t('Settings.General Settings.Navigation.Customize Navigation')"
      :icon="['fas', 'bars']"
      @click="open = true"
    />
    <FtSyncedSettingIndicator setting-key="navigationItems" />
  </div>

  <FtSettingsSubpage
    :open="open"
    grow-with-content
    :title="t('Settings.General Settings.Navigation.Customize Navigation')"
    :icon="['fas', 'bars']"
    @close="close"
  >
    <template #breadcrumb-action>
      <FtSyncedSettingIndicator setting-key="navigationItems" />
    </template>
    <div class="navigationActions">
      <div
        ref="itemPickerAnchorRef"
        class="itemPickerAnchor"
      >
        <FtButton
          :label="t('Settings.General Settings.Navigation.Add Item')"
          :icon="['fas', 'plus']"
          aria-haspopup="menu"
          :aria-expanded="itemPickerOpen"
          :aria-controls="itemPickerId"
          :disabled="availableItems.length === 0"
          @click="toggleItemPicker"
        />
        <div
          v-if="itemPickerOpen"
          :id="itemPickerId"
          class="itemPickerPopover"
          data-settings-escape-scope
          role="menu"
          tabindex="-1"
          :aria-label="t('Settings.General Settings.Navigation.Add Item')"
          @keydown.esc.stop="closeItemPicker(true)"
          @keydown.down.prevent="focusAdjacentPickerItem($event, 1)"
          @keydown.up.prevent="focusAdjacentPickerItem($event, -1)"
        >
          <div
            ref="itemPickerListRef"
            v-overlay-scrollbars
            class="itemPickerList"
            role="none"
          >
            <ul
              ref="itemPickerContentRef"
              class="itemPickerContent"
              role="none"
            >
              <li
                v-for="item in availableItems"
                :key="item.id"
                role="none"
              >
                <button
                  type="button"
                  class="itemPickerOption"
                  role="menuitem"
                  @click="addItem(item.id)"
                >
                  <FtIcon
                    class="itemPickerIcon"
                    :icon="item.icon"
                    aria-hidden="true"
                  />
                  <bdi>{{ item.label }}</bdi>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <FtButton
        :label="t('KeyboardShortcutPrompt.Reset to Defaults')"
        :icon="['fas', 'undo']"
        :disabled="isDefaultNavigation"
        theme="secondary"
        @click="resetItems"
      />
    </div>

    <ul
      v-if="selectedItems.length > 0"
      class="selectedItems"
    >
      <li
        v-for="(item, index) in selectedItems"
        :key="item.id"
        class="selectedItem"
        :data-navigation-item-id="item.id"
        :class="{ dragging: draggedItemId === item.id }"
        :style="rowStyle(item.id)"
      >
        <span
          class="dragHandle"
          aria-hidden="true"
          @dragstart.prevent
          @pointerdown="startPointerDrag($event, item.id)"
          @pointermove="movePointerDrag"
          @pointerup="endPointerDrag"
          @pointercancel="cancelPointerDrag"
          @lostpointercapture="cancelPointerDrag"
        >
          <FtIcon :icon="['fas', 'grip']" />
        </span>
        <FtIcon
          class="selectedItemIcon"
          :icon="item.icon"
          aria-hidden="true"
        />
        <span>{{ item.label }}</span>
        <div class="itemActions">
          <FtIconButton
            class="itemAction"
            :title="t('Home Page.Move section up', { section: item.label })"
            :disabled="index === 0"
            :icon="['fas', 'arrow-up']"
            :use-shadow="false"
            theme="base"
            @click="moveItem(item.id, -1)"
          />
          <FtIconButton
            class="itemAction"
            :title="t('Home Page.Move section down', { section: item.label })"
            :disabled="index === selectedItems.length - 1"
            :icon="['fas', 'arrow-down']"
            :use-shadow="false"
            theme="base"
            @click="moveItem(item.id, 1)"
          />
          <FtIconButton
            class="itemAction"
            :title="`${t('Search Bar.Remove')} ${item.label}`"
            :icon="['fas', 'xmark']"
            :use-shadow="false"
            theme="base"
            @click="removeItem(item.id)"
          />
        </div>
      </li>
    </ul>
    <p
      class="reorderStatus"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ reorderStatus }}
    </p>
    <div
      ref="fixedNavigationOptionsRef"
      class="fixedNavigationOptions"
    >
      <FtToggleSwitch
        :label="t('Settings.General Settings.Navigation.Always Show Navigation Bar')"
        :compact="true"
        :default-value="alwaysShowNavigationBar"
        setting-key="alwaysShowNavigationBar"
        @change="store.dispatch('updateAlwaysShowNavigationBar', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Navigation.Compact Tab Labels')"
        :compact="true"
        :default-value="compactNavigationLabels"
        setting-key="compactNavigationLabels"
        @change="store.dispatch('updateCompactNavigationLabels', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Navigation.Show Active Subscriptions')"
        :compact="true"
        :default-value="!hideActiveSubscriptions"
        @change="store.dispatch('updateHideActiveSubscriptions', !$event)"
      />
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FtButton from '../FtButton/FtButton.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useOrderedItemReorder } from '../../composables/useOrderedItemReorder'
import { moveItemByVisibleOffset } from '../../../orderedItems'
import {
  DEFAULT_NAVIGATION_ITEMS,
  NAVIGATION_ITEM_DEFINITIONS,
} from '../../../navigationItems'

const { locale, t } = useI18n()
const route = useRoute()
const router = useRouter()
const open = ref(false)
const itemPickerOpen = ref(false)
const reorderStatus = ref('')
const itemPickerId = `navigation-item-picker-${useId().replaceAll(':', '')}`
const itemPickerAnchorRef = useTemplateRef('itemPickerAnchorRef')
const itemPickerListRef = useTemplateRef('itemPickerListRef')
const itemPickerContentRef = useTemplateRef('itemPickerContentRef')
const fixedNavigationOptionsRef = useTemplateRef('fixedNavigationOptionsRef')
let itemPickerResizeObserver = null
let navigationResizeObserver = null

const catalog = computed(() => NAVIGATION_ITEM_DEFINITIONS
  .filter(item => !item.requiresLocalApi || process.env.SUPPORTS_LOCAL_API)
  .map(item => ({
    ...item,
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(item.labelKey),
  })))
const catalogById = computed(() => new Map(catalog.value.map(item => [item.id, item])))
const navigationItems = computed(() => store.getters.getNavigationItems)
const hideActiveSubscriptions = computed(() => store.getters.getHideActiveSubscriptions)
const alwaysShowNavigationBar = computed(() => store.getters.getAlwaysShowNavigationBar)
const compactNavigationLabels = computed(() => store.getters.getCompactNavigationLabels)
const isDefaultNavigation = computed(() => (
  navigationItems.value.length === DEFAULT_NAVIGATION_ITEMS.length &&
  navigationItems.value.every((id, index) => id === DEFAULT_NAVIGATION_ITEMS[index])
))
const selectedItems = computed(() => navigationItems.value
  .map(id => catalogById.value.get(id))
  .filter(item => item != null))
const availableItems = computed(() => catalog.value
  .filter(item => !navigationItems.value.includes(item.id))
  .toSorted((left, right) => left.label.localeCompare(right.label, locale.value)))

function close() {
  open.value = false
  closeItemPicker()
  stopDragging()
}

async function toggleItemPicker() {
  if (itemPickerOpen.value) {
    closeItemPicker()
    return
  }

  itemPickerOpen.value = true
  await nextTick()
  itemPickerListRef.value?.querySelector('.itemPickerOption')?.focus()
}

function closeItemPicker(restoreFocus = false) {
  itemPickerOpen.value = false
  if (restoreFocus) {
    nextTick(() => itemPickerAnchorRef.value?.querySelector('button')?.focus())
  }
}

function focusAdjacentPickerItem(event, offset) {
  const options = Array.from(itemPickerListRef.value?.querySelectorAll('.itemPickerOption') ?? [])
  const currentIndex = options.indexOf(event.target.closest('.itemPickerOption'))
  if (currentIndex === -1 || options.length === 0) return

  options[(currentIndex + offset + options.length) % options.length].focus()
}

function closeItemPickerFromOutside(event) {
  if (!itemPickerOpen.value || itemPickerAnchorRef.value?.contains(event.target)) return
  closeItemPicker()
}

function clampItemPickerScroll() {
  if (itemPickerListRef.value !== null && itemPickerContentRef.value !== null) {
    clampOverlayScrollTop(itemPickerListRef.value, itemPickerContentRef.value)
  }
}

function stopObservingItemPicker() {
  itemPickerResizeObserver?.disconnect()
  itemPickerResizeObserver = null
}

function clampNavigationScroll() {
  const content = fixedNavigationOptionsRef.value?.parentElement
  const scroller = content?.closest('.settingsSubpageScroll')
  if (scroller) clampOverlayScrollTop(scroller, content)
}

watch(fixedNavigationOptionsRef, (options) => {
  navigationResizeObserver?.disconnect()
  navigationResizeObserver = null
  if (!options) return

  navigationResizeObserver = new ResizeObserver(clampNavigationScroll)
  navigationResizeObserver.observe(options.parentElement)
  navigationResizeObserver.observe(options.closest('.settingsSubpageScroll'))
  clampNavigationScroll()
})

watch(itemPickerOpen, async (isOpen) => {
  stopObservingItemPicker()
  if (!isOpen) return

  await nextTick()
  if (itemPickerListRef.value === null || itemPickerContentRef.value === null) return

  itemPickerResizeObserver = new ResizeObserver(clampItemPickerScroll)
  itemPickerResizeObserver.observe(itemPickerListRef.value)
  itemPickerResizeObserver.observe(itemPickerContentRef.value)
  clampItemPickerScroll()
})

onMounted(() => document.addEventListener('pointerdown', closeItemPickerFromOutside))
onBeforeUnmount(() => {
  stopObservingItemPicker()
  navigationResizeObserver?.disconnect()
  document.removeEventListener('pointerdown', closeItemPickerFromOutside)
})

async function updateItems(items) {
  await store.dispatch('updateNavigationItems', items)

  if (store.getters.getNavigationItems.includes('home')) return
  if (process.env.IS_ELECTRON) {
    await store.dispatch('redirectHomeTabsToLandingPage')
  } else if (route.path === '/home') {
    await router.replace({ path: `/${store.getters.getLandingPage}` })
  }
}

async function addItem(itemId) {
  if (!availableItems.value.some(item => item.id === itemId)) return

  await updateItems([...navigationItems.value, itemId])
  await nextTick()
  clampItemPickerScroll()
  const nextOption = itemPickerListRef.value?.querySelector('.itemPickerOption')
  if (nextOption) {
    nextOption.focus()
  } else {
    closeItemPicker(true)
  }
}

function removeItem(itemId) {
  return updateItems(navigationItems.value.filter(id => id !== itemId))
}

function announceItemMoved(itemId, position) {
  const item = catalogById.value.get(itemId)
  reorderStatus.value = t('Home Page.Section moved', {
    section: item?.label ?? itemId,
    position: position + 1,
    total: navigationItems.value.length,
  })
}

function moveItem(itemId, offset) {
  const visibleItems = selectedItems.value.map(item => item.id)
  const targetIndex = visibleItems.indexOf(itemId) + offset
  const reordered = moveItemByVisibleOffset(
    navigationItems.value,
    visibleItems,
    itemId,
    offset
  )
  if (reordered === navigationItems.value) return

  updateItems(reordered)
  announceItemMoved(itemId, targetIndex)
}

const {
  draggedItemId,
  rowStyle,
  stopDragging,
  startPointerDrag,
  movePointerDrag,
  endPointerDrag,
  cancelPointerDrag,
} = useOrderedItemReorder({
  items: navigationItems,
  rowSelector: '.selectedItem',
  itemIdAttribute: 'data-navigation-item-id',
  updateItems,
  announceMoved: announceItemMoved,
})

function resetItems() {
  return updateItems([...DEFAULT_NAVIGATION_ITEMS])
}
</script>

<style scoped>
.settingButtonWithSync {
  align-items: center;
  display: inline-flex;
}

.navigationActions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  inline-size: 100%;
  justify-content: center;
  margin-block-end: 20px;
  margin-inline: auto;
  max-inline-size: 720px;
  position: relative;
}

.itemPickerPopover {
  background: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(6px * var(--ui-roundness));
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  box-sizing: border-box;
  inline-size: min(520px, 100%);
  inset-block-start: calc(100% + 8px);
  inset-inline-start: 50%;
  padding: 12px;
  position: absolute;
  translate: -50% 0;
  z-index: 20;
}

.itemPickerList {
  max-block-size: min(50vh, 20rem);
  overflow-y: auto;
}

.itemPickerContent {
  list-style: none;
  margin: 0;
  padding: 0;
}

.itemPickerOption {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: calc(4px * var(--ui-roundness));
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 10px;
  inline-size: 100%;
  min-block-size: 44px;
  padding-block: 8px;
  padding-inline: 12px;
  text-align: start;
  user-select: none;
}

.itemPickerOption:hover,
.itemPickerOption:focus-visible {
  background: var(--dropdown-item-hover-color);
  color: var(--dropdown-item-hover-text-color);
}

.itemPickerIcon {
  block-size: 16px;
  flex: 0 0 16px;
  inline-size: 16px;
  opacity: 0.6;
}

.selectedItems {
  display: grid;
  gap: 8px;
  inline-size: 100%;
  list-style: none;
  margin-block: 0;
  margin-inline: auto;
  max-inline-size: 720px;
  padding: 0;
}

.selectedItem,
.fixedNavigationOptions {
  align-items: center;
  background: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(6px * var(--ui-roundness));
  min-block-size: 56px;
  user-select: none;
}

.selectedItem {
  display: grid;
  grid-template-columns: 44px 24px minmax(0, 1fr) auto;
  position: relative;
}

.fixedNavigationOptions {
  align-items: stretch;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  inline-size: 100%;
  margin-block-end: 20px;
  margin-block-start: 8px;
  margin-inline: auto;
  max-inline-size: 720px;
  padding-block: 8px;
  padding-inline: 12px;
}

.dragHandle {
  touch-action: none;
  align-items: center;
  align-self: stretch;
  color: var(--secondary-text-color);
  cursor: grab;
  display: flex;
  inline-size: 44px;
  justify-content: center;
}

.dragHandle:active {
  cursor: grabbing;
}

.selectedItemIcon {
  align-items: center;
  block-size: 20px;
  color: var(--secondary-text-color);
  display: flex;
  inline-size: 20px;
  justify-content: center;
}

.itemActions {
  align-items: center;
  align-self: stretch;
  display: flex;
}

.reorderStatus {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

</style>
