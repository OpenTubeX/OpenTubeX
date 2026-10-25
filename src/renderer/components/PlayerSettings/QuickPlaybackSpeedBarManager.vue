<template>
  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Player Settings.Quick Playback Speed Bar Manager')"
    :icon="['fas', 'gauge-high']"
    grow-with-content
    @close="emit('close')"
  >
    <template #breadcrumb-action>
      <FtSyncedSettingIndicator setting-key="quickPlaybackSpeedBarOptions" />
    </template>
    <div class="quickPlaybackSpeedToolbar">
      <FtFlexBox class="quickPlaybackSpeedToolbarActions">
        <FtButton
          :label="t('Settings.Player Settings.Add Playback Speed')"
          :icon="['fas', 'plus']"
          :disabled="quickPlaybackSpeedBarEntries.length >= QUICK_PLAYBACK_SPEED_LIMIT"
          @click="addQuickPlaybackSpeed"
        />
        <FtButton
          :label="t('Settings.Player Settings.Reset Quick Playback Speed Bar')"
          :icon="['fas', 'undo']"
          :disabled="!hasModifiedQuickPlaybackSpeedBarOptions"
          @click="resetQuickPlaybackSpeedBarOptions"
        />
      </FtFlexBox>
    </div>
    <div class="quickPlaybackSpeedList">
      <div
        v-for="(option, index) in quickPlaybackSpeedBarEntries"
        :key="option.id"
        class="quickPlaybackSpeedEntry"
        :class="{
          dragging: draggedQuickPlaybackSpeedId === option.id,
          settling: isQuickPlaybackSpeedDragSettling,
          suppressTransition: suppressQuickPlaybackSpeedDragTransitions
        }"
        :data-quick-playback-speed-index="index"
        :data-quick-playback-speed-id="option.id"
        :style="getQuickPlaybackSpeedEntryStyle(option.id)"
      >
        <button
          class="quickPlaybackSpeedDragHandle"
          type="button"
          :title="t('Settings.Player Settings.Reorder Playback Speed')"
          :aria-label="t('Settings.Player Settings.Reorder Playback Speed')"
          @pointerdown.prevent="startQuickPlaybackSpeedDrag(index, $event)"
        >
          <FtIcon :icon="['fas', 'bars']" />
        </button>
        <div class="quickPlaybackSpeedFields">
          <div
            v-if="editingQuickPlaybackSpeedNameId !== option.id"
            class="quickPlaybackSpeedNameRow"
          >
            <span class="quickPlaybackSpeedName">
              {{ getQuickPlaybackSpeedDisplayName(option) }}
            </span>
            <FtIconButton
              class="quickPlaybackSpeedIconButton"
              :title="t('Settings.Player Settings.Edit Playback Speed Name')"
              :icon="['fas', 'edit']"
              :use-shadow="false"
              theme="base"
              @click="editingQuickPlaybackSpeedNameId = option.id"
            />
          </div>
          <div
            v-else
            class="quickPlaybackSpeedNameEditRow"
          >
            <FtInput
              class="quickPlaybackSpeedNameInput"
              :label="t('Settings.Player Settings.Playback Speed Name')"
              :icon="['fas', 'font']"
              :placeholder="getAutomaticQuickPlaybackSpeedName(option.speed)"
              :value="option.name"
              :show-action-button="false"
              @input="(value) => updateQuickPlaybackSpeedName(option.id, value)"
            />
            <FtIconButton
              class="quickPlaybackSpeedIconButton"
              :title="t('Settings.Player Settings.Use Automatic Playback Speed Name')"
              :icon="['fas', 'undo']"
              :use-shadow="false"
              theme="base"
              @click="resetQuickPlaybackSpeedName(option.id)"
            />
          </div>
        </div>
        <FtInput
          class="quickPlaybackSpeedValueField"
          :change-filter="normalizeQuickPlaybackSpeed"
          :icon="['fas', 'gauge-high']"
          input-type="number"
          :label="t('Settings.Player Settings.Playback Speed')"
          :placeholder="t('Form Inputs.Example', { example: '1.25' })"
          min="0.01"
          step="0.01"
          :value="String(option.speed)"
          :show-action-button="false"
          @change="updateQuickPlaybackSpeed(option.id, $event)"
        />
        <FtIconButton
          class="quickPlaybackSpeedIconButton delete"
          :disabled="quickPlaybackSpeedBarEntries.length <= 1"
          :title="t('Delete')"
          :icon="['fas', 'trash']"
          :use-shadow="false"
          theme="base"
          @click="deleteQuickPlaybackSpeed(option.id)"
        />
      </div>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

