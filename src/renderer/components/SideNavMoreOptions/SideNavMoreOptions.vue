<template>
  <div
    class="sideNavMoreOptions"
  >
    <div
      class="navOption moreOptionNav mobileNavItem"
      :class="{ 'router-link-active': overflowRouteActive }"
      tabindex="0"
      role="button"
      :aria-label="$t('More')"
      :aria-expanded="openMoreOptions"
      :title="$t('More')"
      @click="openMoreOptions = !openMoreOptions"
      @keydown.enter.space.prevent="openMoreOptions = !openMoreOptions"
    >
      <FtIcon
        :icon="['fas', 'ellipsis-h']"
        class="navIcon"
        :class="applyNavIconExpand"
      />
      <NavLabel
        v-if="!hideLabelsSideBar"
        id="moreNavLabel"
        :label="$t('More')"
        :short-label="$t('Mobile Navigation.more')"
      />
    </div>
    <Teleport to="body">
      <Transition
        :css="false"
        @enter="enter"
        @leave="leave"
        @after-leave="releaseMenu"
      >
        <div
          v-if="openMoreOptions"
          class="moreOptionBackdrop"
          @click.self="closeMenu"
          @keydown.esc.prevent.stop="closeMenu"
        >
          <div
            ref="sheetRef"
            class="moreOptionContainer"
            data-bottom-sheet
            role="dialog"
            aria-modal="true"
            :aria-label="$t('More')"
            tabindex="-1"
            @pointerdown="startDrag"
            @touchmove="moveTouch"
            @scroll.capture="updateScrollAction"
            @click.capture="filterClick"
            @keydown.esc.prevent.stop="closeMenu"
            @keydown.tab.prevent="moveFocus"
          >
            <div
              class="bottomSheetHandle"
              aria-hidden="true"
            />
            <!-- Inside the dialog, as screen readers ignore what it covers. A
              plain live region, as pages own the status role. -->
            <p
              class="pinReorderStatus"
              aria-live="polite"
              aria-atomic="true"
            >
              {{ reorderStatus }}
            </p>
            <div
              ref="scrollRef"
              v-overlay-scrollbars
              class="moreOptionScroll"
            >
              <div
                ref="contentRef"
                class="moreOptionContent"
              >
                <router-link
                  v-for="item in items"
                  :key="item.id"
                  class="navOption"
                  :title="item.label"
                  :to="`/${item.id}`"
                  @click="closeMenu"
                  @pointerdown="item.id === 'subscriptions' && startSubscriptionsHold($event)"
                >
                  <FtIcon
                    :icon="item.icon"
                    class="navIcon"
                    aria-hidden="true"
                  />
                  <span class="navLabel">{{ item.label }}</span>
                </router-link>
                <template v-if="pinnedItems.length > 0">
                  <hr
                    v-if="items.length > 0"
                    class="moreOptionDivider"
                  >
                  <!-- Each group reorders on its own, by its rows' grips. -->
                  <div
                    v-for="group in pinnedGroups"
                    :key="group.id"
                    class="pinnedGroup"
                    @pointerdown.capture="startPinDrag"
                  >
                    <div
                      v-for="item in group.items"
                      :key="item.key"
                      class="pinnedRow"
                      :data-pinned-id="item.id"
                    >
                      <component
                        :is="item.path ? 'router-link' : 'span'"
                        class="navOption"
                        :class="{ disabledNavOption: !item.path }"
                        :title="item.label"
                        :to="item.path ? { path: item.path, query: item.query } : undefined"
                        :data-tab-title="item.label"
                        @click="closeMenu"
                      >
                        <FtRetryImage
                          v-if="item.thumbnail != null"
                          :fallback-icon="item.icon"
                          class="navIcon pinnedThumbnail"
                          :class="{ playlistThumbnail: item.playlist, blur: item.blur }"
                          height="32"
                          width="32"
                          loading="lazy"
                          :src="item.thumbnail"
                          sizes="32px"
                        />
                        <FtIcon
                          v-else
                          :icon="item.icon"
                          class="navIcon"
                          aria-hidden="true"
                        />
                        <span
                          :id="`${promptId}-${item.key}`"
                          class="navLabel"
                          dir="auto"
                        >{{ item.label }}</span>
                      </component>
                      <!-- Named by the pin and its own hint, as grips are otherwise alike. -->
                      <button
                        v-if="group.items.length > 1"
                        :id="`${promptId}-${item.key}-grip`"
                        type="button"
                        class="pinnedGrip"
                        :aria-labelledby="`${promptId}-${item.key} ${promptId}-${item.key}-grip`"
                        :aria-label="$t('User Playlists.Reorder Hint')"
                        :title="$t('User Playlists.Reorder Hint')"
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        @keydown="movePinnedWithKeyboard($event, group, item.id)"
                      >
                        <FtIcon
                          :icon="['fas', 'grip']"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref, nextTick, watch, onMounted, onBeforeUnmount, useId, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import store from '../../store/index'
