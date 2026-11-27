<template>
  <div
    ref="toolbar"
    class="videoOptions"
    :class="layout"
  >
    <span class="videoOptionsMobileRow">
      <slot
        name="primary"
        :in-toolbar="inToolbar"
      />
    </span>
    <span class="videoOptionsMobileRow">
      <slot
        name="secondary"
        :in-toolbar="inToolbar"
      />
      <FtIconButton
        v-if="overflowMenuOptions.length > 0"
        class="moreActions"
        :title="t('Video.More Options')"
        :icon="['fas', 'ellipsis']"
        theme="base-no-default"
        dropdown-position-x="left"
        :dropdown-portal="dropdownPortal"
        force-dropdown
        mobile-sheet
      >
        <WatchVideoMoreActions
          :title="t('Video.More Options')"
          :actions="overflowMenuOptions"
          @select="key => actions[key].run()"
        />
      </FtIconButton>
      <slot name="trailing" />
    </span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import WatchVideoMoreActions from '../WatchVideoMoreActions/WatchVideoMoreActions.vue'
import { useTabContext } from '../../tabs/TabContext'
import { isRendered } from '../../helpers/rendered'

/**
 * @typedef ToolbarAction
 * @property {boolean} visible
 * @property {string} label
 * @property {string[]} icon
 * @property {boolean} [active]
 * @property {() => void} run
 */

const props = defineProps({
  /**
   * Actions without menus of their own, keyed by name. The slots render them
   * while `inToolbar(name)` is true, and the More menu takes the rest.
   * @type {import('vue').PropType<Record<string, ToolbarAction>>}
   */
  actions: { type: Object, required: true },
  /** The order in which actions move to the More menu. */
  overflowOrder: { type: Array, required: true },
  dropdownPortal: { type: Boolean, default: false }
})

const { t } = useI18n()

// Smallest touch target of a button in the even layout
const MIN_EVEN_BUTTON_SIZE = 44

const toolbar = useTemplateRef('toolbar')
/** @type {import('vue').Ref<'full' | 'even'>} */
const layout = ref('full')
const overflowCount = ref(0)
let layoutFrame = null
// Whether a layout was skipped while Android's picture-in-picture hid the page
let layoutPending = false
// A background tab keeps its layout without rendering it, and a change that
// leaves the rows at their size reports no resize once it shows again.
let layoutWhenShown = false
const { isTabPresented } = useTabContext()
watch(() => isTabPresented?.value, presented => {
  if (presented && layoutWhenShown) scheduleLayout()
})
// Moving the actions of a group to the More menu can remove the divider, so
// the overflow keeps budgeting for it. Otherwise the freed space would bring
// an action back, which brings the divider back too.
let dividerWidth = 0

const visibleOverflowOrder = computed(() => props.overflowOrder.filter(key => props.actions[key]?.visible))
const overflowedActions = computed(() => new Set(visibleOverflowOrder.value.slice(0, overflowCount.value)))

/** @param {string} key */
function inToolbar(key) {
  return Boolean(props.actions[key]?.visible) && !overflowedActions.value.has(key)
}

const overflowMenuOptions = computed(() => Object.entries(props.actions)
  .filter(([key]) => overflowedActions.value.has(key))
  .map(([key, action]) => ({ value: key, label: action.label, icon: action.icon, active: action.active })))

/**
 * Width of an action group on one line, including its divider.
 * @param {HTMLElement} group
 */
function getGroupWidth(group) {
  const gap = parseFloat(getComputedStyle(group).columnGap) || 0
  const items = getToolbarItems(group)
  return items.reduce((width, item) => width + item.getBoundingClientRect().width + getInlineMargins(getComputedStyle(item)), 0) +
    gap * Math.max(items.length - 1, 0) + getDividerWidth(group)
}

/** @param {HTMLElement} group */
function getDividerWidth(group) {
  const divider = getComputedStyle(group, '::before')
  return divider.content === 'none'
    ? 0
    : parseFloat(divider.inlineSize) + getInlineMargins(divider) + (parseFloat(getComputedStyle(group).columnGap) || 0)
}