import store from '../../store/index'
import { DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS } from '../../../constants'

defineProps({
  open: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()

const QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX = 5
const QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS = 180
const QUICK_PLAYBACK_SPEED_LIMIT = 14

/** @type {import('vue').ComputedRef<number>} */
const videoPlaybackRateInterval = computed(() => store.getters.getVideoPlaybackRateInterval)

/** @type {import('vue').Ref<string | null>} */
const editingQuickPlaybackSpeedNameId = ref(null)

/** @type {import('vue').Ref<string | null>} */
const draggedQuickPlaybackSpeedId = ref(null)

/** @type {import('vue').Ref<Record<string, number>>} */
const quickPlaybackSpeedDragOffsets = ref({})

/** @type {import('vue').Ref<boolean>} */
const isQuickPlaybackSpeedDragSettling = ref(false)

/** @type {import('vue').Ref<boolean>} */
const suppressQuickPlaybackSpeedDragTransitions = ref(false)

/** @type {ReturnType<typeof window.setTimeout> | null} */
let quickPlaybackSpeedSettleTimeoutId = null

/** @type {null | {id: string, sourceIndex: number, targetIndex: number, pointerStartY: number, rects: Array<{id: string, top: number, height: number}>, gap: number, started: boolean, moved: boolean, draggedOffset: number}} */
let quickPlaybackSpeedDragSession = null

/** @type {import('vue').ComputedRef<string>} */
const quickPlaybackSpeedBarOptions = computed(() => store.getters.getQuickPlaybackSpeedBarOptions)

/** @type {import('vue').ComputedRef<Array<{id: string, speed: number, name: string}>>} */
const quickPlaybackSpeedBarEntries = computed(() => {
  return parseQuickPlaybackSpeedBarOptions(quickPlaybackSpeedBarOptions.value)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hasModifiedQuickPlaybackSpeedBarOptions = computed(() => {
  return quickPlaybackSpeedBarEntries.value.length !== DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.length ||
    quickPlaybackSpeedBarEntries.value.some((option, index) => {
      const defaultOption = DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS[index]
      return option.speed !== defaultOption.speed || option.name.trim() !== defaultOption.name
    })
})

/**
 * @param {string} value
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function parseQuickPlaybackSpeedBarOptions(value) {
  try {
    const parsedOptions = JSON.parse(value || '[]')

    if (!Array.isArray(parsedOptions)) {
      return getDefaultQuickPlaybackSpeedBarEntries()
    }

    const options = parsedOptions
      .map((option, index) => {
        const speed = Number.parseFloat(option?.speed)

        return {
          id: typeof option?.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
          speed,
          name: typeof option?.name === 'string' ? option.name : '',
        }
      })
      .filter((option) => Number.isFinite(option.speed) && option.speed > 0)

    return options.length > 0 ? options : getDefaultQuickPlaybackSpeedBarEntries()
  } catch (error) {
    console.error('Failed to parse quick playback speed bar options:', error)
    return getDefaultQuickPlaybackSpeedBarEntries()
  }
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getDefaultQuickPlaybackSpeedBarEntries() {
  return DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.map((option, index) => ({
    id: `default-${index}`,
    ...option,
  }))
}

/**
 * @param {Array<{id?: string, speed: number, name: string}>} options
 */
function saveQuickPlaybackSpeedBarOptions(options) {
  const normalizedOptions = options
    .map((option) => ({
      id: typeof option.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
      speed: normalizeQuickPlaybackSpeed(option.speed),
      name: option.name.trim(),
    }))
    .filter((option) => option.speed > 0)
    .slice(0, QUICK_PLAYBACK_SPEED_LIMIT)

  return store.dispatch(
    'updateQuickPlaybackSpeedBarOptions',
    JSON.stringify(normalizedOptions.length > 0 ? normalizedOptions : [{ id: createQuickPlaybackSpeedOptionId(), speed: 1, name: '' }])
  )
}

/**
 * @returns {string}
 */
function createQuickPlaybackSpeedOptionId() {
  return `speed-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * @param {number|string} speed
 * @returns {number}
 */
function normalizeQuickPlaybackSpeed(speed) {
  const parsedSpeed = Number.parseFloat(speed)

  if (!Number.isFinite(parsedSpeed) || parsedSpeed <= 0) {
    return 1
  }

  return Number.parseFloat(parsedSpeed.toFixed(2)) || 1
}

/**
 * @param {{speed: number, name: string}} option
 * @returns {string}
 */
function getQuickPlaybackSpeedDisplayName(option) {
  return option.name.trim() || getAutomaticQuickPlaybackSpeedName(option.speed)
}

/**
 * @param {number} speed
 * @returns {string}
 */
function getAutomaticQuickPlaybackSpeedName(speed) {
  if (Math.abs(speed - 1) < 0.01) {
    return t('Video.Player.Normal')
  }

  if (speed < 1) {
    return `${Math.round(speed * 100)}%`
  }

  return `${speed}x`
}

function addQuickPlaybackSpeed() {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length >= QUICK_PLAYBACK_SPEED_LIMIT) {
    return
  }

  const lastSpeed = options.length > 0 ? options[options.length - 1].speed : 1
  options.push({
    id: createQuickPlaybackSpeedOptionId(),
    speed: normalizeQuickPlaybackSpeed(lastSpeed + videoPlaybackRateInterval.value),
    name: '',
  })
  saveQuickPlaybackSpeedBarOptions(options)
}

function resetQuickPlaybackSpeedBarOptions() {
  saveQuickPlaybackSpeedBarOptions(DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS)
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} name
 */
function updateQuickPlaybackSpeedName(id, name) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.name = name
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function resetQuickPlaybackSpeedName(id) {
  updateQuickPlaybackSpeedName(id, '')
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} speed
 */
function updateQuickPlaybackSpeed(id, speed) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.speed = normalizeQuickPlaybackSpeed(speed)
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function deleteQuickPlaybackSpeed(id) {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length <= 1) {
    return
  }

  const index = options.findIndex((option) => option.id === id)

  if (index === -1) {
    return
  }

  options.splice(index, 1)
  saveQuickPlaybackSpeedBarOptions(options)

  if (editingQuickPlaybackSpeedNameId.value === id) {
    editingQuickPlaybackSpeedNameId.value = null
  }
}

/**
 * @param {string} id
 * @returns {Record<string, string>|undefined}
 */
function getQuickPlaybackSpeedEntryStyle(id) {
  const offset = quickPlaybackSpeedDragOffsets.value[id] || 0
  return offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getEditableQuickPlaybackSpeedBarOptions() {
  return quickPlaybackSpeedBarEntries.value.map((option) => ({
    id: option.id,
    speed: option.speed,
    name: option.name,
  }))
}

/**
 * @param {number} index
 * @param {PointerEvent} event
 */
function startQuickPlaybackSpeedDrag(index, event) {
  const rows = Array.from(document.querySelectorAll('[data-quick-playback-speed-id]'))
    .filter((element) => element instanceof HTMLElement)
  const sourceElement = rows[index]

  if (!(sourceElement instanceof HTMLElement)) {
    return
  }

  finishQuickPlaybackSpeedDragSettle(true)

  const rects = rows.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      id: element.dataset.quickPlaybackSpeedId ?? '',
      top: rect.top,
      height: rect.height,
    }
  })
  let gap = 0

  if (rects.length > 1) {
    gap = rects[1].top - (rects[0].top + rects[0].height)
  }

  quickPlaybackSpeedDragSession = {
    id: sourceElement.dataset.quickPlaybackSpeedId ?? '',
    sourceIndex: index,
    targetIndex: index,
    pointerStartY: event.clientY,
    rects,
    gap,
    started: false,
    moved: false,
    draggedOffset: 0,
  }

  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.addEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.addEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {PointerEvent} event
 */
function handleQuickPlaybackSpeedDragMove(event) {
  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const dy = event.clientY - quickPlaybackSpeedDragSession.pointerStartY

  if (!quickPlaybackSpeedDragSession.started) {
    if (Math.abs(dy) < QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX) {
      return
    }

    quickPlaybackSpeedDragSession.started = true
    draggedQuickPlaybackSpeedId.value = quickPlaybackSpeedDragSession.id
  }

  quickPlaybackSpeedDragSession.moved = true
  event.preventDefault()

  const { rects, sourceIndex, gap } = quickPlaybackSpeedDragSession
  const sourceRect = rects[sourceIndex]
  const lastRect = rects[rects.length - 1]
  const newTop = Math.max(
    rects[0].top - sourceRect.height / 2,
    Math.min(lastRect.top + lastRect.height - sourceRect.height / 2, sourceRect.top + dy)
  )
  const draggedOffset = newTop - sourceRect.top
  const draggedCenter = newTop + sourceRect.height / 2
  let targetIndex = sourceIndex

  for (let i = 0; i < rects.length; i++) {
    if (i === sourceIndex) {
      continue
    }

    const center = rects[i].top + rects[i].height / 2
    if (i < sourceIndex && draggedCenter < center) {
      targetIndex = Math.min(targetIndex, i)
    } else if (i > sourceIndex && draggedCenter > center) {
      targetIndex = Math.max(targetIndex, i)
    }
  }

  quickPlaybackSpeedDragSession.targetIndex = targetIndex
  quickPlaybackSpeedDragSession.draggedOffset = draggedOffset
  quickPlaybackSpeedDragOffsets.value = computeQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  const offsets = {}

  if (sourceIndex === targetIndex) {
    offsets[rects[sourceIndex].id] = draggedOffset
    return offsets
  }

  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    const rect = rects[index]
    if (index === sourceIndex) {
      offsets[rect.id] = draggedOffset
    } else {
      const delta = cursor - rect.top
      if (delta !== 0) {
        offsets[rect.id] = delta
      }
    }
    cursor += rect.height + gap
  }

  return offsets
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeFinalQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  if (sourceIndex === targetIndex) {
    return {}
  }

  const offsets = computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)
  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    if (index === sourceIndex) {
      offsets[rects[index].id] = cursor - rects[index].top
      break
    }
    cursor += rects[index].height + gap
  }

  return offsets
}

function stopQuickPlaybackSpeedDrag() {
  cleanupQuickPlaybackSpeedDragListeners()

  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const { id, sourceIndex, targetIndex, started, rects, gap, draggedOffset } = quickPlaybackSpeedDragSession

  if (!started) {
    quickPlaybackSpeedDragSession = null
    return
  }

  quickPlaybackSpeedDragOffsets.value = computeFinalQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = true

  quickPlaybackSpeedSettleTimeoutId = window.setTimeout(() => {
    quickPlaybackSpeedSettleTimeoutId = null
    commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex)
  }, QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS)

  quickPlaybackSpeedDragSession = null
}

function cleanupQuickPlaybackSpeedDragListeners() {
  window.removeEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.removeEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.removeEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {string} id
 * @param {number} sourceIndex
 * @param {number} targetIndex
 */
async function commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex) {
  if (sourceIndex !== targetIndex) {
    const options = getEditableQuickPlaybackSpeedBarOptions()
    const currentIndex = options.findIndex((option) => option.id === id)

    if (currentIndex !== -1) {
      const [option] = options.splice(currentIndex, 1)
      options.splice(targetIndex, 0, option)
      suppressQuickPlaybackSpeedDragTransitions.value = true
      await saveQuickPlaybackSpeedBarOptions(options)
    }
  }

  quickPlaybackSpeedDragOffsets.value = {}
  isQuickPlaybackSpeedDragSettling.value = false

  nextTick(() => {
    requestAnimationFrame(() => {
      suppressQuickPlaybackSpeedDragTransitions.value = false
    })
  })
}

/**
 * @param {boolean} [immediate=false]
 */
function finishQuickPlaybackSpeedDragSettle(immediate = false) {
  if (quickPlaybackSpeedSettleTimeoutId !== null) {
    window.clearTimeout(quickPlaybackSpeedSettleTimeoutId)
    quickPlaybackSpeedSettleTimeoutId = null
  }

  if (immediate) {
    suppressQuickPlaybackSpeedDragTransitions.value = true
  }

  quickPlaybackSpeedDragOffsets.value = {}
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = false
  quickPlaybackSpeedDragSession = null

  if (immediate) {
    nextTick(() => {
      requestAnimationFrame(() => {
        suppressQuickPlaybackSpeedDragTransitions.value = false
      })
    })
  }
}

onBeforeUnmount(() => {
  cleanupQuickPlaybackSpeedDragListeners()
  finishQuickPlaybackSpeedDragSettle(true)
})
</script>

<style scoped src="./QuickPlaybackSpeedBarManager.css" />
