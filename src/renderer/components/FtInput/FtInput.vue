<!-- eslint-disable vuejs-accessibility/mouse-events-have-key-events -->
<template>
  <div
    class="ft-input-component"
    :class="{
      search: isSearch,
      forceTextColor,
      showActionButton,
      showPasswordToggle: inputType === 'password',
      floatingLabel: showLabel,
      hasValue: inputDataPresent,
      hasSupportingText: supportingText !== '',
      outlined: variant === 'outlined' && !isSearch
    }"
    @focusout="handleFocusOut"
  >
    <span class="inputWrapper">
      <component
        :is="multiline ? 'textarea' : 'input'"
        :id="id"
        ref="inputRef"
        :value="inputDataDisplayed"
        class="ft-input"
        :class="{ disabled, multiline }"
        :style="inputTextStyle"
        :maxlength="maxlength"
        :min="min"
        :step="step"
        :type="inputType === 'password' && passwordVisible ? 'text' : inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :spellcheck="false"
        :aria-describedby="descriptionIds"
        :aria-label="showLabel ? null : (label || placeholder)"
        @change="handleChange"
        @mousedown="selectOnClick && $event.button === 0 && $event.preventDefault()"
        @click="handleNativeClick"
        @input="handleInput"
        @focus="handleFocus"
        @blur="handleInputBlur"
        @keydown="handleKeyDown"
      />
      <fieldset
        v-if="showLabel"
        class="inputOutline"
        role="presentation"
      >
        <legend class="inputLegend">
          <label
            :for="id"
            class="selectLabel"
            :class="{ disabled, hasIcon: icon !== null }"
          >
            <FtIcon
              v-if="icon !== null"
              :icon="icon"
              class="selectLabelIcon"
              aria-hidden="true"
            />
            <span
              class="selectLabelText"
              :title="label || placeholder"
            >{{ label || placeholder }}</span>
          </label>
        </legend>
      </fieldset>
      <slot name="extraAction" />
      <button
        v-if="inputType === 'password'"
        type="button"
        class="inputAction passwordVisibilityToggle"
        :class="{ enabled: !disabled }"
        :disabled="disabled"
        :aria-label="passwordVisibilityLabel"
        :title="passwordVisibilityLabel"
        :aria-controls="id"
        @pointerdown.prevent
        @click="togglePasswordVisibility"
      >
        <FtIcon
          class="buttonIcon"
          :icon="['fas', passwordVisible ? 'eye-slash' : 'eye']"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="showActionButton"
        class="inputAction"
        :class="{
          enabled: inputDataPresent || allowActionButtonWhenEmpty,
          withLabel: showLabel
        }"
        :aria-label="actionButtonLabel"
        :title="actionButtonLabel"
        @click="handleClick"
      >
        <FtIcon
          class="buttonIcon"
          :icon="actionButtonIconName"
          aria-hidden="true"
        />
      </button>
      <span
        v-if="tooltip !== '' || settingKey !== ''"
        class="inputIndicators"
      >
        <FtTooltip
          v-if="tooltip !== ''"
          ref="tooltipRef"
          class="selectTooltip"
          position="bottom"
          :tooltip="tooltip"
        />
        <FtSyncedSettingIndicator :setting-key="settingKey" />
      </span>
    </span>
    <div class="options">
      <ul
        v-if="showOptions"
        ref="optionsList"
        v-overlay-scrollbars
        class="list"
        @mouseenter="searchState.isPointerInList = true"
        @mouseleave="searchState.isPointerInList = false"
      >
        <!-- eslint-disable vuejs-accessibility/click-events-have-key-events -->
        <li
          v-for="(entry, index) in visibleDataList"
          :key="index"
          :class="{ hover: searchState.selectedOption === index }"
          @mouseenter="searchState.selectedOption = index"
          @mouseleave="resetSelectedOption"
        >
          <component
            :is="getDataListProperty(index)?.isLink ? 'a' : 'div'"
            class="optionWrapper"
            :href="getDataListProperty(index)?.href"
            :aria-label="getDataListProperty(index)?.ariaLabel"
            :title="getDataListProperty(index)?.ariaLabel"
            @click.prevent="handleOptionClick(index, $event)"
            @auxclick.middle="handleOptionAuxClick(index, $event)"
          >
            <FtIcon
              v-if="getDataListProperty(index)?.iconName"
              :icon="['fas', getDataListProperty(index).iconName]"
              class="searchResultIcon"
            />
            <bdi>{{ getDataListProperty(index)?.displayText ?? entry }}</bdi>
          </component>
          <button
            v-if="showSuggestionFillButton"
            type="button"
            class="acceptSuggestionButton"
            :aria-label="`${t('Search Bar.Use Suggestion')}: ${getDataListProperty(index)?.displayText ?? entry}`"
            :title="t('Search Bar.Use Suggestion')"
            @pointerdown.prevent
            @click.stop="handleAcceptSuggestion(index)"
          >
            <FtIcon
              :icon="['fas', 'arrow-up-left']"
              aria-hidden="true"
            />
          </button>
          <a
            v-if="getDataListProperty(index)?.isRemoveable"
            class="removeButton"
            :class="{ removeButtonSelected: removeButtonSelectedIndex === index }"
            role="button"
            :aria-label="t('Search Bar.Remove')"
            :title="t('Search Bar.Remove')"
            href="javascript:void(0)"
            @click.prevent.stop="handleRemoveClick(index)"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </a>
        </li>
        <!-- skipped -->
      </ul>
    </div>
    <p
      v-if="supportingText"
      :id="`${id}-supporting`"
      class="supportingText"
    >
      {{ supportingText }}
    </p>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

