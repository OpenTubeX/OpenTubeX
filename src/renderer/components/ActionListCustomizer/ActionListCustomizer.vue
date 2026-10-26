<template>
  <div
    ref="actionListRef"
    class="actionListControls"
  >
    <div
      ref="itemPickerAnchorRef"
      class="itemPickerAnchor"
    >
      <FtButton
        :label="addLabel"
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
        :aria-label="addLabel"
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
      :disabled="isDefaultItems"
      theme="secondary"
      @click="resetItems"
    />
  </div>

  <ul
    v-if="selectedItems.length > 0"
    class="selectedActions"
  >
    <li
      v-for="(item, index) in selectedItems"
      :key="item.id"
      class="selectedAction"
      v-bind="{ [itemIdAttribute]: item.id }"
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
        class="selectedActionIcon"
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
          theme="base-no-default"
          @click="moveItem(item.id, -1)"
        />
        <FtIconButton
          class="itemAction"
          :title="t('Home Page.Move section down', { section: item.label })"
          :disabled="index === selectedItems.length - 1"
          :icon="['fas', 'arrow-down']"
          theme="base-no-default"
          @click="moveItem(item.id, 1)"
        />
        <FtIconButton
          class="itemAction"
          :title="`${t('Search Bar.Remove')} ${item.label}`"
          :disabled="item.required"
          :icon="['fas', 'xmark']"
          theme="base-no-default"
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
  <p
    v-if="selectedItems.length === 0"
    class="emptyState"
  >
    {{ emptyLabel }}
  </p>
</template>

<script setup>
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'

import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { listenForOutsidePress } from '../../helpers/outsidePress'
import { useOrderedItemReorder } from '../../composables/useOrderedItemReorder'
import { useSettingsOverlay } from '../../composables/useSettingsOverlay'
import { moveItemByVisibleOffset } from '../../../orderedItems'

const props = defineProps({
  /** Every item that can be selected: `{ id, labelKey, icon, required? }`. Required items cannot be removed. */
  definitions: {
    type: Array,
    required: true
  },
  /** The selected item IDs in their current order. */
  items: {
    type: Array,
    required: true
  },
  defaultItems: {
    type: Array,
    required: true
  },
  /** Saves the new selection and resolves to whether that succeeded. */
  updateItems: {
    type: Function,
    required: true
  },
  /** The data attribute that identifies each row, e.g. `data-fullscreen-action-id`. */
  itemIdAttribute: {
    type: String,
    required: true
  },
  addLabel: {
    type: String,
    required: true
  },
  emptyLabel: {
    type: String,
    default: ''
  }
})

const { locale, t } = useI18n()
const itemPickerOpen = ref(false)
const reorderStatus = ref('')
const itemPickerId = `action-picker-${useId().replaceAll(':', '')}`
const itemPickerAnchorRef = useTemplateRef('itemPickerAnchorRef')
const itemPickerListRef = useTemplateRef('itemPickerListRef')
const itemPickerContentRef = useTemplateRef('itemPickerContentRef')
const actionListRef = useTemplateRef('actionListRef')
let itemPickerResizeObserver = null
let actionResizeObserver = null
const settingsOverlayActive = useSettingsOverlay(closeItemPicker)

const catalog = computed(() => props.definitions
  .map(item => ({
    ...item,
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(item.labelKey),
  })))
const catalogById = computed(() => new Map(catalog.value.map(item => [item.id, item])))
const items = computed(() => props.items)
const isDefaultItems = computed(() => (
  items.value.length === props.defaultItems.length &&
  items.value.every((id, index) => id === props.defaultItems[index])
))
const selectedItems = computed(() => items.value
  .map(id => catalogById.value.get(id))
  .filter(item => item != null))
const availableItems = computed(() => catalog.value
  .filter(item => !items.value.includes(item.id))
  .toSorted((left, right) => left.label.localeCompare(right.label, locale.value)))

