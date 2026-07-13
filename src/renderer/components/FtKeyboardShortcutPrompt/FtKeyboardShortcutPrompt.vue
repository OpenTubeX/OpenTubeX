<template>
  <FtPrompt
    :label="$t('KeyboardShortcutPrompt.Keyboard Shortcuts')"
    @click="hideKeyboardShortcutPrompt"
  >
    <template #label="{ labelId }">
      <div class="titleAndCloseButton">
        <h2 :id="labelId">
          {{ $t('KeyboardShortcutPrompt.Keyboard Shortcuts') }}
        </h2>
        <FtIconButton
          :title="$t('Close')"
          :icon="['fas', 'xmark']"
          theme="destructive"
          @click="hideKeyboardShortcutPrompt"
        />
      </div>
    </template>

    <div class="shortcutColumns">
      <div
        v-for="(shortcutColumn, index) of shortcutColumns"
        :key="index"
        class="shortcutColumn"
      >
        <div
          v-for="shortcutSection in shortcutColumn"
          :key="shortcutSection.title"
          class="shortcutSection"
          :style="{ order: shortcutSection.order }"
        >
          <h3 class="center">
            {{ shortcutSection.title }}
          </h3>
          <div class="labelsAndShortcuts">
            <div
              v-for="[label, shortcut] in shortcutSection.shortcutDictionary"
              :key="label"
              class="labelAndShortcut"
            >
              <p
                class="label"
              >
                {{ label }}
              </p>
              <p class="shortcut">
                {{ shortcut }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </FtPrompt>
</template>

<script setup>

import { computed } from 'vue'
import { KeyboardShortcuts } from '../../../constants'
import { getLocalizedShortcut } from '../../helpers/utils'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import store from '../../store/index'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../FtIconButton/FtIconButton.vue'

const { t } = useI18n()

const generalPlayerShortcuts = computed(() =>
  getLocalizedShortcutNamesAndValues(KeyboardShortcuts.VIDEO_PLAYER.GENERAL)
)

const playbackPlayerShortcuts = computed(() =>
  getLocalizedShortcutNamesAndValues(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK)
)

const generalAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  KeyboardShortcuts.APP.GENERAL,
  [
    'SHOW_SHORTCUTS',
    'HISTORY_BACKWARD',
    'HISTORY_FORWARD',
    'HISTORY_BACKWARD_ALT_MAC',
    'HISTORY_FORWARD_ALT_MAC',
    'NAVIGATE_TO_SETTINGS',
    'NAVIGATE_TO_HISTORY',
    'NAVIGATE_TO_HISTORY_MAC',
  ]
))

const tabAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  KeyboardShortcuts.APP.GENERAL,
  [
    'NEW_TAB',
    'CLOSE_TAB',
    'RELOAD_TAB',
    'RESTORE_CLOSED_TAB',
    'NEXT_TAB',
    'PREV_TAB',
    'SWITCH_TO_TAB',
  ]
))

const searchAndPageAppShortcuts = computed(() => [
  ...getLocalizedShortcutNamesAndValues(
    KeyboardShortcuts.APP.GENERAL,
    [
      'FOCUS_SEARCH',
      'FOCUS_SEARCH_ALT',
      'FOCUS_SEARCH_ALT_SLASH',
      'SEARCH_IN_NEW_WINDOW',
      'FIND_IN_PAGE',
      'FIND_NEXT',
      'FIND_NEXT_ALT',
      'FIND_NEXT_ALT_ENTER',
      'FIND_PREVIOUS',
      'FIND_PREVIOUS_ALT',
      'FIND_PREVIOUS_ALT_ENTER',
    ]
  ),
  ...getLocalizedShortcutNamesAndValues(KeyboardShortcuts.APP.SITUATIONAL)
])

const windowAndViewAppShortcuts = computed(() => getLocalizedShortcutNamesAndValues(
  KeyboardShortcuts.APP.GENERAL,
  [
    'NEW_WINDOW',
    'MINIMIZE_WINDOW',
    'TOGGLE_DEVTOOLS',
    'RESET_ZOOM',
    'ZOOM_IN',
    'ZOOM_OUT',
    'FULLSCREEN',
  ]
))

