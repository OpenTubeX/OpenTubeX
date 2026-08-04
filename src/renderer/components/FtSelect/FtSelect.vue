<template>
  <div
    ref="selectRoot"
    class="select"
    :class="{ containsTooltip: tooltip !== '', open: dropdownShown }"
    @focusout="handleFocusOut"
  >
    <select
      :id="`${id}-native`"
      :aria-describedby="describeById"
      aria-hidden="true"
      class="nativeSelect"
      :value="value"
      :name="id"
      :disabled="disabled"
      inert
      tabindex="-1"
      @change="change"
    >
      <option
        v-for="(name, index) in selectNames"
        :key="selectValues[index]"
        :dir="isLocaleSelector ? 'auto' : null"
        :value="selectValues[index]"
        :lang="isLocaleSelector && selectValues[index] !== 'system' && selectValues[index] !== '' ? selectValues[index] : null"
      >
        {{ name }}
      </option>
    </select>
    <button
      :id="id"
      ref="selectButton"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      class="select-text"
      :class="{ disabled }"
      :aria-controls="`${id}-listbox`"
      :aria-describedby="describeById"
      :aria-expanded="dropdownShown"
      :aria-activedescendant="dropdownShown ? `${id}-option-${activeIndex}` : null"
      :disabled="disabled"
      :dir="isLocaleSelector ? 'auto' : null"
      :lang="selectedLocale"
      @click="toggleDropdown"
      @keydown="handleButtonKeydown"
    >
      <span class="selectedValue">{{ selectedName }}</span>
    </button>
    <FontAwesomeIcon
      :icon="['fas', 'angle-down']"
      class="iconSelect"
    />
    <span class="select-highlight" />
    <span class="select-bar" />
    <label
      :id="`${id}-label`"
      class="select-label"
      :for="id"
    >
      <FontAwesomeIcon
        :icon="icon"
        class="select-icon"
        :color="iconColor"
      />
      <span class="select-label-text">
        {{ placeholder }}
        <FtSyncedSettingIndicator
          v-if="tooltip === ''"
          :setting-key="settingKey"
          :is-changed="isChanged"
          @reset="emit('reset')"
        />
      </span>
    </label>
    <span
      v-if="tooltip !== ''"
      class="selectIndicators"
    >
      <FtTooltip
        class="selectTooltip"
        :tooltip="tooltip"
      />
      <FtSyncedSettingIndicator
        :setting-key="settingKey"
        :is-changed="isChanged"
        @reset="emit('reset')"
      />
    </span>
    <Teleport :to="dropdownTarget">
      <Transition name="select-dropdown">
        <ul
          v-if="dropdownShown"
          :id="`${id}-listbox`"
          ref="dropdown"
          v-overlay-scrollbars
          class="selectDropdown"
          :class="dropdownPlacement"
          role="listbox"
          :aria-labelledby="`${id}-label`"
          :style="dropdownStyle"
          @pointerdown="handleDropdownPointerDown"
        >
          <li
            v-for="(name, index) in selectNames"
            :id="`${id}-option-${index}`"
            :key="selectValues[index]"
            ref="options"
            class="selectOption"
            :class="{ active: index === activeIndex, selected: selectValues[index] === value }"
            role="option"
            tabindex="-1"
            :aria-selected="selectValues[index] === value"
            :dir="isLocaleSelector ? 'auto' : null"
            :lang="isLocaleSelector && selectValues[index] !== 'system' && selectValues[index] !== '' ? selectValues[index] : null"
            @mousedown.prevent
            @pointermove="activeIndex = index"
            @click="selectOption(index)"
            @keydown.enter.space.prevent="selectOption(index)"
          >
            {{ name }}
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

const props = defineProps({
  placeholder: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  selectNames: {
    type: Array,
    required: true
  },
  selectValues: {
    type: Array,
    required: true
  },
  tooltip: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  describeById: {
    type: String,
    default: null
  },
  icon: {
    type: Array,
    required: true
  },
  iconColor: {
    type: String,
    default: null
  },
  isLocaleSelector: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  }
})

const emit = defineEmits(['change', 'reset'])

const id = useId()
const selectRoot = useTemplateRef('selectRoot')
const selectButton = useTemplateRef('selectButton')
const dropdown = useTemplateRef('dropdown')
const options = useTemplateRef('options')

const dropdownShown = ref(false)
const activeIndex = ref(0)
const dropdownStyle = ref({})
const dropdownTarget = shallowRef(document.fullscreenElement ?? document.body)
const dropdownPlacement = ref('below')
let typeahead = ''
let typeaheadTimer = null
let pointerDownInDropdown = false

const selectedIndex = computed(() => props.selectValues.indexOf(props.value))
const selectedName = computed(() => props.selectNames[selectedIndex.value] ?? '')
const selectedLocale = computed(() => {
  if (!props.isLocaleSelector || props.value === 'system' || props.value === '') {
    return null
  }

  return props.value
})

watch(dropdownShown, (shown) => {
  if (shown) {
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
  } else {
    removeDropdownListeners()
  }
})

onBeforeUnmount(() => {
  removeDropdownListeners()
  if (typeaheadTimer !== null) {
    clearTimeout(typeaheadTimer)
  }
})

