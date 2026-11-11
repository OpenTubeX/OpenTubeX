<template>
  <div
    ref="rootRef"
    class="controlPlacementCustomizer"
  >
    <div class="placementControls">
      <FtButton
        :label="t('KeyboardShortcutPrompt.Reset to Defaults')"
        :icon="['fas', 'undo']"
        :disabled="isDefault"
        theme="secondary"
        @click="resetPlacement"
      />
    </div>

    <section
      v-for="section in sections"
      :key="section.id"
      class="placementSection"
      :data-placement-section="section.id"
    >
      <h3>{{ section.label }}</h3>
      <div
        v-if="section.lists.some(list => list.items.length > 0)"
        class="placementLists"
      >
        <!-- The chapters button stays next to the time, so it keeps its place on the control bar. -->
        <ul
          v-for="list in section.lists.filter(list => list.items.length > 0)"
          :key="list.id"
          class="placementList"
        >
          <li
            v-for="(item, index) in list.items"
            :key="item.id"
            class="placementItem"
            v-bind="{ [section.idAttribute]: item.id }"
            :class="{ dragging: list.reorder?.draggedItemId.value === item.id, unordered: !list.reorder }"
            :style="list.reorder?.rowStyle(item.id)"
          >
            <span
              v-if="list.reorder"
              class="dragHandle"
              aria-hidden="true"
              @dragstart.prevent
              @pointerdown="list.reorder.startPointerDrag($event, item.id)"
              @pointermove="list.reorder.movePointerDrag"
              @pointerup="list.reorder.endPointerDrag"
              @pointercancel="list.reorder.cancelPointerDrag"
              @lostpointercapture="list.reorder.cancelPointerDrag"
            >
              <FtIcon :icon="['fas', 'grip']" />
            </span>
            <FtIcon
              class="placementIcon"
              :icon="item.icon"
              aria-hidden="true"
            />
            <span>{{ item.label }}</span>
            <div class="itemActions">
              <template v-if="list.reorder">
                <FtIconButton
                  :title="t('Home Page.Move section up', { section: item.label })"
                  :disabled="index === 0"
                  :icon="['fas', 'arrow-up']"
                  theme="base-no-default"
                  @click="moveWithinSection(section, list, item.id, -1)"
                />
                <FtIconButton
                  :title="t('Home Page.Move section down', { section: item.label })"
                  :disabled="index === list.items.length - 1"
                  :icon="['fas', 'arrow-down']"
                  theme="base-no-default"
                  @click="moveWithinSection(section, list, item.id, 1)"
                />
              </template>
              <FtIconButton
                v-if="item.higher"
                :title="higherTitle(item)"
                :icon="['fas', 'plus']"
                theme="base-no-default"
                data-placement-action="higher"
                @click="place(item, item.higher)"
              />
              <FtIconButton
                v-if="item.lower"
                :title="lowerTitle(item)"
                :icon="['fas', item.lower === 'hidden' ? 'eye-slash' : 'minus']"
                theme="base-no-default"
                data-placement-action="lower"
                @click="place(item, item.lower)"
              />
            </div>
          </li>
        </ul>
      </div>
      <p
        v-else
        class="emptyState"
      >
        {{ t('Settings.Control Bar.Empty') }}
      </p>
    </section>

    <p
      class="reorderStatus"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ reorderStatus }}
    </p>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../../FtButton/FtButton.vue'
import FtIconButton from '../../../FtIconButton/FtIconButton.vue'

import store from '../../../../store/index'
import { DEFAULT_SETTINGS } from '../../../../store/modules/settings'
import { getControlBarButtonDefinitions } from '../../../../helpers/controlBarButtons'
import { getPlayerMenuControlDefinitions, normalizeHiddenPlayerMenuControls } from '../../../../helpers/playerMenuControls'
import { clampOverlayScrollTop } from '../../../../helpers/overlayScrollbars'
import { useOrderedItemReorder } from '../../../../composables/useOrderedItemReorder'
import { moveItemByVisibleOffset } from '../../../../../orderedItems'

const { t } = useI18n()

const barDefinitions = new Map(getControlBarButtonDefinitions().map(control => [control.id, control]))
const menuDefinitions = new Map(getPlayerMenuControlDefinitions().map(control => [control.id, control]))
const placementKeys = ['controlBarButtons', 'playerMenuControls', 'hiddenPlayerMenuControls']

const barButtons = computed(() => store.getters.getControlBarButtons)
const menuOrder = computed(() => store.getters.getPlayerMenuControls)
// The getter leaves out controls on the control bar, but they keep their saved
// state, which decides where they go when they leave the control bar.
const hiddenControls = computed(() => normalizeHiddenPlayerMenuControls(store.state.settings.hiddenPlayerMenuControls))