async function toggleItemPicker() {
  if (!settingsOverlayActive.value) return
  if (itemPickerOpen.value) {
    closeItemPicker()
    return
  }

  itemPickerOpen.value = true
  await nextTick()
  if (!settingsOverlayActive.value || !itemPickerOpen.value) return
  itemPickerListRef.value?.querySelector('.itemPickerOption')?.focus()
}

function closeItemPicker(restoreFocus = false) {
  itemPickerOpen.value = false
  if (restoreFocus) {
    nextTick(() => {
      if (settingsOverlayActive.value) itemPickerAnchorRef.value?.querySelector('button')?.focus()
    })
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

function clampActionScroll() {
  const content = actionListRef.value?.parentElement
  const scroller = content?.closest('.customizerEditorScroll')
  if (scroller) clampOverlayScrollTop(scroller, content)
}

watch(actionListRef, (options) => {
  actionResizeObserver?.disconnect()
  actionResizeObserver = null
  if (!options) return

  actionResizeObserver = new ResizeObserver(clampActionScroll)
  actionResizeObserver.observe(options.parentElement)
  actionResizeObserver.observe(options.closest('.customizerEditorScroll'))
  clampActionScroll()
})

watch(itemPickerOpen, async (isOpen) => {
  stopObservingItemPicker()
  if (!isOpen) return

  await nextTick()
  if (!settingsOverlayActive.value || !itemPickerOpen.value || itemPickerListRef.value === null || itemPickerContentRef.value === null) return

  itemPickerResizeObserver = new ResizeObserver(clampItemPickerScroll)
  itemPickerResizeObserver.observe(itemPickerListRef.value)
  itemPickerResizeObserver.observe(itemPickerContentRef.value)
  clampItemPickerScroll()
})

let stopOutsidePress = null
onMounted(() => { stopOutsidePress = listenForOutsidePress(closeItemPickerFromOutside) })
onBeforeUnmount(() => {
  stopObservingItemPicker()
  actionResizeObserver?.disconnect()
  stopOutsidePress?.()
})

async function addItem(itemId) {
  if (!availableItems.value.some(item => item.id === itemId)) return

  await props.updateItems([...items.value, itemId])
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
  return props.updateItems(items.value.filter(id => id !== itemId))
}

function announceItemMoved(itemId, position) {
  const item = catalogById.value.get(itemId)
  reorderStatus.value = t('Home Page.Section moved', {
    section: item?.label ?? itemId,
    position: position + 1,
    total: items.value.length,
  })
}

function moveItem(itemId, offset) {
  const visibleItems = selectedItems.value.map(item => item.id)
  const targetIndex = visibleItems.indexOf(itemId) + offset
  const reordered = moveItemByVisibleOffset(
    items.value,
    visibleItems,
    itemId,
    offset
  )
  if (reordered === items.value) return

  props.updateItems(reordered)
  announceItemMoved(itemId, targetIndex)
}

const {
  draggedItemId,
  rowStyle,
  startPointerDrag,
  movePointerDrag,
  endPointerDrag,
  cancelPointerDrag,
} = useOrderedItemReorder({
  items,
  rowSelector: '.selectedAction',
  itemIdAttribute: props.itemIdAttribute,
  updateItems: props.updateItems,
  announceMoved: announceItemMoved,
})

function resetItems() {
  return props.updateItems([...props.defaultItems])
}
</script>

<style scoped>
.actionListControls {
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

.selectedActions {
  display: grid;
  gap: 8px;
  inline-size: 100%;
  list-style: none;
  margin-block: 0;
  margin-inline: auto;
  max-inline-size: 720px;
  padding: 0;
}

.selectedAction {
  align-items: center;
  background: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(6px * var(--ui-roundness));
  min-block-size: 56px;
  user-select: none;
}

.selectedAction {
  display: grid;
  grid-template-columns: 44px 24px minmax(0, 1fr) auto;
  position: relative;
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

.selectedActionIcon {
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

.emptyState {
  color: var(--secondary-text-color);
  margin-block: 24px;
  text-align: center;
}
</style>