function toggleDropdown() {
  if (dropdownShown.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

function openDropdown() {
  activeIndex.value = Math.max(0, selectedIndex.value)
  dropdownTarget.value = selectRoot.value?.closest('.prompt') ?? document.fullscreenElement ?? document.body
  dropdownShown.value = true

  nextTick(() => {
    updateDropdownPosition()
    scrollActiveOptionIntoView()
  })
}

function closeDropdown() {
  dropdownShown.value = false
}

function updateDropdownPosition() {
  const button = selectButton.value
  const menu = dropdown.value
  if (button === null || menu === null) {
    return
  }

  const viewportMargin = 8
  const menuGap = 4
  const maximumHeight = 400
  const minimumTop = Math.max(viewportMargin, getTopChromeBottom() + menuGap)
  const maximumBottom = window.innerHeight - viewportMargin
  const buttonRect = button.getBoundingClientRect()
  const spaceBelow = Math.max(0, maximumBottom - buttonRect.bottom - menuGap)
  const spaceAbove = Math.max(0, buttonRect.top - menuGap - minimumTop)
  const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight
  const desiredHeight = Math.min(maximumHeight, naturalHeight)
  const openAbove = desiredHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow)
  const menuHeight = Math.min(desiredHeight, availableHeight)
  const menuWidth = Math.min(buttonRect.width, window.innerWidth - viewportMargin * 2)
  const left = Math.max(
    viewportMargin,
    Math.min(buttonRect.left, window.innerWidth - viewportMargin - menuWidth)
  )
  const top = openAbove
    ? Math.max(minimumTop, buttonRect.top - menuGap - menuHeight)
    : Math.max(
        minimumTop,
        Math.min(buttonRect.bottom + menuGap, maximumBottom - menuHeight)
      )

  dropdownPlacement.value = openAbove ? 'above' : 'below'
  dropdownStyle.value = {
    inlineSize: `${menuWidth}px`,
    left: `${left}px`,
    top: `${top}px`,
    maxBlockSize: naturalHeight > menuHeight ? `${menuHeight}px` : null
  }
}

function getTopChromeBottom() {
  if (document.fullscreenElement !== null) {
    return 0
  }

  let bottom = 0
  for (const selector of ['.topNav', '.tabBar:not(.vertical)']) {
    const element = document.querySelector(selector)
    if (element !== null) {
      bottom = Math.max(bottom, element.getBoundingClientRect().bottom)
    }
  }

  return bottom
}

function moveActiveIndex(offset) {
  activeIndex.value = Math.max(0, Math.min(props.selectValues.length - 1, activeIndex.value + offset))
  scrollActiveOptionIntoView()
}

function scrollActiveOptionIntoView() {
  nextTick(() => options.value?.[activeIndex.value]?.scrollIntoView({ block: 'nearest' }))
}

/**
 * @param {KeyboardEvent} event
 */
function handleButtonKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!dropdownShown.value) {
      openDropdown()
    } else {
      moveActiveIndex(event.key === 'ArrowDown' ? 1 : -1)
    }
    return
  }

  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    if (!dropdownShown.value) {
      openDropdown()
    }
    activeIndex.value = event.key === 'Home' ? 0 : props.selectValues.length - 1
    scrollActiveOptionIntoView()
    return
  }

  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault()
    if (!dropdownShown.value) {
      openDropdown()
    } else {
      moveActiveIndex(event.key === 'PageDown' ? 10 : -10)
    }
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (dropdownShown.value) {
      selectOption(activeIndex.value)
    } else {
      openDropdown()
    }
    return
  }

  if (event.key === 'Escape' && dropdownShown.value) {
    event.preventDefault()
    closeDropdown()
    return
  }

  if (event.key === 'Tab') {
    closeDropdown()
    return
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    handleTypeahead(event.key)
  }
}

function handleTypeahead(character) {
  typeahead += character.toLocaleLowerCase()
  if (typeaheadTimer !== null) {
    clearTimeout(typeaheadTimer)
  }
  typeaheadTimer = setTimeout(() => {
    typeahead = ''
    typeaheadTimer = null
  }, 700)

  const match = props.selectNames.findIndex(name => name.toLocaleLowerCase().startsWith(typeahead))
  if (match === -1) {
    return
  }

  if (dropdownShown.value) {
    activeIndex.value = match
    scrollActiveOptionIntoView()
  } else {
    selectOption(match)
  }
}

function selectOption(index) {
  const selectedValue = props.selectValues[index]
  if (selectedValue !== props.value) {
    emit('change', selectedValue)
  }
  closeDropdown()
  selectButton.value?.focus()
}

function handleOutsidePointerDown(event) {
  const target = event.target
  if (target instanceof Node && (selectRoot.value?.contains(target) || dropdown.value?.contains(target))) {
    return
  }

  closeDropdown()
}

function handleFocusOut(event) {
  if (pointerDownInDropdown) {
    return
  }

  const nextTarget = event.relatedTarget
  const focusStaysInControl = nextTarget instanceof Node && (
    selectRoot.value?.contains(nextTarget) || dropdown.value?.contains(nextTarget)
  )

  if (!focusStaysInControl) {
    closeDropdown()
  }
}

function handleDropdownPointerDown() {
  pointerDownInDropdown = true
  setTimeout(() => {
    pointerDownInDropdown = false
  }, 0)
}

function removeDropdownListeners() {
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  window.removeEventListener('resize', updateDropdownPosition)
  window.removeEventListener('scroll', updateDropdownPosition, true)
}

/**
 * @param {Event} event
 */
function change(event) {
  emit('change', event.target.value)
}
</script>

<style scoped src="./FtSelect.css" />