/** @param {string} id */
function isShownInMenu(id) {
  return !hiddenControls.value.includes(id)
}

/**
 * Each control moves one section up or down, skipping the sections it has no
 * place in: the fullscreen button has no menu entry, and most menu controls
 * have no control bar button.
 * @param {string} id
 * @param {'bar' | 'menu' | 'hidden'} placement
 */
function createItem(id, placement) {
  const { labelKey, icon, required } = barDefinitions.get(id) ?? menuDefinitions.get(id)
  const places = ['bar', 'menu', 'hidden'].filter(place => (
    place === placement ||
    (place === 'bar' && barDefinitions.has(id)) ||
    (place === 'menu' && menuDefinitions.has(id)) ||
    (place === 'hidden' && !required)
  ))
  const index = places.indexOf(placement)
  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  return { id, icon, label: t(labelKey), higher: places[index - 1], lower: places[index + 1] }
}

/**
 * The editor only places controls. Controls of features that are turned off
 * in the player settings have nothing to place, so they are left out.
 * @param {string} id
 */
function isAvailable(id) {
  const definition = menuDefinitions.get(id)
  if (definition?.settingKey) return store.state.settings[definition.settingKey] !== !!definition.inverted
  return id !== 'voiceOverTranslation' || store.getters.getUseVoiceOverTranslation
}

/** @param {string} id */
function isOnBar(id) {
  return barButtons.value.includes(id) && isAvailable(id)
}

/** @param {string} id */
function isInMenu(id) {
  return menuDefinitions.has(id) && isAvailable(id) && !barButtons.value.includes(id)
}

const menuControls = computed(() => menuOrder.value.filter(id => isInMenu(id) && isShownInMenu(id)))

const reorderStatus = ref('')

/** @param {'bar' | 'menu'} sectionId */
function announcer(sectionId) {
  return (id, position) => {
    const { items } = sections.value.find(({ id: candidate }) => candidate === sectionId).lists.find(list => list.reorder)
    reorderStatus.value = t('Home Page.Section moved', {
      section: items.find(item => item.id === id)?.label ?? id,
      position: position + 1,
      total: items.length,
    })
  }
}

function moveWithinSection(section, list, id, offset) {
  const visible = list.items.map(item => item.id)
  const reordered = moveItemByVisibleOffset(section.order, visible, id, offset)
  if (reordered === section.order) return
  section.update(reordered)
  announcer(section.id)(id, visible.indexOf(id) + offset)
}

const barReorder = useOrderedItemReorder({
  items: barButtons,
  rowSelector: '.placementItem',
  itemIdAttribute: 'data-control-bar-button-id',
  updateItems: items => store.dispatch('updateControlBarButtons', items),
  announceMoved: announcer('bar'),
})

const menuReorder = useOrderedItemReorder({
  items: menuOrder,
  rowSelector: '.placementItem',
  itemIdAttribute: 'data-player-menu-control-id',
  updateItems: items => store.dispatch('updatePlayerMenuControls', items),
  announceMoved: announcer('menu'),
})

const sections = computed(() => {
  const barItems = barButtons.value.filter(isOnBar).map(id => createItem(id, 'bar'))
  return [
    {
      id: 'bar',
      label: t('Settings.Control Bar.Title'),
      idAttribute: 'data-control-bar-button-id',
      lists: [
        // The chapters button stays next to the time, so it has no order.
        { id: 'fixed', items: barItems.filter(item => item.id === 'chapters'), reorder: null },
        { id: 'ordered', items: barItems.filter(item => item.id !== 'chapters'), reorder: barReorder },
      ],
      order: barButtons.value,
      update: items => store.dispatch('updateControlBarButtons', items),
    },
    {
      id: 'menu',
      label: t('Settings.Interface Customizer.Player Menu'),
      idAttribute: 'data-player-menu-control-id',
      lists: [{ id: 'ordered', items: menuControls.value.map(id => createItem(id, 'menu')), reorder: menuReorder }],
      order: menuOrder.value,
      update: items => store.dispatch('updatePlayerMenuControls', items),
    },
    {
      id: 'hidden',
      label: t('Settings.Control Bar.Hidden'),
      idAttribute: 'data-hidden-control-id',
      lists: [{
        id: 'unordered',
        items: [
          ...menuOrder.value.filter(id => isInMenu(id) && !isShownInMenu(id)),
          ...[...barDefinitions.keys()].filter(id => !menuDefinitions.has(id) && !barButtons.value.includes(id)),
        ].map(id => createItem(id, 'hidden')),
        reorder: null,
      }],
    },
  ]
})

