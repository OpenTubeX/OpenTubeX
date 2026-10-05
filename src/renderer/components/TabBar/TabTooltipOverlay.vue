<template>
  <Teleport to="body">
    <Transition name="tab-tooltip">
      <div
        v-if="active"
        :id="active.id"
        ref="tooltipRef"
        class="tabTooltip"
        :class="{ withPreview: content.showPreview, tabGroupTooltip: content.isGroup }"
        data-tab-preview-overlay
        :style="tooltipStyle"
        role="tooltip"
      >
        <div class="tabTooltipTitle">
          {{ content.title }}
        </div>
        <div
          v-if="content.isGroup"
          class="tabTooltipCount"
        >
          {{ t('Tab Organizer.Tab Count', { count: content.tabs.length }, content.tabs.length) }}
        </div>
        <div
          v-else-if="content.group"
          class="tabTooltipGroup"
          :style="{ '--tab-group-color': getTabAccentColor(content.group.color) || 'var(--secondary-text-color)' }"
        >
          <FtIcon
            :icon="['fas', content.group.icon || 'layer-group']"
            class="tabTooltipGroupIcon"
            aria-hidden="true"
          />
          {{ content.group.name }}
        </div>
        <template v-if="content.showPreview">
          <div
            v-if="content.isGroup"
            class="tabTooltipGrid"
          >
            <div
              v-for="tab in previewTabs"
              :key="tab.id"
              class="tabTooltipGridItem"
            >
              <TabTooltipPreview
                :tab="tab"
                :capture-live="active.captureLive"
                show-title
                :show-icon="content.showIcon"
              />
            </div>
          </div>
          <TabTooltipPreview
            v-else-if="content.tabs[0]"
            :tab="content.tabs[0]"
            :capture-live="active.captureLive"
          />
          <div
            v-if="content.isGroup && content.tabs.length > previewTabs.length"
            class="tabTooltipCount tabTooltipRemaining"
          >
            {{ `+${content.tabs.length - previewTabs.length}` }}
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTabAccentColor } from '../../constants/tabColors'
import { tabTooltipKey } from './useTabTooltip'
import TabTooltipPreview from './TabTooltipPreview.vue'

const { t } = useI18n()
const { active, dismiss } = inject(tabTooltipKey)
const content = computed(() => active.value?.props)
const previewTabs = computed(() => content.value?.tabs.slice(0, 6) ?? [])
const tooltipRef = useTemplateRef('tooltipRef')
const tooltipStyle = ref({})
const TOOLTIP_MAX_WIDTH_PX = 340
const TOOLTIP_MARGIN_PX = 8
const TOOLTIP_OFFSET_PX = 6
const resizeObserver = new ResizeObserver(updateTooltipPosition)

function handleKeydown(event) {
  if (event.key === 'Escape') dismiss()
}

watch(active, async value => {
  resizeObserver.disconnect()
  if (!value) return
  updateTooltipPosition()
  await nextTick()
  if (tooltipRef.value) {
    updateTooltipPosition()
    resizeObserver.observe(tooltipRef.value)
  }
})
watch(() => content.value?.showPreview, () => nextTick(updateTooltipPosition))

const listeners = [
  [document, 'pointerdown', dismiss],
  [document, 'wheel', dismiss],
  [document, 'visibilitychange', dismiss],
  [document, 'keydown', handleKeydown],
  [window, 'blur', dismiss],
  [window, 'resize', updateTooltipPosition]
]
for (const [target, event, handler] of listeners) target.addEventListener(event, handler, true)
onBeforeUnmount(() => {
  resizeObserver.disconnect()
  for (const [target, event, handler] of listeners) target.removeEventListener(event, handler, true)
})

