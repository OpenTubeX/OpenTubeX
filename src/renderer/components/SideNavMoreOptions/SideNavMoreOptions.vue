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
                >
                  <FtIcon
                    :icon="item.icon"
                    class="navIcon"
                    aria-hidden="true"
                  />
                  <span class="navLabel">{{ item.label }}</span>
                </router-link>
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
import NavLabel from '../SideNav/NavLabel.vue'
import { useBottomSheetDismiss } from '../../composables/useBottomSheetDismiss'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
})

const openMoreOptions = ref(false)
const route = useRoute()

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
const overflowRouteActive = computed(() => props.items.some(item => route.path === `/${item.id}`))

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => {
  return store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideLabelsSideBar.value
  }
})

function moveFocus(event) {
  const links = [...sheetRef.value.querySelectorAll('a[href]')]
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
