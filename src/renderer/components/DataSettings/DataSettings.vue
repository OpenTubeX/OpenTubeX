<template>
  <FtSettingsSection
    :title="$t('Settings.Data Settings.Data Settings')"
  >
    <h4 class="groupTitle">
      {{ $t('Subscriptions.Subscriptions') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="$t('Settings.Data Settings.Import Subscriptions')"
        :icon="['fas', 'folder-open']"
        @click="importSubscriptions"
      />
      <FtButton
        :label="$t('Settings.Data Settings.Manage Subscriptions')"
        :icon="['fas', 'users']"
        @click="openProfileSettings"
      />
      <FtButton
        :label="$t('Settings.Data Settings.Export Subscriptions')"
        :icon="['fas', 'file-download']"
        @click="showExportSubscriptionsPrompt = true"
      />
    </FtFlexBox>
    <p class="importFormatsHint">
      {{ t('Settings.Data Settings.Import subscriptions formats') }}
    </p>
    <FtFlexBox>
      <p>
        <a href="https://docs.freetubeapp.io/usage/importing-subscriptions/">
          {{ $t("Settings.Data Settings.How do I import my subscriptions?") }}
        </a>
      </p>
    </FtFlexBox>
    <h4 class="groupTitle">
      {{ $t('History.History') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="$t('Settings.Data Settings.Import History')"
        :icon="['fas', 'folder-open']"
        @click="importWatchHistory"
      />
      <FtButton
        :label="$t('Settings.Data Settings.Export History')"
        :icon="['fas', 'file-download']"
        @click="showExportWatchHistoryPrompt = true"
      />
    </FtFlexBox>
    <p class="importFormatsHint">
      {{ t('Settings.Data Settings.Import history formats') }}
    </p>
    <h4 class="groupTitle">
      {{ $t('Playlists') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="$t('Settings.Data Settings.Import Playlists')"
        :icon="['fas', 'folder-open']"
        @click="importPlaylists"
      />
      <FtButton
        :label="$t('Settings.Data Settings.Export Playlists')"
        :icon="['fas', 'file-download']"
        @click="exportPlaylists"
      />
    </FtFlexBox>
    <p class="importFormatsHint">
      {{ t('Settings.Data Settings.Import playlists formats') }}
    </p>
    <h4 class="groupTitle">
      {{ t('Settings.Data Settings.Search history') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="t('Settings.Data Settings.Import search history')"
        :icon="['fas', 'folder-open']"
        @click="importSearchHistory"
      />
      <FtButton
        :label="t('Settings.Data Settings.Export search history')"
        :icon="['fas', 'file-download']"
        @click="showExportSearchHistoryPrompt = true"
      />
    </FtFlexBox>
    <p class="importFormatsHint">
      {{ t('Settings.Data Settings.Import search history formats') }}
    </p>
    <h4 class="groupTitle">
      {{ t('Settings.Settings') }}
      <FtTooltip
        class="selectTooltip"
        position="top"
        :tooltip="t('Settings.Data Settings.Settings Tooltip')"
      />
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="t('Settings.Data Settings.Import Settings')"
        :icon="['fas', 'folder-open']"
        @click="importSettings"
      />
      <FtButton
        :label="t('Settings.Data Settings.Export Settings')"
        :icon="['fas', 'file-download']"
        @click="exportSettings"
      />
    </FtFlexBox>
    <template v-if="isElectron">
      <h4 class="groupTitle">
        {{ t('Settings.Data Settings.Profile Directory') }}
      </h4>
      <FtFlexBox class="box">
        <FtButton
          :label="t('Settings.Data Settings.Open Profile Directory')"
          :icon="['fas', 'folder-open']"
          @click="openProfileDirectory"
        />
      </FtFlexBox>
    </template>
    <FtSettingsSubpage
      :open="showExportSubscriptionsPrompt"
      :title="t('Settings.Data Settings.Select Export Type')"
      :icon="['fas', 'file-download']"
      @close="showExportSubscriptionsPrompt = false"
    >
      <FtFlexBox class="exportTypeButtons">
        <FtButton
          v-for="(name, index) in exportSubscriptionsPromptNames.slice(0, SUBSCRIPTIONS_PROMPT_VALUES.length - 1)"
          :key="SUBSCRIPTIONS_PROMPT_VALUES[index]"
          :label="name"
          :icon="['fas', 'file-download']"
          @click="exportSubscriptions(SUBSCRIPTIONS_PROMPT_VALUES[index])"
        />
      </FtFlexBox>
    </FtSettingsSubpage>
    <FtSettingsSubpage
      :open="showExportWatchHistoryPrompt"
      :title="t('Settings.Data Settings.Select Export Type')"
      :icon="['fas', 'file-download']"
      @close="showExportWatchHistoryPrompt = false"
    >
      <FtFlexBox class="exportTypeButtons">
        <FtButton
          v-for="(name, index) in exportWatchSearchHistoryPromptNames.slice(0, WATCH_SEARCH_HISTORY_PROMPT_VALUES.length)"
          :key="WATCH_SEARCH_HISTORY_PROMPT_VALUES[index]"
          :label="name"
          :icon="['fas', 'file-download']"
          @click="exportWatchHistory(WATCH_SEARCH_HISTORY_PROMPT_VALUES[index])"
        />
      </FtFlexBox>
    </FtSettingsSubpage>
    <FtSettingsSubpage
      :open="showExportSearchHistoryPrompt"
      :title="t('Settings.Data Settings.Select Export Type')"
      :icon="['fas', 'file-download']"
      @close="showExportSearchHistoryPrompt = false"
    >
      <FtFlexBox class="exportTypeButtons">
        <FtButton
          v-for="(name, index) in exportWatchSearchHistoryPromptNames.slice(0, WATCH_SEARCH_HISTORY_PROMPT_VALUES.length)"
          :key="WATCH_SEARCH_HISTORY_PROMPT_VALUES[index]"
          :label="name"
          :icon="['fas', 'file-download']"
          @click="exportSearchHistory(WATCH_SEARCH_HISTORY_PROMPT_VALUES[index])"
        />
      </FtFlexBox>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'

import store from '../../store/index'
import { defaultUpdaterId, NON_TRANSFERABLE_SETTINGS } from '../../store/modules/settings'
import { migrateLegacySettings } from '../../helpers/settings-migrations'

import { MAIN_PROFILE_ID } from '../../../constants'
import { calculateColorLuminance, getRandomColor } from '../../helpers/colors'
import {
  deepCopy,
  escapeHTML,
  getTodayDateStrLocalTimezone,
  readFileWithPicker,
  showToast,
  writeFileWithPicker,
} from '../../helpers/utils'
import { processToBeAddedPlaylistVideo } from '../../helpers/playlists'
import {
  convertLibreTubeSubscriptions,
  convertLibreTubeWatchHistoryToOpenTubeX,
  detectSubscriptionJsonFormat,
  extractChannelIdFromUploaderUrl,
  getLibreTubeSubscriptions,
  isLibreTubeWatchHistoryBackup,
} from '../../helpers/libretube'
import { parseLineDelimitedJson } from '../../helpers/line-delimited-json'

const IMPORT_DIRECTORY_ID = 'data-settings-import'
const START_IN_DIRECTORY = 'downloads'
const isElectron = process.env.IS_ELECTRON

const { t } = useI18n()

function openProfileDirectory() {
  window.ftElectron.openProfileDirectory()
}

function openProfileSettings() {
  store.dispatch('showSettingsWindow', 'profile')
}

/**
 * @param {string} fileName
 * @param {string | Blob} content
 * @param {string} fileTypeDescription
 * @param {string} mimeType
 * @param {string} fileExtension
 * @param {string} successMessage
 */
async function promptAndWriteToFile(
  fileName,
  content,
  fileTypeDescription,
  mimeType,
  fileExtension,
  successMessage
) {
  try {
    const response = await writeFileWithPicker(
      fileName,
      content,
      fileTypeDescription,
      mimeType,
      fileExtension,
      'data-settings-export',
      START_IN_DIRECTORY
    )

    if (response) {
      showToast({ message: successMessage, icon: ['fas', 'check'] })
    }
  } catch (error) {
    const message = t('Settings.Data Settings.Unable to write file')
    showToast({ message: `${message}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  }
}

/**
 * @param {string} content
 * @param {string} invalidMessage
 */
function parseImportedJson(content, invalidMessage) {
  try {
    return JSON.parse(content)
  } catch (error) {
    console.error('Unable to parse imported JSON file', error)
    showToast({ message: invalidMessage, icon: ['fas', 'circle-exclamation'] })
    return null
  }
}

/**
 * @param {string} content
 * @returns {unknown[]}
 */
function parseImportedLineDelimitedJson(content) {
  const { records, errors } = parseLineDelimitedJson(content)

  errors.forEach((error) => {
    console.error('Unable to parse imported JSON row', error)
    showToast({
      message: t('Settings.Data Settings.Invalid JSON row, skipping item', { row: error.rowNumber }),
      icon: ['fas', 'circle-exclamation'],
    })
  })

  return records
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const SUBSCRIPTIONS_PROMPT_VALUES = [
  'freetube',
  'youtubenew',
  'youtube',
  'youtubeold',
  'newpipe',
  'close'
]

const exportSubscriptionsPromptNames = computed(() => {
  const exportFreeTube = t('Settings.Data Settings.Export OpenTubeX')
  const exportYouTube = t('Settings.Data Settings.Export YouTube')
  const exportNewPipe = t('Settings.Data Settings.Export NewPipe')

  return [
    `${exportFreeTube} (.db)`,
    `${exportYouTube} (.csv)`,
    `${exportYouTube} (.json)`,
    `${exportYouTube} (.opml)`,
    `${exportNewPipe} (.json)`,
    t('Close')
  ]
})

const profileList = computed(() => store.getters.getProfileList)
const primaryProfile = computed(() => deepCopy(profileList.value[0]))

// #region subscriptions import

async function importSubscriptions() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.Subscription File'),
      {
        'application/x-freetube-db': '.db',
        'text/csv': '.csv',
        'application/json': '.json',
        'application/xml': ['.xml', '.opml']
      },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
  } catch (err) {
    const message = t('Settings.Data Settings.Unable to read file')
    showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (response === null) {
    return
  }

  const { filename, content } = response

  if (filename.endsWith('.csv')) {
    importCsvYouTubeSubscriptions(content)
  } else if (filename.endsWith('.db')) {
    importFreeTubeSubscriptions(parseImportedLineDelimitedJson(content))
  } else if (filename.endsWith('.opml') || filename.endsWith('.xml')) {
    importOpmlYouTubeSubscriptions(content)
  } else if (filename.endsWith('.json')) {
    const jsonContent = parseImportedJson(content, t('Settings.Data Settings.Invalid subscriptions file'))
    if (jsonContent === null) {
      return
    }

    const subscriptionFormat = detectSubscriptionJsonFormat(jsonContent)

    switch (subscriptionFormat) {
      case 'libretube-backup':
        importLibreTubeSubscriptions(getLibreTubeSubscriptions(jsonContent))
        break
      case 'libretube-freetube':
        importLibreTubeSubscriptions(jsonContent.subscriptions)
        break
      case 'newpipe':
        importNewPipeSubscriptions(jsonContent)
        break
      case 'youtube':
        importYouTubeSubscriptions(jsonContent)
        break
      default:
        showToast({
          message: t('Settings.Data Settings.Invalid subscriptions file'),
          icon: ['fas', 'circle-exclamation'],
        })
    }
  }
}

/**
 * @param {string | null} channelId
 * @param {{ id: string, name: string, thumbnail: string | null }[]} subscriptions
 */
function isChannelSubscribed(channelId, subscriptions) {
  if (channelId === null) { return true }

  const subExists = primaryProfile.value.subscriptions.some((sub) => {
    return sub.id === channelId
  })

  const subDuplicateExists = subscriptions.some((sub) => {
    return sub.id === channelId
  })

  return subExists || subDuplicateExists
}

/**
 * @param {any[]} oldData
 */
function convertOldFreeTubeFormatToNew(oldData) {
  const convertedData = []
  for (const channel of oldData) {
    const listOfProfilesAlreadyAdded = []
    for (const profile of channel.profile) {
      let index = convertedData.findIndex(p => p.name === profile.value)
      if (index === -1) { // profile doesn't exist yet
        const randomBgColor = getRandomColor().value
        const contrastyTextColor = calculateColorLuminance(randomBgColor)
        convertedData.push({
          name: profile.value,
          bgColor: randomBgColor,
          textColor: contrastyTextColor,
          subscriptions: [],
          _id: channel._id
        })
        index = convertedData.length - 1
      } else if (listOfProfilesAlreadyAdded.includes(index)) {
        continue
      }
      listOfProfilesAlreadyAdded.push(index)
      convertedData[index].subscriptions.push({
        id: channel.channelId,
        name: channel.channelName,
        thumbnail: channel.channelThumbnail
      })
    }
  }
  return convertedData
}

/**
 * @param {unknown[]} profileRecords
 */
function importFreeTubeSubscriptions(profileRecords) {
  const firstEntry = profileRecords[0]
  if (
    isJsonObject(firstEntry) &&
    firstEntry.channelId &&
    firstEntry.channelName &&
    firstEntry.channelThumbnail &&
    firstEntry._id &&
    firstEntry.profile
  ) {
    // Old FreeTube subscriptions format detected, so convert it to the new one:
    profileRecords = convertOldFreeTubeFormatToNew(profileRecords)
  }

  const requiredKeys = [
    '_id',
    'name',
    'bgColor',
    'textColor',
    'subscriptions'
  ]
  const optionalKeys = [
    'icon'
  ]
  const knownKeys = [...requiredKeys, ...optionalKeys]
  const updatedPrimaryProfile = primaryProfile.value
  let shouldUpdatePrimaryProfile = false

  profileRecords.forEach((profileData) => {
    // We would technically already be done by the time the data is parsed,
    // however we want to limit the possibility of malicious data being sent
    // to the app, so we'll only grab the data we need here.

    if (!isJsonObject(profileData)) {
      const message = t('Settings.Data Settings.Profile object has insufficient data, skipping item')
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      return
    }

    const profileObject = {}
    Object.keys(profileData).forEach((key) => {
      if (!knownKeys.includes(key)) {
        const message = t('Settings.Data Settings.Unknown data key')
        showToast({ message: `${message}: ${key}`, icon: ['fas', 'circle-exclamation'] })
      } else {
        profileObject[key] = profileData[key]
      }
    })

    const hasAllRequiredKeys = requiredKeys.every(key => Object.hasOwn(profileObject, key))
    if (!hasAllRequiredKeys) {
      const message = t('Settings.Data Settings.Profile object has insufficient data, skipping item')
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
    } else {
      if (profileObject._id === MAIN_PROFILE_ID) {
        if (Object.hasOwn(profileObject, 'icon')) {
          updatedPrimaryProfile.icon = profileObject.icon
        }
      } else {
        const existingProfileIndex = profileList.value.findIndex((profile) => {
          return profile._id !== MAIN_PROFILE_ID && profile.name === profileObject.name
        })

        if (existingProfileIndex !== -1) {
          const existingProfile = deepCopy(profileList.value[existingProfileIndex])
          if (Object.hasOwn(profileObject, 'icon')) {
            existingProfile.icon = profileObject.icon
          }
          existingProfile.subscriptions = existingProfile.subscriptions.concat(profileObject.subscriptions)
          existingProfile.subscriptions = existingProfile.subscriptions.filter((sub, index) => {
            const profileIndex = existingProfile.subscriptions.findIndex((x) => {
              return x.id === sub.id
            })

            return profileIndex === index
          })
          store.dispatch('updateProfile', existingProfile)
        } else {
          const hasProfileIdCollision = profileList.value.some((profile) => {
            return profile._id === profileObject._id
          })

          if (hasProfileIdCollision) {
            const newProfile = { ...profileObject }
            delete newProfile._id
            store.dispatch('createProfile', newProfile)
          } else {
            store.dispatch('updateProfile', profileObject)
          }
        }
      }

      updatedPrimaryProfile.subscriptions = updatedPrimaryProfile.subscriptions.concat(profileObject.subscriptions)
      updatedPrimaryProfile.subscriptions = updatedPrimaryProfile.subscriptions.filter((sub, index) => {
        const profileIndex = updatedPrimaryProfile.subscriptions.findIndex((x) => {
          return x.id === sub.id
        })

        return profileIndex === index
      })
      shouldUpdatePrimaryProfile = true
    }
  })

  if (shouldUpdatePrimaryProfile) {
    store.dispatch('updateProfile', updatedPrimaryProfile)
  }

  showToast({
    message: t('Settings.Data Settings.All subscriptions and profiles have been successfully imported'),
    icon: ['fas', 'rss'],
  })
}

/**
 * @param {string} textDecode
 */
function importCsvYouTubeSubscriptions(textDecode) { // first row = header, last row = empty
  const youtubeSubscriptions = textDecode.split('\n').filter(sub => {
    return sub !== ''
  })
  const subscriptions = []

  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)

  const splitCSVRegex = /(?:,|\n|^)("(?:(?:"")|[^"])*"|[^\n",]*|(?:\n|$))/g

  const ytsubs = youtubeSubscriptions.slice(1).map(yt => {
    return [...yt.matchAll(splitCSVRegex)].map(s => {
      let newVal = s[1]
      if (newVal.startsWith('"')) {
        newVal = newVal.substring(1, newVal.length - 1).replaceAll('""', '"')
      }
      return newVal
    })
  }).filter(channel => {
    return channel.length > 0
  })

  ytsubs.forEach((yt) => {
    const channelId = yt[0]
    if (!isChannelSubscribed(channelId, subscriptions)) {
      const subscription = {
        id: channelId,
        name: yt[2],
        thumbnail: null
      }

      subscriptions.push(subscription)
    }
  })

  primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(subscriptions)
  store.dispatch('updateProfile', primaryProfile.value)
  showToast({
    message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
    icon: ['fas', 'rss'],
  })
  store.commit('setShowProgressBar', false)
}

/**
 * @param {object} textDecode
 */
function importYouTubeSubscriptions(textDecode) {
  const subscriptions = []
  let count = 0

  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)

  textDecode.forEach((channel) => {
    const snippet = channel.snippet
    if (typeof snippet === 'undefined') {
      const message = t('Settings.Data Settings.Invalid subscriptions file')
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      throw new Error('Unable to find channel data')
    }

    const channelId = snippet.resourceId.channelId
    if (!isChannelSubscribed(channelId, subscriptions)) {
      subscriptions.push({
        id: channelId,
        name: snippet.title,
        thumbnail: snippet.thumbnails.default.url
      })
    }

    count++

    const progressPercentage = (count / (textDecode.length - 1)) * 100
    store.commit('setProgressBarPercentage', progressPercentage)
  })

  primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(subscriptions)
  store.dispatch('updateProfile', primaryProfile.value)
  showToast({
    message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
    icon: ['fas', 'rss'],
  })
  store.commit('setShowProgressBar', false)
}

/**
 * @param {string} data
 */
function importOpmlYouTubeSubscriptions(data) {
  let xmlDom
  const domParser = new DOMParser()
  try {
    xmlDom = domParser.parseFromString(data, 'application/xml')

    // https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString#error_handling
    const errorNode = xmlDom.querySelector('parsererror')
    if (errorNode) {
      throw errorNode.textContent
    }
  } catch (err) {
    console.error('error reading OPML subscriptions file, falling back to HTML parser...')
    console.error(err)
    // try parsing with the html parser instead which is more lenient
    try {
      const htmlDom = domParser.parseFromString(data, 'text/html')

      xmlDom = htmlDom
    } catch {
      const message = t('Settings.Data Settings.Invalid subscriptions file')
      showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
      return
    }
  }

  const feedData = xmlDom.querySelectorAll('body outline[xmlUrl]')
  if (feedData.length === 0) {
    const message = t('Settings.Data Settings.Invalid subscriptions file')
    showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
    return
  }

  const subscriptions = []

  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)

  let count = 0

  feedData.forEach((channel) => {
    const xmlUrl = channel.getAttribute('xmlUrl')
    const channelName = channel.getAttribute('title')
    let channelId
    if (xmlUrl.includes('https://www.youtube.com/feeds/videos.xml?channel_id=')) {
      channelId = new URL(xmlUrl).searchParams.get('channel_id')
    } else if (xmlUrl.includes('/feed/channel/')) {
      // handle invidious exports https://yewtu.be/feed/channel/{CHANNELID}
      channelId = new URL(xmlUrl).pathname.split('/').filter(part => part).at(-1)
    } else {
      console.error(`Unknown xmlUrl format: ${xmlUrl}`)
    }

    if (!isChannelSubscribed(channelId, subscriptions)) {
      const subscription = {
        id: channelId,
        name: channelName,
        thumbnail: null
      }
      subscriptions.push(subscription)
    }

    count++

    const progressPercentage = (count / feedData.length) * 100
    store.commit('setProgressBarPercentage', progressPercentage)
  })

  primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(subscriptions)
  store.dispatch('updateProfile', primaryProfile.value)
  showToast({
    message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
    icon: ['fas', 'rss'],
  })
  store.commit('setShowProgressBar', false)
}

/**
 * @param {object[]} libreTubeSubscriptions
 */
function importLibreTubeSubscriptions(libreTubeSubscriptions) {
  const subscriptions = convertLibreTubeSubscriptions(libreTubeSubscriptions)

  if (subscriptions.length === 0) {
    showToast({ message: t('Settings.Data Settings.Invalid subscriptions file'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  mergeSubscriptionsIntoPrimaryProfile(subscriptions)
}

/**
 * @param {{ id: string, name: string, thumbnail: string | null }[]} subscriptions
 */
function mergeSubscriptionsIntoPrimaryProfile(subscriptions) {
  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)

  const newSubscriptions = []

  subscriptions.forEach((channel, index) => {
    if (!isChannelSubscribed(channel.id, newSubscriptions)) {
      newSubscriptions.push(channel)
    }

    const progressPercentage = ((index + 1) / subscriptions.length) * 100
    store.commit('setProgressBarPercentage', progressPercentage)
  })

  primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(newSubscriptions)
  store.dispatch('updateProfile', primaryProfile.value)
  showToast({
    message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
    icon: ['fas', 'rss'],
  })
  store.commit('setShowProgressBar', false)
}

/**
 * @param {object} newPipeData
 */
function importNewPipeSubscriptions(newPipeData) {
  if (typeof newPipeData.subscriptions === 'undefined') {
    showToast({ message: t('Settings.Data Settings.Invalid subscriptions file'), icon: ['fas', 'circle-exclamation'] })

    return
  }

  const subscriptions = newPipeData.subscriptions
    .map((channel) => {
      const channelId = extractChannelIdFromUploaderUrl(channel.url)

      if (!channelId) {
        return null
      }

      return {
        id: channelId,
        name: channel.name,
        thumbnail: null,
      }
    })
    .filter(subscription => subscription !== null)

  mergeSubscriptionsIntoPrimaryProfile(subscriptions)
}

// #endregion subscriptions import

// #region subscriptions export

const showExportSubscriptionsPrompt = ref(false)

/**
 * @param {'freetube' | 'youtubenew' | 'youtube' | 'youtubeold' | 'newpipe' | 'close' | null} option
 */
function exportSubscriptions(option) {
  showExportSubscriptionsPrompt.value = false

  if (option === null) {
    return
  }

  switch (option) {
    case 'freetube':
      exportFreeTubeSubscriptions()
      break
    case 'youtubenew':
      exportCsvYouTubeSubscriptions()
      break
    case 'youtube':
      exportYouTubeSubscriptions()
      break
    case 'youtubeold':
      exportOpmlYouTubeSubscriptions()
      break
    case 'newpipe':
      exportNewPipeSubscriptions()
      break
  }
}

async function exportFreeTubeSubscriptions() {
  const subscriptionsDb = profileList.value.map((profile) => {
    return JSON.stringify(profile)
  }).join('\n') + '\n'
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'opentubex-subscriptions-' + dateStr + '.db'

  await promptAndWriteToFile(
    exportFileName,
    subscriptionsDb,
    t('Settings.Data Settings.Subscription File'),
    'application/x-freetube-db',
    '.db',
    t('Settings.Data Settings.Subscriptions have been successfully exported')
  )
}

async function exportYouTubeSubscriptions() {
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'youtube-subscriptions-' + dateStr + '.json'

  const subscriptionsObject = profileList.value[0].subscriptions.map((channel) => {
    const object = {
      contentDetails: {
        activityType: 'all',
        newItemCount: 0,
        totalItemCount: 0
      },
      etag: '',
      id: '',
      kind: 'youtube#subscription',
      snippet: {
        channelId: channel.id,
        description: '',
        publishedAt: new Date(),
        resourceId: {
          channelId: channel.id,
          kind: 'youtube#channel'
        },
        thumbnails: {
          default: {
            url: channel.thumbnail
          },
          high: {
            url: channel.thumbnail
          },
          medium: {
            url: channel.thumbnail
          }
        },
        title: channel.name
      }
    }

    return object
  })

  await promptAndWriteToFile(
    exportFileName,
    JSON.stringify(subscriptionsObject),
    t('Settings.Data Settings.Subscription File'),
    'application/json',
    '.json',
    t('Settings.Data Settings.Subscriptions have been successfully exported')
  )
}

async function exportOpmlYouTubeSubscriptions() {
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'youtube-subscriptions-' + dateStr + '.opml'

  let opmlData = '<opml version="1.1"><body><outline text="YouTube Subscriptions" title="YouTube Subscriptions">'

  profileList.value[0].subscriptions.forEach((channel) => {
    const escapedName = escapeHTML(channel.name)

    const channelOpmlString = `<outline text="${escapedName}" title="${escapedName}" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}"/>`
    opmlData += channelOpmlString
  })

  opmlData += '</outline></body></opml>'

  await promptAndWriteToFile(
    exportFileName,
    opmlData,
    t('Settings.Data Settings.Subscription File'),
    'application/xml',
    '.opml',
    t('Settings.Data Settings.Subscriptions have been successfully exported')
  )
}

async function exportCsvYouTubeSubscriptions() {
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'youtube-subscriptions-' + dateStr + '.csv'

  let exportText = 'Channel ID,Channel URL,Channel title\n'
  profileList.value[0].subscriptions.forEach((channel) => {
    const channelUrl = `https://www.youtube.com/channel/${channel.id}`

    // always have channel name quoted to simplify things
    const channelName = `"${channel.name.replaceAll('"', '""')}"`
    exportText += `${channel.id},${channelUrl},${channelName}\n`
  })
  exportText += '\n'

  await promptAndWriteToFile(
    exportFileName,
    exportText,
    t('Settings.Data Settings.Subscription File'),
    'text/csv',
    '.csv',
    t('Settings.Data Settings.Subscriptions have been successfully exported')
  )
}

async function exportNewPipeSubscriptions() {
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'newpipe-subscriptions-' + dateStr + '.json'

  const newPipeObject = {
    app_version: '0.19.8',
    app_version_int: 953,
    subscriptions: []
  }

  profileList.value[0].subscriptions.forEach((channel) => {
    const channelUrl = `https://www.youtube.com/channel/${channel.id}`
    const subscription = {
      service_id: 0,
      url: channelUrl,
      name: channel.name
    }

    newPipeObject.subscriptions.push(subscription)
  })

  await promptAndWriteToFile(
    exportFileName,
    JSON.stringify(newPipeObject),
    t('Settings.Data Settings.Subscription File'),
    'application/json',
    '.json',
    t('Settings.Data Settings.Subscriptions have been successfully exported')
  )
}

// #endregion subscriptions export

const WATCH_SEARCH_HISTORY_PROMPT_VALUES = [
  'freetube',
  'youtube'
]

const exportWatchSearchHistoryPromptNames = computed(() => [
  `${t('Settings.Data Settings.Export OpenTubeX')} (.db)`,
  `${t('Settings.Data Settings.Export YouTube')} (.json)`,
  t('Close')
])

// #region watch history

const historyCacheById = computed(() => {
  return store.getters.getHistoryCacheById
})

const historyCacheSorted = computed(() => {
  return store.getters.getHistoryCacheSorted
})

async function importWatchHistory() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.History File'),
      {
        'application/x-freetube-db': '.db',
        'application/json': '.json'
      },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
  } catch (err) {
    const message = t('Settings.Data Settings.Unable to read file')
    showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (response === null) {
    return
  }

  const { filename, content } = response

  if (filename.endsWith('.db')) {
    importFreeTubeWatchHistory(parseImportedLineDelimitedJson(content))
  } else if (filename.endsWith('.json')) {
    const jsonContent = parseImportedJson(content, t('Settings.Data Settings.Invalid history file'))
    if (jsonContent === null) {
      return
    }

    if (isLibreTubeWatchHistoryBackup(jsonContent)) {
      importLibreTubeWatchHistory(jsonContent)
    } else if (Array.isArray(jsonContent)) {
      importYouTubeWatchHistory(jsonContent)
    } else {
      showToast({ message: t('Settings.Data Settings.Invalid history file'), icon: ['fas', 'circle-exclamation'] })
    }
  }
}

/**
 * @param {unknown[]} historyRecords
 */
async function importFreeTubeWatchHistory(historyRecords) {
  const requiredKeys = [
    'author',
    'authorId',
    'isLive',
    'lengthSeconds',
    'published',
    'timeWatched',
    'title',
    'type',
    'videoId',
    'watchProgress',
  ]

  const optionalKeys = [
    // `_id` absent if marked as watched manually
    '_id',
    'lastViewedPlaylistId',
    'lastViewedPlaylistItemId',
    'lastViewedPlaylistType',
    'isMembersOnly',
    'isWatched',
    'viewCount',
    'description',
  ]

  const ignoredKeys = [
    'paid',
  ]

  // deep copy so we don't get errors from Electron when we try to pass reactive objects through the IPC channels
  const historyItems = new Map(deepCopy(Object.entries(historyCacheById.value)))

  historyRecords.forEach((historyData) => {
    // We would technically already be done by the time the data is parsed,
    // however we want to limit the possibility of malicious data being sent
    // to the app, so we'll only grab the data we need here.

    if (!isJsonObject(historyData)) {
      showToast({
        message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error('Invalid history record:', historyData)
      return
    }

    const historyObject = {}

    Object.keys(historyData).forEach((key) => {
      if (requiredKeys.includes(key) || optionalKeys.includes(key)) {
        historyObject[key] = historyData[key]
      } else if (!ignoredKeys.includes(key)) {
        showToast({ message: `Unknown data key: ${key}`, icon: ['fas', 'circle-exclamation'] })
      }
      // Else do not import the key
    })

    const historyObjectKeysSet = new Set(Object.keys(historyObject))
    const missingKeys = requiredKeys.filter(x => !historyObjectKeysSet.has(x))
    if (missingKeys.length > 0) {
      showToast({
        message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error('Missing Keys: ', missingKeys, historyData)
    } else {
      // FreeTube history export does not have this data if the video was marked as watched manually, setting default value
      historyObject.description = historyObject.description ?? ''

      historyItems.set(historyObject.videoId, historyObject)
    }
  })

  await store.dispatch('overwriteHistory', historyItems)

  showToast({
    message: t('Settings.Data Settings.All watched history has been successfully imported'),
    icon: ['fas', 'history'],
  })
}

/**
 * @param {object} backupData
 */
async function importLibreTubeWatchHistory(backupData) {
  if (backupData.watchHistory.length === 0) {
    showToast({ message: t('Settings.Data Settings.Invalid history file'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  const historyItems = new Map(deepCopy(Object.entries(historyCacheById.value)))
  const {
    historyItems: convertedHistoryItems,
    importedCount,
    skippedCount,
  } = convertLibreTubeWatchHistoryToOpenTubeX(
    backupData,
    historyItems
  )

  if (importedCount === 0) {
    showToast({ message: t('Settings.Data Settings.Invalid history file'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (skippedCount > 0) {
    showToast({
      message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
      icon: ['fas', 'circle-exclamation'],
    })
  }

  await store.dispatch('overwriteHistory', convertedHistoryItems)

  showToast({
    message: t('Settings.Data Settings.All watched history has been successfully imported'),
    icon: ['fas', 'history'],
  })
}

/**
 * @param {any[]} historyData
 */
async function importYouTubeWatchHistory(historyData) {
  const filterPredicate = item =>
    item.products.includes('YouTube') &&
    item.titleUrl != null && // removed video doesnt contain url...
    item.titleUrl.includes('www.youtube.com/watch?v') &&
    item.details == null // dont import ads

  const filteredHistoryData = historyData.filter(filterPredicate)

  // remove 'Watched' and translated variants from start of title
  // so we get the common string prefix for all the titles
  const getCommonStart = (allTitles) => {
    if (allTitles.length < 2) {
      return ''
    }

    let commonStart = allTitles[0]
    for (let i = 1; i < allTitles.length; i++) {
      while (!allTitles[i].startsWith(commonStart)) {
        commonStart = commonStart.slice(0, -1)
        if (commonStart === '') {
          return ''
        }
      }
    }

    return commonStart
  }

  const commonStart = getCommonStart(filteredHistoryData.map(e => e.title))
  // We would technically already be done by the time the data is parsed,
  // however we want to limit the possibility of malicious data being sent
  // to the app, so we'll only grab the data we need here.

  const keyMapping = {
    title: [{ importKey: 'title', predicate: item => item.slice(commonStart.length) }], // Removes the "Watched " term on the title
    titleUrl: [{ importKey: 'videoId', predicate: item => item.replaceAll(/https:\/\/www\.youtube\.com\/watch\?v=/gi, '') }], // Extracts the video ID
    time: [{ importKey: 'timeWatched', predicate: item => new Date(item).valueOf() }],
    subtitles: [
      { importKey: 'author', predicate: item => item[0].name ?? '' },
      { importKey: 'authorId', predicate: item => item[0].url?.replaceAll(/https:\/\/www\.youtube\.com\/channel\//gi, '') ?? '' },
    ],
  }

  const knownKeys = [
    'header',
    'description',
    'products',
    'details',
    'activityControls',
  ].concat(Object.keys(keyMapping))

  // deep copy so we don't get errors from Electron when we try to pass reactive objects through the IPC channels
  const historyItems = new Map(deepCopy(Object.entries(historyCacheById.value)))

  filteredHistoryData.forEach(element => {
    const historyObject = {}

    Object.keys(element).forEach((key) => {
      if (!knownKeys.includes(key)) {
        showToast({ message: `Unknown data key: ${key}`, icon: ['fas', 'circle-exclamation'] })
      } else {
        const mapping = keyMapping[key]

        if (mapping && Array.isArray(mapping)) {
          mapping.forEach(item => {
            historyObject[item.importKey] = item.predicate(element[key])
          })
        }
      }
    })

    if (Object.keys(historyObject).length < keyMapping.length - 1) {
      showToast({
        message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
    } else {
      // YouTube history export does not have this data, setting some defaults.
      historyObject.type = 'video'
      historyObject.published = historyObject.timeWatched ?? 1
      historyObject.description = ''
      historyObject.lengthSeconds = null
      historyObject.watchProgress = 1
      historyObject.isWatched = true
      historyObject.isLive = false

      historyItems.set(historyObject.videoId, historyObject)
    }
  })

  await store.dispatch('overwriteHistory', historyItems)

  showToast({
    message: t('Settings.Data Settings.All watched history has been successfully imported'),
    icon: ['fas', 'history'],
  })
}

const showExportWatchHistoryPrompt = ref(false)

/**
 * @param {'freetube' | 'youtube' | null} option
 */
async function exportWatchHistory(option) {
  showExportWatchHistoryPrompt.value = false

  switch (option) {
    case 'freetube':
      exportFreeTubeWatchHistory()
      break
    case 'youtube':
      exportYouTubeWatchHistory()
      break
  }
}

async function exportFreeTubeWatchHistory() {
  const historyDb = historyCacheSorted.value.map((historyEntry) => {
    return JSON.stringify(historyEntry)
  }).join('\n') + '\n'
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'opentubex-watch-history-' + dateStr + '.db'

  await promptAndWriteToFile(
    exportFileName,
    historyDb,
    t('Settings.Data Settings.History File'),
    'application/x-freetube-db',
    '.db',
    t('Settings.Data Settings.All watched history has been successfully exported')
  )
}

async function exportYouTubeWatchHistory() {
  const historyData = historyCacheSorted.value.map((entry) => {
    return {
      header: 'YouTube',
      title: `Watched ${entry.title}`,
      titleUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
      subtitles: [{
        name: entry.author,
        url: `https://www.youtube.com/channel/${entry.authorId}`
      }],
      time: new Date(entry.timeWatched).toISOString(),
      products: [
        'YouTube'
      ],
      activityControls: [
        'YouTube watch history'
      ]
    }
  })

  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'youtube-watch-history-' + dateStr + '.json'

  await promptAndWriteToFile(
    exportFileName,
    JSON.stringify(historyData),
    t('Settings.Data Settings.History File'),
    'application/json',
    '.json',
    t('Settings.Data Settings.All watched history has been successfully exported')
  )
}

// #endregion watch history

// #region playlists

const allPlaylists = computed(() => store.getters.getAllPlaylists)

async function importPlaylists() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.Playlist File'),
      {
        'application/x-freetube-db': '.db'
      },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
  } catch (err) {
    const message = t('Settings.Data Settings.Unable to read file')
    showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (response === null) {
    return
  }

  const data = response.content

  let playlists

  // for the sake of backwards compatibility,
  // check if this is the old JSON array export (used until version 0.19.1),
  // that didn't match the actual database format
  const trimmedData = data.trim()

  if (trimmedData[0] === '[' && trimmedData[trimmedData.length - 1] === ']') {
    playlists = JSON.parse(trimmedData)
  } else {
    // otherwise assume this is the correct database format,
    // which is also what we export now (used in 0.20.0 and later versions)
    playlists = parseImportedLineDelimitedJson(data)
  }

  const requiredKeys = [
    'playlistName',
    'videos',
  ]

  const optionalKeys = [
    '_id',
    'description',
    'createdAt',
  ]

  const ignoredKeys = [
    'title',
    'type',
    'protected',
    'lastUpdatedAt',
    'lastPlayedAt',
    'removeOnWatched',

    'thumbnail',
    'channelName',
    'channelId',
    'playlistId',
    'videoCount',
  ]

  const knownKeys = [...requiredKeys, ...optionalKeys, ...ignoredKeys]

  const requiredVideoKeys = [
    'videoId',
    'title',
    'lengthSeconds',
    'timeAdded',

    // These two properties will be missing for shorts added to a playlist from anywhere but the watch page
    // 'author',
    // 'authorId',

    // `playlistItemId` should be optional for backward compatibility
    // 'playlistItemId',
  ]

  const newPlaylists = []

  playlists.forEach((playlistData) => {
    // We would technically already be done by the time the data is parsed,
    // however we want to limit the possibility of malicious data being sent
    // to the app, so we'll only grab the data we need here.

    if (!isJsonObject(playlistData)) {
      const message = t('Settings.Data Settings.Playlist insufficient data', { playlist: '' })
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      return
    }

    const playlistObject = {}
    const videoIdToBeAddedSet = new Set()
    let countRequiredKeysPresent = 0

    Object.keys(playlistData).forEach((key) => {
      if (!knownKeys.includes(key)) {
        const message = `${t('Settings.Data Settings.Unknown data key')}: ${key}`
        showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      } else if (key === 'videos') {
        const videoArray = []
        playlistData.videos.forEach((video) => {
          const videoPropertyKeys = Object.keys(video)
          const videoObjectHasAllRequiredKeys = requiredVideoKeys.every((k) => videoPropertyKeys.includes(k))

          if (videoObjectHasAllRequiredKeys) {
            videoArray.push(video)
            videoIdToBeAddedSet.add(video.videoId)
          }
        })

        playlistObject.videos = videoArray

        if (requiredKeys.includes(key)) {
          countRequiredKeysPresent++
        }
      } else if (!ignoredKeys.includes(key)) {
        // Do nothing for keys to be ignored
        playlistObject[key] = playlistData[key]

        if (requiredKeys.includes(key)) {
          countRequiredKeysPresent++
        }
      }
    })

    if (countRequiredKeysPresent !== requiredKeys.length) {
      const message = t('Settings.Data Settings.Playlist insufficient data', { playlist: playlistData.playlistName })
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      return
    }

    const existingPlaylist = allPlaylists.value.find((playlist) => {
      if (playlistObject._id != null && playlist._id === playlistObject._id) {
        return true
      }

      return playlist.playlistName === playlistObject.playlistName
    })

    if (existingPlaylist === undefined) {
      newPlaylists.push(playlistObject)
      return
    }

    /** @type {Set<string> | undefined} */
    let existingVideoIdSet

    let shouldAddDuplicateVideos = playlistObject.videos.length > videoIdToBeAddedSet.size

    if (!shouldAddDuplicateVideos) {
      existingVideoIdSet = existingPlaylist.videos.reduce((set, video) => set.add(video.videoId), new Set())
      shouldAddDuplicateVideos = existingPlaylist.videos.length > existingVideoIdSet.size
    }

    const playlistVideos = deepCopy(existingPlaylist.videos)

    playlistObject.videos.forEach((video) => {
      let videoExists = false
      if (shouldAddDuplicateVideos) {
        if (video.playlistItemId != null) {
          // Find by `playlistItemId` if present
          videoExists = playlistVideos.some((x) => {
            // Allow duplicate (by videoId) videos to be added
            return x.videoId === video.videoId && x.playlistItemId === video.playlistItemId
          })
        } else {
          // Older playlist exports have no `playlistItemId` but have `timeAdded`
          // Which might be duplicate for copied playlists with duplicate `videoId`
          videoExists = playlistVideos.some((x) => {
            // Allow duplicate (by videoId) videos to be added
            return x.videoId === video.videoId && x.timeAdded === video.timeAdded
          })
        }
      } else if (existingVideoIdSet !== undefined) {
        // Disallow duplicate (by videoId) videos to be added

        if (existingVideoIdSet.has(video.videoId)) {
          videoExists = true
        } else {
          existingVideoIdSet.add(video.videoId)
        }
      } else {
        videoExists = playlistVideos.some((x) => {
          // Disallow duplicate (by videoId) videos to be added
          return x.videoId === video.videoId
        })
      }

      if (!videoExists) {
        // Keep original `timeAdded` value
        processToBeAddedPlaylistVideo(video)
        playlistVideos.push(video)
      }
    })
    // Update playlist's `lastUpdatedAt` & other attributes
    store.dispatch('updatePlaylist', {
      _id: existingPlaylist._id,
      // Only these attributes would be updated (besides videos)
      playlistName: playlistObject.playlistName,
      description: playlistObject.description,
      videos: playlistVideos
    })
  })

  if (newPlaylists.length > 0) {
    store.dispatch('addPlaylists', newPlaylists)
  }

  showToast({
    message: t('Settings.Data Settings.All playlists has been successfully imported'),
    icon: ['fas', 'bookmark'],
  })
}

async function exportPlaylists() {
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'opentubex-playlists-' + dateStr + '.db'

  const playlistsDb = allPlaylists.value.map(playlist => {
    return JSON.stringify(playlist)
  }).join('\n') + '\n'

  await promptAndWriteToFile(
    exportFileName,
    playlistsDb,
    t('Settings.Data Settings.Playlist File'),
    'application/x-freetube-db',
    '.db',
    t('Settings.Data Settings.All playlists has been successfully exported')
  )
}

// #endregion playlists

// #region search history

/** @type {import('vue').ComputedRef<{ _id: string, lastUpdatedAt: number }[]>} */
const searchHistoryEntries = computed(() => {
  return store.getters.getSearchHistoryEntries
})

async function importSearchHistory() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.Search history file'),
      {
        'application/x-freetube-db': '.db',
        'application/json': '.json'
      },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
  } catch (err) {
    const message = t('Settings.Data Settings.Unable to read file')
    showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (response === null) {
    return
  }

  const { filename, content } = response

  if (filename.endsWith('.db')) {
    importFreeTubeSearchHistory(parseImportedLineDelimitedJson(content))
  } else if (filename.endsWith('.json')) {
    importYouTubeSearchHistory(JSON.parse(content))
  }
}

/**
 * @param {unknown[]} searchHistoryRecords
 */
async function importFreeTubeSearchHistory(searchHistoryRecords) {
  // deep copy so we don't get errors from Electron when we try to pass reactive objects through the IPC channels
  const historyItems = new Map(deepCopy(searchHistoryEntries.value).map(entry => [entry._id, entry]))

  searchHistoryRecords.forEach((entry) => {
    if (!isJsonObject(entry) || typeof entry._id !== 'string' || typeof entry.lastUpdatedAt !== 'number') {
      showToast({
        message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error('Missing keys:', entry)
    } else {
      const existingEntry = historyItems.get(entry._id)

      if (existingEntry == null || entry.lastUpdatedAt > existingEntry.lastUpdatedAt) {
        let newEntry

        if (Object.keys(entry) === 2) {
          newEntry = entry
        } else {
          newEntry = { _id: entry._id, lastUpdatedAt: entry.lastUpdatedAt }
        }

        historyItems.set(entry._id, newEntry)
      }
    }
  })

  const newSearchHistoryEntries = Array.from(historyItems.values())

  await store.dispatch('overwriteSearchHistory', newSearchHistoryEntries)

  showToast({
    message: t('Settings.Data Settings.All search history has been successfully imported'),
    icon: ['fas', 'history'],
  })
}

/**
 * @param {any[]} historyData
 */
async function importYouTubeSearchHistory(historyData) {
  // deep copy so we don't get errors from Electron when we try to pass reactive objects through the IPC channels
  const historyItems = new Map(deepCopy(searchHistoryEntries.value).map(entry => [entry._id, entry]))

  for (const entry of historyData) {
    if (
      entry.products?.includes('YouTube') &&
      entry.titleUrl?.includes('youtube.com/results?search_query') &&
      entry.details == null // dont import ads
    ) {
      try {
        const url = new URL(entry.titleUrl)
        const query = url.searchParams.get('search_query')

        const lastUpdatedAt = Date.parse(entry.time)

        if (!query || typeof query !== 'string' || query.length === 0 || isNaN(lastUpdatedAt)) {
          showToast({
            message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
            icon: ['fas', 'circle-exclamation'],
          })
          console.error('Missing keys:', entry)
        } else {
          const existingEntry = historyItems.get(query)

          if (existingEntry == null || lastUpdatedAt > existingEntry.lastUpdatedAt) {
            historyItems.set(query, { _id: query, lastUpdatedAt })
          }
        }
      } catch (error) {
        console.error(error)
        showToast({
          message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
          icon: ['fas', 'circle-exclamation'],
        })
      }
    }
  }

  const newSearchHistoryEntries = Array.from(historyItems.values())

  await store.dispatch('overwriteSearchHistory', newSearchHistoryEntries)

  showToast({
    message: t('Settings.Data Settings.All search history has been successfully imported'),
    icon: ['fas', 'history'],
  })
}

const showExportSearchHistoryPrompt = ref(false)

/**
 * @param {'freetube' | 'youtube' | null} option
 */
async function exportSearchHistory(option) {
  showExportSearchHistoryPrompt.value = false

  switch (option) {
    case 'freetube':
      exportFreeTubeSearchHistory()
      break
    case 'youtube':
      exportYouTubeSearchHistory()
      break
  }
}

async function exportFreeTubeSearchHistory() {
  const historyDb = searchHistoryEntries.value.map((entry) => {
    return JSON.stringify(entry)
  }).join('\n') + '\n'
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'opentubex-search-history-' + dateStr + '.db'

  await promptAndWriteToFile(
    exportFileName,
    historyDb,
    t('Settings.Data Settings.Search history file'),
    'application/x-freetube-db',
    '.db',
    t('Settings.Data Settings.All search history has been successfully exported')
  )
}

async function exportYouTubeSearchHistory() {
  const historyData = searchHistoryEntries.value.map((entry) => {
    return {
      header: 'YouTube',
      title: `Searched for ${entry._id}`,
      titleUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(entry._id)}`,
      time: new Date(entry.lastUpdatedAt).toISOString(),
      products: [
        'YouTube'
      ],
      activityControls: [
        'YouTube search history'
      ]
    }
  })

  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = 'youtube-search-history-' + dateStr + '.json'

  await promptAndWriteToFile(
    exportFileName,
    JSON.stringify(historyData),
    t('Settings.Data Settings.Search history file'),
    'application/json',
    '.json',
    t('Settings.Data Settings.All search history has been successfully exported')
  )
}

// #endregion search history

// #region settings

/** @type {import('vue').ComputedRef<object>} */
const transferableSettings = computed(() => {
  return store.getters.getTransferableSettings
})

async function importSettings() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.Settings File'),
      {
        'application/x-freetube-db': '.db',
        'application/json': '.json'
      },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
  } catch (err) {
    const message = t('Settings.Data Settings.Unable to read file')
    showToast({ message: `${message}: ${err}`, icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (response === null) {
    return
  }

  const content = response.content.trim()
  let importedSettings
  try {
    importedSettings = JSON.parse(content)
  } catch {
    importedSettings = Object.fromEntries(
      content.split('\n').map((rawEntry) => {
        const entry = JSON.parse(rawEntry)
        if (typeof entry._id !== 'string' || !Object.hasOwn(entry, 'value')) {
          showToast({
            message: t('Settings.Data Settings.Setting object has insufficient data, skipping item'),
            icon: ['fas', 'circle-exclamation'],
          })
          console.error('Missing keys:', entry)
          return []
        }
        return [entry._id, entry.value]
      }).filter((entry) => entry.length > 0)
    )
  }

  importedSettings = migrateLegacySettings(importedSettings)

  const currentTransferableSettings = transferableSettings.value
  const currentSettings = store.state.settings

  for (const [importedKey, importedValue] of Object.entries(importedSettings)) {
    if (!Object.hasOwn(currentSettings, importedKey)) {
      const message = t('Settings.Data Settings.Unknown setting key', { key: importedKey })
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      continue
    }

    if (NON_TRANSFERABLE_SETTINGS.has(importedKey)) {
      const message = t('Settings.Data Settings.Non-transferable setting key', { key: importedKey })
      showToast({ message: message, icon: ['fas', 'circle-exclamation'] })
      continue
    }

    const currentValue = currentTransferableSettings[importedKey]
    const areValuesEqual = currentValue === importedValue ||
      (typeof importedValue === 'object' && JSON.stringify(currentValue) === JSON.stringify(importedValue))
    if (areValuesEqual) {
      continue
    }

    const updaterId = defaultUpdaterId(importedKey)
    await store.dispatch(updaterId, importedValue)
  }

  showToast({
    message: t('Settings.Data Settings.All settings have been successfully imported'),
    icon: ['fas', 'sliders-h'],
  })
}

async function exportSettings() {
  const settingDb = Object.entries(transferableSettings.value)
    .map(([_id, value]) => JSON.stringify({ _id, value }))
    .join('\n') + '\n'
  const dateStr = getTodayDateStrLocalTimezone()
  const exportFileName = `opentubex-settings-${dateStr}.db`

  await promptAndWriteToFile(
    exportFileName,
    settingDb,
    t('Settings.Data Settings.Settings File'),
    'application/x-freetube-db',
    '.db',
    t('Settings.Data Settings.All settings have been successfully exported')
  )
}

// #endregion settings

</script>

<style scoped src="./DataSettings.css" />