function updateTooltipPosition() {
  const element = active.value?.element
  if (!(element instanceof HTMLElement)) {
    return
  }

  const rect = element.getBoundingClientRect()
  const tabBarRect = element.closest('.tabBar')?.getBoundingClientRect()
  const maxTooltipWidth = Math.min(
    content.value.isGroup ? 420 : TOOLTIP_MAX_WIDTH_PX,
    Math.max(120, window.innerWidth - TOOLTIP_MARGIN_PX * 2)
  )
  const tooltipHeight = tooltipRef.value?.offsetHeight ?? 240
  const renderedTooltipWidth = tooltipRef.value?.offsetWidth
  const tooltipWidth = !content.value.showPreview && renderedTooltipWidth > 0
    ? Math.min(renderedTooltipWidth, maxTooltipWidth)
    : maxTooltipWidth
  if (['left', 'right'].includes(content.value.tabBarPosition)) {
    // Place the tooltip beside the tab, keeping it inside the viewport.
    const top = Math.max(
      TOOLTIP_MARGIN_PX,
      Math.min(window.innerHeight - tooltipHeight - TOOLTIP_MARGIN_PX, rect.top)
    )
    let adjacentEdge = content.value.tabBarPosition === 'right'
      ? (tabBarRect?.left ?? rect.left)
      : (tabBarRect?.right ?? rect.right)
    if (content.value.tabBarPosition === 'right') {
      const pageScrollbar = document.querySelector(
        'body > .os-scrollbar-vertical:not(.os-scrollbar-unusable)'
      )
      if (pageScrollbar instanceof HTMLElement) {
        adjacentEdge = Math.min(adjacentEdge, pageScrollbar.getBoundingClientRect().left)
      }
    }

    const availableWidth = content.value.tabBarPosition === 'right'
      ? adjacentEdge - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX
      : window.innerWidth - adjacentEdge - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX
    const constrainedWidth = Math.min(tooltipWidth, Math.max(120, availableWidth))
    const horizontalPosition = content.value.tabBarPosition === 'right'
      ? {
          left: 'auto',
          // Anchor the outer tooltip edge directly to the rail. Calculating a
          // left position from its width drifts when preview content changes
          // the tooltip's final box size after the first render.
          right: `${Math.round(window.innerWidth - adjacentEdge + TOOLTIP_OFFSET_PX)}px`,
          transformOrigin: 'right top'
        }
      : {
          left: `${Math.round(adjacentEdge + TOOLTIP_OFFSET_PX)}px`,
          right: 'auto',
          transformOrigin: 'left top'
        }
    tooltipStyle.value = {
      ...horizontalPosition,
      maxInlineSize: `${Math.round(constrainedWidth)}px`,
      top: `${Math.round(top)}px`
    }
    return
  }

  const left = Math.max(
    TOOLTIP_MARGIN_PX,
    Math.min(
      window.innerWidth - tooltipWidth - TOOLTIP_MARGIN_PX,
      rect.left + rect.width / 2 - tooltipWidth / 2
    )
  )

  const anchorEdge = content.value.tabBarPosition === 'bottom'
    ? (tabBarRect?.top ?? rect.top)
    : (tabBarRect?.bottom ?? rect.bottom)
  const availableHeight = Math.max(0, (content.value.tabBarPosition === 'bottom'
    ? anchorEdge
    : window.innerHeight - anchorEdge) - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX)
  const height = content.value.isGroup ? Math.min(tooltipHeight, availableHeight) : tooltipHeight
  const top = content.value.tabBarPosition === 'bottom'
    ? anchorEdge - height - TOOLTIP_OFFSET_PX
    : anchorEdge + TOOLTIP_OFFSET_PX
  tooltipStyle.value = {
    left: `${Math.round(left)}px`,
    maxBlockSize: content.value.isGroup ? `${availableHeight}px` : undefined,
    top: `${Math.round(Math.max(TOOLTIP_MARGIN_PX, Math.min(top, window.innerHeight - height - TOOLTIP_MARGIN_PX)))}px`
  }
}

</script>

<style scoped>
.tabTooltip {
  box-sizing: border-box;
  position: fixed;
  z-index: 10000;
  inline-size: max-content;
  max-inline-size: min(340px, calc(100vw - 16px));
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: calc(8px * var(--ui-roundness));
  background-color: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  box-shadow: 0 8px 26px rgb(0 0 0 / 32%);
  color: var(--primary-text-color);
  font-family: var(--app-font-family);
  font-weight: 400;
  letter-spacing: 0;
  pointer-events: none;
  -webkit-app-region: no-drag;
  transition: top 0.14s ease, left 0.14s ease;
}

.tabTooltip.withPreview {
  inline-size: min(340px, calc(100vw - 16px));
}

.tabTooltipGroup {
  align-items: center;
  color: var(--secondary-text-color);
  display: flex;
  font-size: 11px;
  gap: 6px;
  margin-block-start: 3px;
}

.tabTooltip.withPreview .tabTooltipGroup {
  margin-block-end: 7px;
}

.tabTooltipGroupIcon {
  color: var(--tab-group-color);
  flex: 0 0 auto;
  font-size: 10px;
}

.tab-tooltip-enter-active,
.tab-tooltip-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.tab-tooltip-enter-from,
.tab-tooltip-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}

.tabTooltipTitle {
  margin-block-end: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.35;
}

.tabTooltipTitle:only-child {
  margin-block-end: 0;
}

.tabTooltip.tabGroupTooltip.withPreview {
  inline-size: min(420px, calc(100vw - 16px));
  max-inline-size: min(420px, calc(100vw - 16px));
  max-block-size: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
}

.tabTooltipCount {
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.35;
}

.tabTooltipGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: 10px;
  margin-block-start: 8px;
  min-block-size: 0;
}

.tabTooltipGridItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-inline-size: 0;
  min-block-size: 0;
}

.tabTooltipGridItem :deep(.tabTooltipPreview) {
  min-block-size: 0;
  flex-shrink: 1;
}

.tabTooltipRemaining {
  margin-block-start: 8px;
  text-align: end;
}

@media (prefers-reduced-motion: reduce) {
  .tabTooltip,
  .tab-tooltip-enter-active,
  .tab-tooltip-leave-active {
    transition: none;
  }
}
</style>