import FtRetryImage from '../FtRetryImage.vue'
import NavLabel from '../SideNav/NavLabel.vue'
import { useBottomSheetDismiss } from '../../composables/useBottomSheetDismiss'
import { useGridReorder } from '../../composables/useGridReorder'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { usePointerHold } from '../../composables/usePointerHold'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  pinnedItems: {
    type: Array,
    default: () => [],
  },
  reorderStatus: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['move-pinned', 'refresh-subscriptions'])

const openMoreOptions = ref(false)
const mobileLayout = usePhoneLayout('(max-width: 680px)')
watch(mobileLayout, (isMobile) => {
  if (!isMobile) closeMenu()
})
const route = useRoute()

// Like in the bottom bar, holding Subscriptions refreshes it in the background.
const { onPointerDown: startSubscriptionsHold } = usePointerHold(() => {
  closeMenu()
  emit('refresh-subscriptions')
})

const promptId = useId()
const sheetRef = useTemplateRef('sheetRef')
const { startDrag, moveTouch, updateScrollAction, filterClick, enter, leave } = useBottomSheetDismiss(sheetRef, closeMenu)
const scrollRef = useTemplateRef('scrollRef')
const contentRef = useTemplateRef('contentRef')
watch(contentRef, (content, _, onCleanup) => {
  if (!content) return
  const scroller = scrollRef.value
  const observer = new ResizeObserver(() => clampOverlayScrollTop(scroller, content))
  observer.observe(content)
  observer.observe(scroller)
  onCleanup(() => observer.disconnect())
})
let locked = false
let previousFocus = null
watch(openMoreOptions, async (open) => {
  if (!open) return
  if (!locked) {
    previousFocus = document.activeElement
    lockBodyScroll()
    store.commit('addOpenPrompt', promptId)
    locked = true
  }
  await nextTick()
  sheetRef.value?.focus({ preventScroll: true })
})
function releaseMenu() {
  if (openMoreOptions.value || !locked) return
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  locked = false
  nextTick(() => previousFocus?.focus({ preventScroll: true }))
}
const overflowRouteActive = computed(() => props.items.some(item => route.path === `/${item.id}`) ||
  props.pinnedItems.some(({ path }) => path != null && (route.path === path || route.path.startsWith(`${path}/`))))

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => {
  return store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideLabelsSideBar.value
  }
})

// Pinned playlists and channels reorder separately, like in the side navigation.
const pinnedGroups = computed(() => ['playlist', 'channel']
  .map(id => ({ id, items: props.pinnedItems.filter(item => item.group === id) }))
  .filter(group => group.items.length > 0))

const { onPointerDown: startPinDrag } = useGridReorder({
  itemSelector: '.pinnedRow',
  handleSelector: '.pinnedGrip',
  getId: item => item.dataset.pinnedId,
  commit: (id, order) => {
    // Another window can unpin the item while it settles.
    const group = pinnedGroups.value.find(group => group.items.some(item => item.id === id))
    if (group) emit('move-pinned', group.id, id, order)
  },
})

/**
 * @param {KeyboardEvent} event
 * @param {{ id: string, items: { id: string }[] }} group
 * @param {string} id
 */
async function movePinnedWithKeyboard(event, group, id) {
  const offset = { ArrowUp: -1, ArrowDown: 1 }[event.key]
  if (!offset || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  event.preventDefault()
  const order = group.items.map(item => item.id)
  const index = order.indexOf(id)
  if (index + offset < 0 || index + offset >= order.length) return
  order.splice(index, 1)
  order.splice(index + offset, 0, id)
  const grip = /** @type {HTMLElement} */ (event.currentTarget)
  emit('move-pinned', group.id, id, order)
  // Moving the row in the document drops its focus.
  await nextTick()
  if (grip.isConnected && document.activeElement !== grip) grip.focus()
}

function moveFocus(event) {
  if (!openMoreOptions.value || !sheetRef.value) return
  const links = [...sheetRef.value.querySelectorAll('a[href], .pinnedGrip')]
  const index = links.indexOf(document.activeElement)
  const next = event.shiftKey ? (index <= 0 ? links.length - 1 : index - 1) : (index + 1) % links.length
  links[next]?.focus()
}

function closeMenu() {
  openMoreOptions.value = false
}

const router = useRouter()
let removeNavigationHook = null

onMounted(() => {
  removeNavigationHook = router.afterEach(closeMenu)
})
onBeforeUnmount(() => {
  openMoreOptions.value = false
  releaseMenu()
  removeNavigationHook?.()
  removeNavigationHook = null
})
</script>

<style scoped src="./SideNavMoreOptions.css" />
