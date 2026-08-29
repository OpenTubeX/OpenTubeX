<template>
  <div
    ref="shelfElement"
    class="homeShelf"
    :class="{ hasControls: layout.showControls }"
    :style="{ '--home-shelf-transition-duration': transitionDuration }"
    data-home-shelf
    data-animation-speed-managed
  >
    <FtIconButton
      v-if="layout.showControls"
      class="shelfArrow"
      :title="t('Home Page.Previous shelf page', { section: label })"
      :icon="['fas', 'angle-left']"
      :disabled="pageIndex === 0"
      :use-shadow="false"
      theme="base-no-default"
      @click="changePage(-1)"
    />

    <div class="shelfViewport">
      <Transition
        :name="slideTransitionName"
        @before-enter="showPage"
        @before-leave="hideLeavingPage"
        @leave-cancelled="showPage"
      >
        <div
          :key="pageIndex"
          class="shelfPage"
          :style="{ '--home-shelf-columns': layout.pageSize }"
          :data-home-shelf-page="pageIndex + 1"
        >
          <slot :items="pageItems" />
        </div>
      </Transition>
    </div>

    <FtIconButton
      v-if="layout.showControls"
      class="shelfArrow"
      :title="t('Home Page.Next shelf page', { section: label })"
      :icon="['fas', 'angle-right']"
      :disabled="pageIndex === pageCount - 1"
      :use-shadow="false"
      theme="base-no-default"
      @click="changePage(1)"
    />

    <p
      class="shelfStatus"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ pageAnnouncement }}
    </p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'

import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { getHomeShelfLayout } from '../../helpers/homeShelfPagination'
import store from '../../store/index'

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  itemMinWidth: {
    type: Number,
    default: 260,
  },
  itemGap: {
    type: Number,
    default: 12,
  },
})

const { t } = useI18n()
const shelfElement = useTemplateRef('shelfElement')
const shelfWidth = ref(0)
const pageIndex = ref(0)
const pageAnnouncement = ref('')
const slideDirection = ref('next')
let resizeObserver = null

const layout = computed(() => getHomeShelfLayout(
  shelfWidth.value,
  props.items.length,
  props.itemMinWidth,
  props.itemGap
))
const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / layout.value.pageSize)))
const slideTransitionName = computed(() => `shelf-${slideDirection.value}`)
const transitionDuration = computed(() => {
  return `${240 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)}ms`
})
const pageItems = computed(() => {
  const start = pageIndex.value * layout.value.pageSize
  return props.items.slice(start, start + layout.value.pageSize)
})

watch([pageCount, () => props.items], () => {
  pageIndex.value = Math.min(pageIndex.value, pageCount.value - 1)
})

function changePage(offset) {
  const targetPage = Math.min(pageCount.value - 1, Math.max(0, pageIndex.value + offset))
  if (targetPage === pageIndex.value) { return }

  slideDirection.value = offset > 0 ? 'next' : 'previous'
  pageIndex.value = targetPage
  pageAnnouncement.value = t('Home Page.Shelf page status', {
    section: props.label,
    page: pageIndex.value + 1,
    total: pageCount.value,
  })
}

function hideLeavingPage(element) {
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
}

function showPage(element) {
  element.inert = false
  element.removeAttribute('aria-hidden')
}

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    shelfWidth.value = entry.contentRect.width
  })
  resizeObserver.observe(shelfElement.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.homeShelf {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
}

.homeShelf.hasControls {
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: 8px;
}

.shelfPage {
  grid-area: 1 / 1;
  min-inline-size: 0;
}

.shelfViewport {
  display: grid;
  min-inline-size: 0;
  overflow: hidden;
}

.shelf-next-enter-active,
.shelf-next-leave-active,
.shelf-previous-enter-active,
.shelf-previous-leave-active {
  transition: transform var(--home-shelf-transition-duration) cubic-bezier(0.2, 0, 0, 1);
  will-change: transform;
}

.shelf-next-enter-from,
.shelf-previous-leave-to,
.homeShelf:dir(rtl) .shelf-next-leave-to,
.homeShelf:dir(rtl) .shelf-previous-enter-from {
  transform: translateX(100%);
}

.shelf-next-leave-to,
.shelf-previous-enter-from,
.homeShelf:dir(rtl) .shelf-next-enter-from,
.homeShelf:dir(rtl) .shelf-previous-leave-to {
  transform: translateX(-100%);
}

.homeShelf:dir(rtl) .shelfArrow :deep(.icon) {
  transform: scaleX(-1);
}

.shelfArrow :deep(.iconButton) {
  min-inline-size: 44px;
  min-block-size: 44px;
}

.shelfStatus {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .shelf-next-enter-active,
  .shelf-next-leave-active,
  .shelf-previous-enter-active,
  .shelf-previous-leave-active {
    transition: none;
  }

  .shelf-next-enter-from,
  .shelf-next-leave-to,
  .shelf-previous-enter-from,
  .shelf-previous-leave-to {
    transform: none;
  }
}
</style>