import store from '../../store/index'

import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { isKeyboardEventKeyPrintableChar, isNullOrEmpty } from '../../helpers/strings'
import { getInputTextAscentOffset } from './inputTextMetrics'
import { shouldOpenExternalMediaUrl } from '../../helpers/externalMediaUrl'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'

const { t } = useI18n()

const props = defineProps({
  multiline: { type: Boolean, default: false },
  selectOnClick: { type: Boolean, default: false },
  changeFilter: { type: Function, default: null },
  min: { type: [String, Number], default: null },
  step: { type: [String, Number], default: null },
  variant: {
    type: String,
    default: 'outlined',
    validator: value => ['filled', 'outlined'].includes(value)
  },
  inputType: {
    type: String,
    default: 'text'
  },
  inputFilter: {
    type: Function,
    default: null
  },
  placeholder: {
    type: String,
    required: true
  },
  label: {
    type: String,
    default: null
  },
  supportingText: {
    type: String,
    default: ''
  },
  icon: {
    type: Array,
    default: null
  },
  maxlength: {
    type: Number,
    default: null
  },
  value: {
    type: String,
    default: ''
  },
  showActionButton: {
    type: Boolean,
    default: true
  },
  actionButtonLabel: {
    type: String,
    default: '',
  },
  forceActionButtonIconName: {
    type: Array,
    default: null
  },
  showLabel: {
    type: Boolean,
    default: true
  },
  isSearch: {
    type: Boolean,
    default: false
  },
  showSuggestionFillButton: {
    type: Boolean,
    default: false
  },
  externalMediaNavigation: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  readonly: {
    type: Boolean,
    default: false
  },
  dataList: {
    type: Array,
    default: () => []
  },
  dataListProperties: {
    type: Array,
    default: () => []
  },
  searchResultIconNames: {
    type: Array,
    default: null
  },
  showDataWhenEmpty: {
    type: Boolean,
    default: false
  },
  tooltip: {
    type: String,
    default: ''
  },
  allowActionButtonWhenEmpty: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['blur', 'change', 'clear', 'click', 'focus', 'input', 'keydown', 'remove'])

const id = useId()

const inputRef = useTemplateRef('inputRef')
const passwordVisible = ref(false)
const passwordVisibilityLabel = computed(() => passwordVisible.value
  ? t('Form Inputs.Hide Password')
  : t('Form Inputs.Show Password'))

watch([() => props.inputType, () => props.disabled], () => {
  passwordVisible.value = false
})

async function togglePasswordVisibility() {
  const input = inputRef.value
  if (!input || props.disabled) return

  const { selectionStart, selectionEnd, selectionDirection } = input
  passwordVisible.value = !passwordVisible.value
  await nextTick()
  if (selectionStart !== null && selectionEnd !== null) {
    input.setSelectionRange(selectionStart, selectionEnd, selectionDirection)
  }
}

const tooltipRef = useTemplateRef('tooltipRef')
const descriptionIds = computed(() => [
  tooltipRef.value?.id,
  props.supportingText ? `${id}-supporting` : null
].filter(Boolean).join(' ') || undefined)
const optionsList = useTemplateRef('optionsList')

watch(optionsList, (list, previousList, onCleanup) => {
  if (list === null) return
  // The viewport can keep its height while responsive rows become shorter.
  const observer = new ResizeObserver(() => {
    clampOverlayScrollTop(list, list.querySelector(':scope > li:last-of-type'))
  })
  observer.observe(list)
  const firstRow = list.querySelector('li')
  if (firstRow) observer.observe(firstRow)
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })

const inputData = ref(props.value)
const searchState = reactive({
  showOptions: false,
  selectedOption: -1,
  isPointerInList: false,
  keyboardSelectedOptionIndex: -1
})
const visibleDataList = ref(props.dataList)
const visibleDataListIndexes = ref(props.dataList.map((_, index) => index))
const removeButtonSelectedIndex = ref(-1)
const removalMade = ref(false)
const actionButtonIconName = shallowRef(props.forceActionButtonIconName ?? ['fas', 'search'])

const showOptions = computed(() => {
  return (inputData.value !== '' || props.showDataWhenEmpty) && visibleDataList.value.length > 0 && searchState.showOptions
})

const forceTextColor = computed(() => props.isSearch && store.getters.getBarColor)

const searchStateKeyboardSelectedOptionValue = computed(() => {
  return searchState.keyboardSelectedOptionIndex === -1
    ? null
    : visibleDataList.value[searchState.keyboardSelectedOptionIndex]
})

const inputDataDisplayed = computed(() => {
  if (!props.isSearch) { return inputData.value }

  /** @type {string | null | undefined} */
  const selectedOptionValue = searchStateKeyboardSelectedOptionValue.value
  if (selectedOptionValue != null && selectedOptionValue !== '') {
    return selectedOptionValue
  }

  return inputData.value
})

const inputDataPresent = computed(() => inputDataDisplayed.value.length > 0)
const inputTextStyle = computed(() => {
  if (!props.isSearch) return null

  const offset = getInputTextAscentOffset(inputDataDisplayed.value)
  const paddingStart = props.showLabel ? 20 : (45 - 20) / 2
  const paddingEnd = props.showLabel ? 5 : (45 - 20) / 2

  return {
    '--search-input-padding-block-start': `${paddingStart - offset}px`,
    '--search-input-padding-block-end': `${paddingEnd + offset}px`
  }
})

watch(() => props.dataList, () => updateVisibleDataList(removalMade.value), { deep: true })
watch(inputData, () => updateVisibleDataList())
watch(() => props.value, (value) => {
  inputData.value = value
})

updateVisibleDataList()

/**
 * @param {KeyboardEvent | MouseEvent} [event]
 * @param {number} [dataListIndex]
 */
function handleClick(event, dataListIndex = searchState.keyboardSelectedOptionIndex) {
  const selectedValue = searchStateKeyboardSelectedOptionValue.value
  const query = (selectedValue != null && selectedValue !== '') ? selectedValue : inputData.value
  inputData.value = query

  // No action if no input text
  if (!inputDataPresent.value && !props.allowActionButtonWhenEmpty) {
    return
  }

  searchState.showOptions = false
  searchState.selectedOption = -1
  searchState.keyboardSelectedOptionIndex = -1
  removeButtonSelectedIndex.value = -1

  emit('input', query)
  emit('click', query, { event, dataListIndex })
}

function handleNativeClick() {
  if (props.selectOnClick) {
    inputRef.value?.focus()
    inputRef.value?.select()
  }
}

/**
 * @param {Event} event
 */
function handleChange(event) {
  const value = props.changeFilter ? String(props.changeFilter(event.target.value)) : event.target.value
  inputData.value = value
  event.target.value = value
  emit('change', value)
}

/**
 * @param {string | InputEvent} data
 */
function handleInput(data) {
  const rawText = typeof data === 'string' ? data : inputRef.value.value
  const text = props.inputFilter ? props.inputFilter(rawText) : rawText
  if (text !== rawText && inputRef.value) {
    const input = inputRef.value
    const { selectionStart, selectionEnd } = input
    input.value = text
    if (selectionStart !== null && selectionEnd !== null) {
      input.setSelectionRange(
        props.inputFilter(rawText.slice(0, selectionStart)).length,
        props.inputFilter(rawText.slice(0, selectionEnd)).length
      )
    }
  }
  inputData.value = text
  searchState.showOptions = true

  // Native cancel can clear a keyboard preview while inputData is already empty.
  if (text === '') updateVisibleDataList()

  if (
    props.isSearch &&
    searchState.selectedOption !== -1 &&
    inputData.value === visibleDataList.value[searchState.selectedOption]
  ) {
    return
  }

  handleActionIconChange()
  emit('input', text)
}

function clearText() {
  // No action if no input text
  if (!inputDataPresent.value) { return }

  inputData.value = ''
  handleActionIconChange()
  updateVisibleDataList()
  searchState.isPointerInList = false

  inputRef.value.value = ''

  // Focus on input element after text is clear for better UX
  inputRef.value.focus()

  emit('clear')
}

async function handleActionIconChange() {
  // Only need to update icon if visible
  if (!props.showActionButton) { return }

  const inputText = props.isSearch ? inputData.value.trim() : inputData.value

  if (!inputDataPresent.value && props.forceActionButtonIconName === null) {
    // Change back to default icon if text is blank
    actionButtonIconName.value = ['fas', 'search']
    return
  }

  if (props.externalMediaNavigation && supportsYtDlp && shouldOpenExternalMediaUrl(inputText, store.getters.getCurrentInvidiousInstanceUrl)) {
    if (props.forceActionButtonIconName === null) actionButtonIconName.value = ['fas', 'arrow-right']
    return
  }

  // Update action button icon according to input
  try {
    const result = await store.dispatch('getYoutubeUrlInfo', inputText)

    let isYoutubeLink = false

    switch (result.urlType) {
      case 'video':
      case 'playlist':
      case 'search':
      case 'channel':
      case 'hashtag':
      case 'post':
      case 'trending':
      case 'subscriptions':
      case 'history':
      case 'userplaylists':
        isYoutubeLink = true
        break

      case 'invalid_url':
      default: {
        // isYoutubeLink is already `false`
      }
    }

    if (props.forceActionButtonIconName === null) {
      if (isYoutubeLink || (props.externalMediaNavigation && supportsYtDlp &&
        shouldOpenExternalMediaUrl(inputText, store.getters.getCurrentInvidiousInstanceUrl))) {
        // Go to URL (i.e. Video/Playlist/Channel
        actionButtonIconName.value = ['fas', 'arrow-right']
      } else {
        // Search with text
        actionButtonIconName.value = ['fas', 'search']
      }
    }
  } catch (ex) {
    // On exception, consider text as invalid URL
    if (props.forceActionButtonIconName === null) {
      actionButtonIconName.value = ['fas', 'search']
    }

    // Rethrow exception
    throw ex
  }
}

/**
 * @param {number} index
 * @param {MouseEvent} [event]
 */
function handleOptionClick(index, event) {
  if (removeButtonSelectedIndex.value !== -1) {
    handleRemoveClick(index)
    return
  }

  const selectedValue = visibleDataList.value[index]
  if (selectedValue == null) {
    resetSelectedOption()
    return
  }

  searchState.showOptions = false
  searchState.isPointerInList = false
  inputData.value = selectedValue
  emit('input', inputData.value)
  handleClick(event, getDataListIndex(index))
}

/**
 * Let web browsers follow the real link themselves. Electron needs to route
 * middle-clicks through its logical tab service instead.
 * @param {number} index
 * @param {MouseEvent} event
 */
function handleOptionAuxClick(index, event) {
  if (!process.env.IS_ELECTRON || !getDataListProperty(index)?.isLink) {
    return
  }

  event.preventDefault()
  inputRef.value.focus()
  emit('click', visibleDataList.value[index], {
    event,
    dataListIndex: getDataListIndex(index)
  })
}

function resetSelectedOption() {
  searchState.selectedOption = -1
  removeButtonSelectedIndex.value = -1
}

/**
 * @param {number} index
 */
function handleAcceptSuggestion(index) {
  const selectedValue = visibleDataList.value[index]
  if (selectedValue == null) return

  resetSelectedOption()
  searchState.keyboardSelectedOptionIndex = -1
  handleInput(selectedValue)
  searchState.isPointerInList = false
  inputRef.value.focus()
  inputRef.value.setSelectionRange(selectedValue.length, selectedValue.length)
  searchState.showOptions = false
}

/**
 * @param {number} index
 */
function handleRemoveClick(index) {
  if (!getDataListProperty(index)?.isRemoveable) { return }

  // keep input in focus even when the to-be-removed "Remove" button was clicked
  inputRef.value.focus()
  removalMade.value = true
  emit('remove', visibleDataList.value[index], { dataListIndex: getDataListIndex(index) })
}

/**
 * @param {number} visibleIndex
 * @returns {number}
 */
function getDataListIndex(visibleIndex) {
  return visibleDataListIndexes.value[visibleIndex]
}

/**
 * @param {number} visibleIndex
 * @returns {object | undefined}
 */
function getDataListProperty(visibleIndex) {
  return props.dataListProperties[getDataListIndex(visibleIndex)]
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
  emit('keydown', event)
  if (event.defaultPrevented) {
    return
  }

  // Update Input box value if enter key was pressed and option selected
  if (!props.multiline && event.key === 'Enter' && !event.isComposing) {
    if (removeButtonSelectedIndex.value !== -1) {
      handleRemoveClick(removeButtonSelectedIndex.value)
    } else if (searchState.selectedOption !== -1) {
      searchState.showOptions = false
      event.preventDefault()
      handleOptionClick(searchState.selectedOption)
    } else {
      handleClick(event)
    }

    return
  }

  if (visibleDataList.value.length === 0) { return }

  searchState.showOptions = true

  // "select" the Remove button through right arrow navigation, and unselect it with the left arrow
  if (event.key === 'ArrowRight') {
    removeButtonSelectedIndex.value = searchState.selectedOption
  } else if (event.key === 'ArrowLeft') {
    removeButtonSelectedIndex.value = -1
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const newIndex = searchState.selectedOption + (event.key === 'ArrowDown' ? 1 : -1)
    updateSelectedOptionIndex(newIndex)
  } else {
    const selectedOptionValue = searchStateKeyboardSelectedOptionValue.value

    // Keyboard selected & is char
    if (!isNullOrEmpty(selectedOptionValue) && isKeyboardEventKeyPrintableChar(event.key)) {
      // Update input based on KB selected suggestion value instead of current input value
      event.preventDefault()
      handleInput(`${selectedOptionValue}${event.key}`)
    }
  }
}

/**
 * Updates the selected dropdown option index and handles the under/over-flow behavior
 * @param {number} index
 */
function updateSelectedOptionIndex(index) {
  searchState.selectedOption = index

  // unset selection of "Remove" button
  removeButtonSelectedIndex.value = -1

  // Allow deselecting suggestion
  if (searchState.selectedOption < -1) {
    searchState.selectedOption = visibleDataList.value.length - 1
  } else if (searchState.selectedOption > visibleDataList.value.length - 1) {
    searchState.selectedOption = -1
  }

  // Update displayed value
  searchState.keyboardSelectedOptionIndex = searchState.selectedOption
}

function handleOutsideTouch(event) {
  const input = inputRef.value
  if (event.pointerType !== 'touch' || document.activeElement !== input || input.closest('.ft-input-component').contains(event.target)) return
  // iOS can retain focus after dismissing the keyboard, then consume player
  // taps to reopen it. Clear focus before those taps reach the player.
  searchState.isPointerInList = false
  searchState.showOptions = false
  input.blur()
}

// Scrollbar setup restores focus while suppressing focus events. Keep this
// listener for the component lifetime instead of relying on focus/blur pairs.
onMounted(() => {
  if (process.env.IS_IOS) document.addEventListener('pointerdown', handleOutsideTouch, true)
})

onBeforeUnmount(() => {
  if (process.env.IS_IOS) document.removeEventListener('pointerdown', handleOutsideTouch, true)
})

function handleFocusOut(event) {
  if (!searchState.isPointerInList && !event.currentTarget.contains(event.relatedTarget)) {
    searchState.showOptions = false
  }
}

function handleInputBlur() {
  emit('blur', inputData.value)
}

function handleFocus() {
  emit('focus')
  searchState.showOptions = true
}

async function updateVisibleDataList(preserveSelectionAfterRemoval = false) {
  if (optionsList.value != null) {
    restoreOverlayScrollTop(optionsList.value, 0)
  }

  if (inputData.value.trim() === '') {
    visibleDataList.value = props.dataList
    visibleDataListIndexes.value = props.dataList.map((_, index) => index)
  } else {
    // get list of items that match input
    const lowerCaseInputData = inputData.value.toLowerCase()

    visibleDataListIndexes.value = props.dataList
      .map((_, index) => index)
      .filter(index => props.dataList[index].toLowerCase().includes(lowerCaseInputData))
    visibleDataList.value = visibleDataListIndexes.value.map(index => props.dataList[index])
  }

  // Keep the same row selected only while the removal is reflected in the
  // data list. A text change must clear it, otherwise its index can point past
  // the newly filtered list and submit an undefined value.
  if (!preserveSelectionAfterRemoval || searchState.selectedOption >= visibleDataList.value.length) {
    resetSelectedOption()
    searchState.keyboardSelectedOptionIndex = -1
  }

  removalMade.value = false

  await nextTick()
  const list = optionsList.value
  const finalOption = list?.querySelector(':scope > li:last-of-type') ?? null
  if (list !== null) clampOverlayScrollTop(list, finalOption)
}

defineExpose({
  focus: () => {
    inputRef.value?.focus()
  },
  blur: () => {
    inputRef.value?.blur()
  },
  select: () => {
    inputRef.value?.select()
  },

  /**
   * @param {string} text
   */
  setText: (text) => {
    inputData.value = text
  },

  clear: clearText
})
</script>

<style scoped src="./FtInput.css" />
