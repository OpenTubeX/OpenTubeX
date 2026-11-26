<template>
  <Transition
    :css="false"
    @enter="enter"
    @leave="leave"
    @after-leave="finishClose"
  >
    <div
      v-if="open"
      class="capacitorTabActionsBackdrop mode-tablet"
      @pointerdown.self.stop
      @click.self.stop="emit('dismiss')"
      @contextmenu.prevent="keepSheetFocus"
      @keydown.esc.stop.prevent="emit('dismiss')"
    >
      <section
        ref="sheetRef"
        class="capacitorTabActions"
        data-bottom-sheet
        role="menu"
        :aria-label="t('Tab Organizer.Recently Closed')"
        tabindex="-1"
        @pointerdown="startDrag"
        @touchmove="moveTouch"
        @scroll.capture="updateScrollAction"
        @click.capture="filterClick"
        @keydown.esc.stop.prevent="emit('dismiss')"
      >
        <div
          class="bottomSheetHandle"
          aria-hidden="true"
        />
        <header class="capacitorTabActionHeader">
          <strong>{{ t('Tab Organizer.Recently Closed') }}</strong>
        </header>
        <div
          ref="actionList"
          v-overlay-scrollbars
          class="capacitorTabActionList"
        >
          <div
            ref="actionContent"
            class="capacitorTabActionContent"
          >
            <button
              v-for="tab in closedTabs"
              :key="tab.id"
              type="button"
              role="menuitem"
              :aria-label="`${t('Restore')}: ${tab.title || tab.route.fullPath}`"
              @click="emit('restore', tab.id)"
            >
              <FtIcon
                :icon="getTabPageIcon(tab) || ['fas', 'display']"
                aria-hidden="true"
              />
              <span
                class="closedTabTitle"
                dir="auto"
              >{{ tab.title || tab.route.fullPath }}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="dangerAction"
              @click="emit('clear')"
            >
              <FtIcon
                :icon="['fas', 'trash']"
                aria-hidden="true"
              />
              {{ t('Tab Organizer.Clear') }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBottomSheetDismiss } from '../../composables/useBottomSheetDismiss'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import store from '../../store/index'
import { getTabPageIcon } from '../../tabs/tabPageIcon'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['dismiss', 'closed', 'restore', 'clear'])
const { t } = useI18n()
const closedTabs = computed(() => store.getters.getClosedTabs)
const sheetRef = useTemplateRef('sheetRef')
const actionList = useTemplateRef('actionList')
const actionContent = useTemplateRef('actionContent')
const { startDrag, moveTouch, updateScrollAction, filterClick, enter, leave } = useBottomSheetDismiss(sheetRef, () => emit('dismiss'))
let previousFocus = null

// Android ends the long press that opened the sheet with a context menu on
// whatever is now under the finger, after moving focus out of the sheet.
// Without focus, Escape and Back could no longer reach the sheet.
function keepSheetFocus() {
  if (!sheetRef.value?.contains(document.activeElement)) sheetRef.value?.focus({ preventScroll: true })
}

function finishClose() {
  emit('closed')
  // Let the tablet parent release its inert state before focusing the opener.
  nextTick(() => {
    if (!props.open && previousFocus?.isConnected && document.activeElement === document.body) {
      previousFocus.focus({ preventScroll: true })
    }
  })
}

watch(() => props.open, async (isOpen) => {
  if (!isOpen) return
  previousFocus = document.activeElement
  await nextTick()
  if (actionList.value) restoreOverlayScrollTop(actionList.value, 0)
  sheetRef.value?.focus({ preventScroll: true })
})

watch(actionContent, (content, _previous, onCleanup) => {
  if (!content) return
  const observer = new ResizeObserver(() => {
    if (actionList.value) clampOverlayScrollTop(actionList.value, content)
  })
  observer.observe(content)
  observer.observe(actionList.value)
  onCleanup(() => observer.disconnect())
})
</script>

<style scoped src="./CapacitorTabActionsMenu.css" />

<style scoped>
.closedTabTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