/** @param {HTMLElement} group */
function getToolbarItems(group) {
  return [...group.children].filter(item => item.getClientRects().length > 0)
}

/**
 * @param {CSSStyleDeclaration} style
 */
function getInlineMargins(style) {
  return parseFloat(style.marginInlineStart) + parseFloat(style.marginInlineEnd)
}

/**
 * Keeps the labeled toolbar at its natural width when it fits on one line of
 * its parent row. Otherwise the buttons share the full width evenly, and when
 * even that would make them smaller than a touch target, the actions without
 * menus of their own move to the More menu. CSS cannot measure how wide the
 * toolbar would be in the other layout, so the natural layout is measured
 * within the same frame.
 */
function updateLayout() {
  // Native picture-in-picture shows only the video, and its layout changes
  // resize the hidden page. Measuring forces a style recalculation of the
  // whole document while the window enters picture-in-picture.
  if (document.body.classList.contains('androidPictureInPicture')) {
    layoutPending = true
    return
  }
  const element = toolbar.value
  const row = element?.parentElement
  if (!element || !row) { return }
  layoutWhenShown = !isRendered(row)
  if (layoutWhenShown || row.clientWidth === 0) { return }

  element.classList.add('measuring')
  const style = getComputedStyle(element)
  const groups = [...element.children].filter(group => group.getClientRects().length > 0)
  const items = groups.flatMap(getToolbarItems)
  const toolbarPadding = parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd)
  const gap = parseFloat(style.columnGap) || 0
  const measuredDividersWidth = groups.reduce((width, group) => width + getDividerWidth(group), 0)
  if (measuredDividersWidth > 0) dividerWidth = measuredDividersWidth
  const dividersWidth = overflowCount.value > 0 ? dividerWidth : measuredDividersWidth
  // The actions in the More menu would each add a button and a gap, and the
  // divider if moving them removed it
  const buttonWidth = element.querySelector('.ftIconButton')?.getBoundingClientRect().width ?? 0
  const hiddenWidth = overflowedActions.value.size * (buttonWidth + gap) + dividersWidth - measuredDividersWidth
  const naturalWidth = groups.reduce((width, group) => width + getGroupWidth(group), 0) +
    gap * Math.max(groups.length - 1, 0) + toolbarPadding + hiddenWidth
  element.classList.remove('measuring')

  const availableWidth = row.clientWidth + 0.5
  if (naturalWidth <= availableWidth) {
    layout.value = 'full'
    overflowCount.value = 0
    return
  }

  layout.value = 'even'
  const buttonCount = items.length + overflowedActions.value.size
  const capacity = Math.floor((availableWidth - toolbarPadding - dividersWidth + gap) / (MIN_EVEN_BUTTON_SIZE + gap))
  // The More button takes one of the slots
  overflowCount.value = buttonCount > capacity ? buttonCount - capacity + 1 : 0
}

function scheduleLayout() {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(updateLayout)
}

function layoutAfterPictureInPicture() {
  if (!layoutPending) { return }
  layoutPending = false
  scheduleLayout()
}

const resizeObserver = new ResizeObserver(scheduleLayout)
// Also catches actions that slotted components such as the cast button add
const mutationObserver = new MutationObserver(scheduleLayout)

onMounted(() => {
  resizeObserver.observe(toolbar.value.parentElement)
  for (const group of toolbar.value.children) {
    resizeObserver.observe(group)
  }
  mutationObserver.observe(toolbar.value, { childList: true, subtree: true })
  // Hiding an action from the closed More menu changes no rendered toolbar rows
  watch(() => visibleOverflowOrder.value.join(), scheduleLayout)
  window.addEventListener('opentubex:android-pip-restored', layoutAfterPictureInPicture)
  updateLayout()
})

onBeforeUnmount(() => {
  window.removeEventListener('opentubex:android-pip-restored', layoutAfterPictureInPicture)
  resizeObserver.disconnect()
  mutationObserver.disconnect()
  cancelAnimationFrame(layoutFrame)
})
</script>

<style scoped src="./WatchVideoToolbar.css" />