/**
 * @param {string} id
 * @param {boolean} shown
 */
function setShownInMenu(id, shown) {
  const hidden = hiddenControls.value.filter(hiddenId => hiddenId !== id)
  return store.dispatch('updateHiddenPlayerMenuControls', shown ? hidden : [...hidden, id])
}

/**
 * @param {{ id: string }} item
 * @param {'bar' | 'menu' | 'hidden'} placement
 */
async function place({ id }, placement) {
  const onBar = barButtons.value.includes(id)
  if (placement === 'bar') {
    await store.dispatch('updateControlBarButtons', [...barButtons.value, id])
  } else if (onBar) {
    await store.dispatch('updateControlBarButtons', barButtons.value.filter(barId => barId !== id))
  }
  // A control leaving the control bar returns to the menu.
  const shown = placement !== 'hidden'
  if (menuDefinitions.has(id) && isShownInMenu(id) !== shown) await setShownInMenu(id, shown)
}

function lowerTitle(item) {
  return item.lower === 'menu'
    ? t('Settings.Control Bar.Move to Player Menu', { control: item.label })
    : t('Settings.Control Bar.Hide', { control: item.label })
}

function higherTitle(item) {
  return item.higher === 'bar'
    ? t('Settings.Control Bar.Move to Control Bar', { control: item.label })
    : t('Settings.Control Bar.Move to Player Menu', { control: item.label })
}

const isDefault = computed(() => placementKeys.every(key => (
  JSON.stringify(store.state.settings[key]) === JSON.stringify(DEFAULT_SETTINGS[key])
)))

async function resetPlacement() {
  for (const key of placementKeys) {
    await store.dispatch('resetSettingToDefault', key)
  }
}

// Moving controls out of the last section can shorten the editor.
const rootRef = useTemplateRef('rootRef')
let resizeObserver = null
watch(rootRef, (root) => {
  resizeObserver?.disconnect()
  const scroller = root?.closest('.customizerEditorScroll')
  if (!scroller) return
  resizeObserver = new ResizeObserver(() => clampOverlayScrollTop(scroller, root))
  resizeObserver.observe(root)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.controlPlacementCustomizer {
  display: flex;
  flex-direction: column;
  gap: 20px;
  inline-size: 100%;
  margin-inline: auto;
  max-inline-size: 720px;
}

.placementControls {
  display: flex;
  justify-content: center;
}

.placementSection h3 {
  color: var(--secondary-text-color);
  font-size: 14px;
  font-weight: 600;
  margin-block: 0 8px;
  text-transform: uppercase;
}

/* Each section's rows form one segmented group: large outer corners, tight
   inner ones. A dragged row lifts out of the group with fully rounded corners. */
.placementLists,
.placementList {
  display: grid;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.placementItem {
  --reorder-row-color: color-mix(in srgb, var(--primary-text-color) 6%, var(--card-bg-color));
  --icon-button-hover-color: color-mix(in srgb, var(--primary-text-color) 12%, transparent);

  align-items: center;
  background: var(--reorder-row-color);
  border-radius: var(--shape-corner-extra-small);
  display: grid;
  grid-template-columns: 44px 24px minmax(0, 1fr) auto;
  min-block-size: 56px;
  padding-inline-end: 8px;
  position: relative;
  transition: border-radius var(--motion-fast-spatial);
  user-select: none;
}

.placementList:first-child > .placementItem:first-child {
  border-start-start-radius: var(--shape-corner-large-increased);
  border-start-end-radius: var(--shape-corner-large-increased);
}

.placementList:last-child > .placementItem:last-child {
  border-end-start-radius: var(--shape-corner-large-increased);
  border-end-end-radius: var(--shape-corner-large-increased);
}

.placementItem.dragging {
  border-radius: var(--shape-corner-large-increased);
}

.placementItem.unordered {
  grid-template-columns: 24px minmax(0, 1fr) auto;
  padding-inline-start: 16px;
}

.dragHandle {
  align-items: center;
  align-self: stretch;
  color: var(--secondary-text-color);
  cursor: grab;
  display: flex;
  justify-content: center;
  touch-action: none;
}

.dragHandle:active {
  cursor: grabbing;
}

.placementIcon {
  block-size: 20px;
  color: var(--secondary-text-color);
  inline-size: 20px;
}

.itemActions {
  align-items: center;
  align-self: stretch;
  display: flex;
}

.emptyState {
  color: var(--secondary-text-color);
  margin-block: 8px;
  text-align: center;
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