const shortcutColumns = computed(() => [
  [
    {
      title: t('KeyboardShortcutPrompt.Sections.Video.Playback'),
      shortcutDictionary: playbackPlayerShortcuts.value,
      order: 1
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.General'),
      shortcutDictionary: generalAppShortcuts.value,
      order: 3
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Search and Page'),
      shortcutDictionary: searchAndPageAppShortcuts.value,
      order: 5
    }
  ],
  [
    {
      title: t('KeyboardShortcutPrompt.Sections.Video.General'),
      shortcutDictionary: generalPlayerShortcuts.value,
      order: 2
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Tabs'),
      shortcutDictionary: tabAppShortcuts.value,
      order: 4
    },
    {
      title: t('KeyboardShortcutPrompt.Sections.App.Window and View'),
      shortcutDictionary: windowAndViewAppShortcuts.value,
      order: 6
    }
  ]
])

const isMac = process.platform === 'darwin'

const localizedShortcutNameToShortcutsMappings = computed(() => {
  return [
    [t('KeyboardShortcutPrompt.Show Keyboard Shortcuts'), ['SHOW_SHORTCUTS']],
    [t('KeyboardShortcutPrompt.History Backward'), [
      'HISTORY_BACKWARD',
      ...isMac ? ['HISTORY_BACKWARD_ALT_MAC'] : [],
    ]],
    [t('KeyboardShortcutPrompt.History Forward'), [
      'HISTORY_FORWARD',
      ...isMac ? ['HISTORY_FORWARD_ALT_MAC'] : [],
    ]],
    [t('KeyboardShortcutPrompt.Navigate to Settings'), ['NAVIGATE_TO_SETTINGS']],
    [t('KeyboardShortcutPrompt.Navigate to History'), [
      isMac ? 'NAVIGATE_TO_HISTORY_MAC' : 'NAVIGATE_TO_HISTORY',
    ]],
    [t('KeyboardShortcutPrompt.New Window'), ['NEW_WINDOW']],
    [t('KeyboardShortcutPrompt.New Tab'), ['NEW_TAB']],
    [t('KeyboardShortcutPrompt.Close Tab'), ['CLOSE_TAB']],
    [t('KeyboardShortcutPrompt.Reload Tab'), ['RELOAD_TAB']],
    [t('KeyboardShortcutPrompt.Reopen Closed Tab'), ['RESTORE_CLOSED_TAB']],
    [t('KeyboardShortcutPrompt.Next Tab'), ['NEXT_TAB']],
    [t('KeyboardShortcutPrompt.Previous Tab'), ['PREV_TAB']],
    [t('KeyboardShortcutPrompt.Switch to Tab'), ['SWITCH_TO_TAB']],
    [t('KeyboardShortcutPrompt.Minimize Window'), ['MINIMIZE_WINDOW']],
    [t('KeyboardShortcutPrompt.Toggle Developer Tools'), ['TOGGLE_DEVTOOLS']],
    [t('KeyboardShortcutPrompt.Reset Zoom'), ['RESET_ZOOM']],
    [t('KeyboardShortcutPrompt.Zoom In'), ['ZOOM_IN']],
    [t('KeyboardShortcutPrompt.Zoom Out'), ['ZOOM_OUT']],
    [t('KeyboardShortcutPrompt.Focus Search'), [
      'FOCUS_SEARCH',
      'FOCUS_SEARCH_ALT',
      'FOCUS_SEARCH_ALT_SLASH',
    ]],
    [t('KeyboardShortcutPrompt.Search in New Window'), ['SEARCH_IN_NEW_WINDOW']],
    [t('KeyboardShortcutPrompt.Find in Page'), ['FIND_IN_PAGE']],
    [t('KeyboardShortcutPrompt.Find Next Match'), ['FIND_NEXT', 'FIND_NEXT_ALT', 'FIND_NEXT_ALT_ENTER']],
    [t('KeyboardShortcutPrompt.Find Previous Match'), ['FIND_PREVIOUS', 'FIND_PREVIOUS_ALT', 'FIND_PREVIOUS_ALT_ENTER']],

    [t('KeyboardShortcutPrompt.Refresh'), ['REFRESH']],

    [t('KeyboardShortcutPrompt.Captions'), ['CAPTIONS']],
    [t('KeyboardShortcutPrompt.Theatre Mode'), ['THEATRE_MODE']],
    [t('KeyboardShortcutPrompt.Fullscreen'), ['FULLSCREEN']],
    [t('KeyboardShortcutPrompt.Full Window'), ['FULLWINDOW']],
    [t('KeyboardShortcutPrompt.Picture in Picture'), ['PICTURE_IN_PICTURE']],
    [t('KeyboardShortcutPrompt.Mute'), ['MUTE']],
    [t('KeyboardShortcutPrompt.Volume Up'), ['VOLUME_UP']],
    [t('KeyboardShortcutPrompt.Volume Down'), ['VOLUME_DOWN']],
    [t('KeyboardShortcutPrompt.Take Screenshot'), ['TAKE_SCREENSHOT']],
    [t('KeyboardShortcutPrompt.Stats'), ['STATS']],

    [t('KeyboardShortcutPrompt.Play'), ['PLAY']],
    [t('KeyboardShortcutPrompt.Large Rewind'), ['LARGE_REWIND']],
    [t('KeyboardShortcutPrompt.Large Fast Forward'), ['LARGE_FAST_FORWARD']],
    [t('KeyboardShortcutPrompt.Small Rewind'), ['SMALL_REWIND']],
    [t('KeyboardShortcutPrompt.Small Fast Forward'), ['SMALL_FAST_FORWARD']],
    [t('KeyboardShortcutPrompt.Decrease Video Speed'), ['DECREASE_VIDEO_SPEED', 'DECREASE_VIDEO_SPEED_ALT']],
    [t('KeyboardShortcutPrompt.Increase Video Speed'), ['INCREASE_VIDEO_SPEED', 'INCREASE_VIDEO_SPEED_ALT']],
    [t('KeyboardShortcutPrompt.Toggle Normal Playback Speed'), ['TOGGLE_NORMAL_PLAYBACK_SPEED']],
    [t('KeyboardShortcutPrompt.Home'), ['HOME']],
    [t('KeyboardShortcutPrompt.End'), ['END']],
    [t('KeyboardShortcutPrompt.Skip by Tenths'), ['SKIP_N_TENTHS']],
    [t('KeyboardShortcutPrompt.Last Chapter'), ['LAST_CHAPTER']],
    [t('KeyboardShortcutPrompt.Next Chapter'), ['NEXT_CHAPTER']],
    [t('KeyboardShortcutPrompt.Last Frame'), ['LAST_FRAME']],
    [t('KeyboardShortcutPrompt.Next Frame'), ['NEXT_FRAME']],
    [t('KeyboardShortcutPrompt.Skip to Next Video'), ['SKIP_TO_NEXT']],
    [t('KeyboardShortcutPrompt.Skip to Previous Video'), ['SKIP_TO_PREV']],
  ]
})

function hideKeyboardShortcutPrompt() {
  store.dispatch('hideKeyboardShortcutPrompt')
}

function getLocalizedShortcutNamesAndValues(dictionary, includedShortcutCodes = Object.keys(dictionary)) {
  const shortcutNameToShortcutsMappings = localizedShortcutNameToShortcutsMappings.value
  const shortcutLabelSeparator = t('shortcutLabelSeparator')
  const includedShortcutCodeSet = new Set(includedShortcutCodes)

  return shortcutNameToShortcutsMappings
    .filter(([_localizedShortcutName, shortcutCodes]) =>
      shortcutCodes.some(shortcutCode =>
        includedShortcutCodeSet.has(shortcutCode) && Object.hasOwn(dictionary, shortcutCode)
      )
    )
    .map(([localizedShortcutName, shortcutCodes]) => {
      const localizedShortcuts = shortcutCodes
        .filter(code => includedShortcutCodeSet.has(code) && Object.hasOwn(dictionary, code))
        .map(code => getLocalizedShortcut(dictionary[code]))
      return [localizedShortcutName, localizedShortcuts.join(shortcutLabelSeparator)]
    })
}

</script>

<style scoped src="./FtKeyboardShortcutPrompt.css" />
