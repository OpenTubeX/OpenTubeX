<template>
  <FtSettingsSection
    :title="$t('Settings.Data Settings.Data Settings')"
    hide-title
  >
    <h4 class="groupTitle">
      {{ t('Settings.Data Settings.Complete backup') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="t('Settings.Data Settings.Import backup')"
        :icon="['fas', 'folder-open']"
        :disabled="backupBusy"
        @click="selectUnifiedBackup"
      />
      <FtButton
        :label="t('Settings.Data Settings.Export backup')"
        :icon="['fas', 'file-download']"
        :disabled="backupBusy"
        @click="openBackupExport"
      />
    </FtFlexBox>
    <p class="importFormatsHint">
      {{ t('Settings.Data Settings.Backup description') }}
    </p>
    <h4 class="groupTitle">
      {{ t('Settings.Data Settings.Import YouTube Takeout ZIP') }}
    </h4>
    <FtFlexBox class="box">
      <FtButton
        :label="t('Settings.Data Settings.Import YouTube Takeout ZIP')"
        :icon="['fas', 'folder-open']"
        :disabled="takeoutBusy"
        @click="selectTakeoutZip"
      />
    </FtFlexBox>
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
        <a
          class="importHelpLink"
          href="https://opentubex.org/docs/importing/"
        >
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
    <FtSettingsSubpage
      :open="showBackupExport"
      :title="t('Settings.Data Settings.Export backup')"
      :icon="['fas', 'file-download']"
      @close="showBackupExport = false"
    >
      <div
        class="takeoutSelection takeoutSelectionCentered"
        :aria-busy="backupBusy"
      >
        <p>{{ t('Settings.Data Settings.Select export data') }}</p>
        <FtCheckboxList
          v-model="selectedExportSections"
          :labels="backupLabels"
          :values="BACKUP_SECTIONS"
        />
        <FtButton
          :label="t('Settings.Data Settings.Export selected data')"
          :icon="['fas', 'file-download']"
          :disabled="backupBusy || selectedExportSections.length === 0"
          @click="exportUnifiedBackup"
        />
      </div>
    </FtSettingsSubpage>
    <FtSettingsSubpage
      :open="showBackupImport"
      grow-with-content
      :title="t('Settings.Data Settings.Import backup')"
      :icon="['fas', 'folder-open']"
      @close="closeBackupImport"
    >
      <div
        ref="backupImportContent"
        class="takeoutSelection takeoutSelectionCentered takeoutSelectionImport"
        :aria-busy="backupBusy"
      >
        <p>{{ backupFilename }}</p>
        <p>{{ t('Settings.Data Settings.Select backup data') }}</p>
        <FtCheckboxList
          v-model="selectedBackupSections"
          :labels="backupImportLabels"
          :values="backupImportSections"
          :disabled="backupBusy"
        />
        <FtImportPreview
          :rows="backupPreview.filter(row => selectedBackupSections.includes(row.category))"
          :labels="Object.fromEntries(backupImportSections.map((value, index) => [value, backupImportLabels[index]]))"
        />
        <FtButton
          v-if="selectedBackupSections.length > 0"
          :label="t('Settings.Data Settings.Import selected data')"
          :icon="['fas', 'folder-open']"
          :disabled="backupBusy"
          @click="importUnifiedBackup"
        />
      </div>
    </FtSettingsSubpage>
    <FtSettingsSubpage
      :open="showTakeoutImport"
      grow-with-content
      :title="t('Settings.Data Settings.Import YouTube Takeout ZIP')"
      :icon="['fas', 'folder-open']"
      @close="closeTakeoutImport"
    >
      <div
        ref="takeoutImportContent"
        class="takeoutSelection takeoutSelectionCentered takeoutSelectionImport"
        :aria-busy="takeoutBusy"
      >
        <p>{{ takeoutFilename }}</p>
        <p>{{ t('Settings.Data Settings.Select Takeout data') }}</p>
        <FtCheckboxList
          v-model="selectedTakeoutTypes"
          :labels="takeoutLabels"
          :values="takeoutTypes"
          :disabled="takeoutBusy"
        />
        <FtImportPreview
          :rows="takeoutPreview.filter(row => selectedTakeoutTypes.includes(row.category))"
          :labels="Object.fromEntries(takeoutTypes.map((value, index) => [value, takeoutLabels[index]]))"
        />
        <FtLoader
          v-if="takeoutBusy"
          :tab-loading-indicator="false"
        />
        <FtButton
          v-if="selectedTakeoutTypes.length > 0 && !takeoutPreviewReady"
          :label="t('Settings.Data Settings.Import Preview.Title')"
          :icon="['fas', 'eye']"
          :disabled="takeoutBusy"
          @click="previewSelectedTakeoutData"
        />
        <FtButton
          v-if="takeoutPreviewReady"
          :label="t('Settings.Data Settings.Import selected data')"
          :icon="['fas', 'folder-open']"
          :disabled="takeoutBusy"
          @click="importSelectedTakeoutData"
        />
      </div>
    </FtSettingsSubpage>
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
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'

import store from '../../store/index'
import { defaultUpdaterId, NON_TRANSFERABLE_SETTINGS } from '../../store/modules/settings'
import { migrateLegacySettings } from '../../helpers/settings-migrations'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { startProgressBarOperation } from '../../helpers/progressBar'

import { MAIN_PROFILE_ID } from '../../../constants'
import { calculateColorLuminance, getRandomColor } from '../../helpers/colors'
import {
  deepCopy,
  escapeHTML,
  getTodayDateStrLocalTimezone,
  pickFileWithPicker,
  readFileWithPicker,
  showToast,
  writeFileWithPicker,
} from '../../helpers/utils'
import { processToBeAddedPlaylistVideo } from '../../helpers/playlists'
import { normalizePlaylistThumbnail } from '../../helpers/playlist-thumbnails'
import {
  convertLibreTubeSubscriptions,
  convertLibreTubeWatchHistoryToOpenTubeX,
  detectSubscriptionJsonFormat,
  extractChannelIdFromUploaderUrl,
  getLibreTubeSubscriptions,
  isLibreTubeWatchHistoryBackup,
} from '../../helpers/libretube'
import { parseLineDelimitedJson } from '../../helpers/line-delimited-json'
import { previewBackupImport, previewTakeoutImport, parseTakeoutSubscriptions, parseTakeoutWatchHistory, parseTakeoutSearchHistory } from '../../helpers/import-preview'
import FtImportPreview from '../FtImportPreview/FtImportPreview.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import { BACKUP_SECTIONS, createUnifiedBackup, mergeBackupHistory, mergeBackupPlaylist, mergeBackupProfile, readUnifiedBackup } from '../../helpers/unifiedBackup'
import { compactAllDatastores, DBHistoryHandlers, DBPlaylistHandlers, DBProfileHandlers, DBSearchHistoryHandlers, DBWatchStatsHandlers } from '../../../datastores/handlers/index'
import { forEachTakeoutImportEntry, listYouTubeTakeoutZipEntries, parseTakeoutPlaylistCsv } from '../../helpers/youtube-takeout-zip'
import {
  mergeSearchHistoryEntries,
  normalizeSearchHistoryEntry,
  normalizeSearchSettings,
} from '../../../search-history'

const IMPORT_DIRECTORY_ID = 'data-settings-import'
const START_IN_DIRECTORY = 'downloads'
const { t } = useI18n()
const backupImportContent = useTemplateRef('backupImportContent')
const takeoutImportContent = useTemplateRef('takeoutImportContent')
let importContentObserver
watch([backupImportContent, takeoutImportContent], ([backup, takeout]) => {
  importContentObserver?.disconnect()
  const content = (backup ?? takeout)?.closest('.settingsSubpageContent')
  const viewport = content?.closest('.settingsSubpageScroll')
  if (!content || !viewport) return
  const clampScroll = () => clampOverlayScrollTop(viewport, content)
  importContentObserver = new ResizeObserver(clampScroll)
  importContentObserver.observe(content)
  importContentObserver.observe(viewport)
  clampScroll()
}, { flush: 'post' })
onBeforeUnmount(() => importContentObserver?.disconnect())

const backupBusy = ref(false)
const showBackupImport = ref(false)
const showBackupExport = ref(false)
const selectedExportSections = ref([...BACKUP_SECTIONS])
const backupFilename = ref('')
const backupData = shallowRef(null)
const backupPreview = shallowRef([])
const selectedBackupSections = ref([...BACKUP_SECTIONS])
const backupLabels = computed(() => [
  t('Settings.Settings'),
  t('Settings.Data Settings.Profiles and subscriptions'),
  t('Playlists'),
  t('History.History'),
  t('Settings.Data Settings.Search history'),
  t('Home Page.Watch statistics'),
])

const backupImportSections = computed(() => BACKUP_SECTIONS.filter(section => Object.hasOwn(backupData.value ?? {}, section)))
const backupImportLabels = computed(() => backupImportSections.value.map(section => backupLabels.value[BACKUP_SECTIONS.indexOf(section)]))

async function readImportState(sections) {
  const readers = {
    settings: () => deepCopy(transferableSettings.value),
    profiles: () => DBProfileHandlers.find(),
    playlists: () => DBPlaylistHandlers.find(),
    history: () => DBHistoryHandlers.find(),
    searchHistory: () => DBSearchHistoryHandlers.find(),
    watchStats: () => DBWatchStatsHandlers.find(),
  }
  return Object.fromEntries(await Promise.all(sections.map(async section => [section, await readers[section]()])))
}

function openBackupExport() {
  selectedExportSections.value = [...BACKUP_SECTIONS]
  showBackupExport.value = true
}

function closeBackupImport() {
  showBackupImport.value = false
  backupData.value = null
  backupPreview.value = []
}

async function exportUnifiedBackup() {
  backupBusy.value = true
  try {
    const selected = [...selectedExportSections.value]
    const exported = await promptAndWriteToFile(
      `opentubex-backup-${getTodayDateStrLocalTimezone()}.zip`, async () => {
        const readers = {
          settings: () => deepCopy(transferableSettings.value),
          profiles: () => DBProfileHandlers.find(),
          playlists: () => DBPlaylistHandlers.find(),
          history: () => DBHistoryHandlers.find(),
          searchHistory: () => DBSearchHistoryHandlers.find(),
          watchStats: async () => {
            const [records, adjustment] = await Promise.all([DBWatchStatsHandlers.find(), DBWatchStatsHandlers.getHistoricalAdjustment()])
            return { records, adjustment }
          },
        }
        const entries = await Promise.all(selected.map(async section => [section, await readers[section]()]))
        return createUnifiedBackup(Object.fromEntries(entries))
      },
      t('Settings.Data Settings.Complete backup'), 'application/zip', '.zip',
      t('Settings.Data Settings.Backup exported')
    )
    if (exported) showBackupExport.value = false
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to write file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    backupBusy.value = false
  }
}

async function selectUnifiedBackup() {
  if (backupBusy.value) return
  backupBusy.value = true
  try {
    const file = await pickFileWithPicker(t('Settings.Data Settings.Complete backup'), { 'application/zip': '.zip' }, IMPORT_DIRECTORY_ID, START_IN_DIRECTORY)
    if (file === null) return
    const { data } = await readUnifiedBackup(file)
    const current = await readImportState(Object.keys(data))
    backupPreview.value = previewBackupImport(data, current)
    backupFilename.value = file.name
    backupData.value = data
    selectedBackupSections.value = [...backupImportSections.value]
    showBackupImport.value = true
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    backupBusy.value = false
  }
}

async function importUnifiedBackup() {
  if (backupBusy.value || !backupData.value) return
  backupBusy.value = true
  const selected = new Set(selectedBackupSections.value)
  const data = backupData.value
  try {
    // Portable playlist readers require structured member arrays.
    // Reject unsupported selected playlists before any write; desktop restores them exactly.
    if (selected.has('playlists') && data.playlists.some(playlist => !Array.isArray(playlist.videos) || playlist.videos.some(video => video === null || typeof video !== 'object' || Array.isArray(video) || video instanceof Date))) {
      throw new Error('Invalid backup playlists')
    }
    if (selected.has('profiles') && data.profiles.some(profile => !Array.isArray(profile.subscriptions) || profile.subscriptions.some(channel => channel === null || typeof channel !== 'object' || Array.isArray(channel) || typeof channel.id !== 'string'))) {
      throw new Error('Invalid backup profiles')
    }
    const preparedProfiles = []
    if (selected.has('profiles')) {
      const currentProfiles = new Map((await DBProfileHandlers.find()).map(profile => [profile._id, profile]))
      for (const profile of data.profiles) {
        const merged = mergeBackupProfile(currentProfiles.get(profile._id), profile)
        currentProfiles.set(profile._id, merged)
        preparedProfiles.push(merged)
      }
    }
    if (selected.has('playlists')) {
      const currentPlaylists = new Map((await DBPlaylistHandlers.find()).map(playlist => [playlist._id, playlist]))
      for (const playlist of data.playlists) {
        const merged = mergeBackupPlaylist(currentPlaylists.get(playlist._id), playlist)
        currentPlaylists.set(playlist._id, merged)
      }
    }
    if (selected.has('profiles')) {
      for (const profile of preparedProfiles) await DBProfileHandlers.upsert(profile)
      await store.dispatch('grabAllProfiles')
    }
    if (selected.has('playlists')) {
      const currentPlaylists = new Map((await DBPlaylistHandlers.find()).map(playlist => [playlist._id, playlist]))
      for (const playlist of data.playlists) {
        await normalizeImportedPlaylistThumbnail(playlist)
        const merged = mergeBackupPlaylist(currentPlaylists.get(playlist._id), playlist)
        if (await store.dispatch('updatePlaylist', merged) !== true) throw new Error('Could not restore playlist')
        currentPlaylists.set(playlist._id, merged)
      }
    }
    if (selected.has('history')) {
      const records = mergeBackupHistory(await DBHistoryHandlers.find(), data.history)
      if (await store.dispatch('overwriteHistory', records) !== true) throw new Error('Could not restore history')
    }
    if (selected.has('searchHistory')) {
      const entries = mergeSearchHistoryEntries(await DBSearchHistoryHandlers.find(), data.searchHistory)
      if (await store.dispatch('overwriteSearchHistory', entries) !== true) throw new Error('Could not restore search history')
    }
    if (selected.has('watchStats')) {
      await DBWatchStatsHandlers.mergeBackup(data.watchStats)
      await store.dispatch('grabWatchStats')
    }
    if (selected.has('settings')) await applyImportedSettings(data.settings)
    const compaction = await compactAllDatastores().catch(() => false)
    closeBackupImport()
    showToast({ message: t('Settings.Data Settings.Backup imported'), icon: ['fas', 'check'] })
    if (compaction !== true && (!Array.isArray(compaction) || compaction.some(result => result.status === 'rejected'))) {
      showToast({ message: t('Settings.Storage Settings.Cleanup Failed'), icon: ['fas', 'circle-exclamation'] })
    }
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    backupBusy.value = false
  }
}

const showTakeoutImport = ref(false)
const takeoutBusy = ref(false)
const takeoutFilename = ref('')
const takeoutFile = shallowRef(null)
const takeoutEntries = shallowRef([])
const takeoutPreview = shallowRef([])
const selectedTakeoutTypes = ref([])
const takeoutPreviewReady = computed(() => selectedTakeoutTypes.value.length > 0 && selectedTakeoutTypes.value.every(type => takeoutPreview.value.some(row => row.category === type)))
const takeoutTypes = computed(() => [...new Set(takeoutEntries.value.map(entry => entry.type))])
const takeoutLabels = computed(() => takeoutTypes.value.map(type => {
  return {
    subscriptions: t('Subscriptions.Subscriptions'),
    history: t('History.History'),
    searchHistory: t('Settings.Data Settings.Search history'),
    playlists: t('Playlists'),
  }[type]
}))

function closeTakeoutImport() {
  showTakeoutImport.value = false
  takeoutFile.value = null
  takeoutEntries.value = []
  takeoutPreview.value = []
  selectedTakeoutTypes.value = []
}

async function selectTakeoutZip() {
  if (takeoutBusy.value) return
  takeoutBusy.value = true
  try {
    const file = await pickFileWithPicker(
      t('Settings.Data Settings.Import YouTube Takeout ZIP'),
      { 'application/zip': '.zip' },
      IMPORT_DIRECTORY_ID,
      START_IN_DIRECTORY
    )
    if (file === null) { return }
    const entries = await listYouTubeTakeoutZipEntries(file)
    if (entries.length === 0) {
      showToast({ message: t('Settings.Data Settings.No supported Takeout data'), icon: ['fas', 'circle-exclamation'] })
      return
    }
    takeoutFilename.value = file.name
    takeoutFile.value = file
    takeoutEntries.value = entries
    selectedTakeoutTypes.value = [...new Set(entries.map(entry => entry.type))]
    showTakeoutImport.value = true
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    takeoutBusy.value = false
  }
}

/** Decode only the categories chosen after lightweight archive discovery. */
async function previewSelectedTakeoutData() {
  const file = takeoutFile.value
  if (takeoutBusy.value || !file || selectedTakeoutTypes.value.length === 0) return
  takeoutBusy.value = true
  const selected = new Set(selectedTakeoutTypes.value)
  const entries = takeoutEntries.value.filter(entry => selected.has(entry.type))
  try {
    const current = await readImportState([...selected].filter(type => type !== 'subscriptions'))
    const preview = await previewTakeoutImport(file, entries, { ...current, subscriptions: primaryProfile.value.subscriptions })
    if (takeoutFile.value === file) takeoutPreview.value = preview
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    takeoutBusy.value = false
  }
}

async function importSelectedTakeoutData() {
  if (takeoutBusy.value || !takeoutFile.value || !takeoutPreviewReady.value) return
  takeoutBusy.value = true
  const selected = new Set(selectedTakeoutTypes.value)
  let importedPlaylists = false
  let failedPlaylists = false
  try {
    await forEachTakeoutImportEntry(takeoutFile.value, selected, takeoutEntries.value, async entry => {
      if (entry.type === 'subscriptions') {
        const subscriptions = parseTakeoutSubscriptions(entry)
        const known = new Set(primaryProfile.value.subscriptions.map(channel => channel.id))
        const additions = subscriptions.filter(channel => {
          if (known.has(channel.id)) return false
          known.add(channel.id)
          return true
        })
        await store.dispatch('updateProfile', { ...deepCopy(primaryProfile.value), subscriptions: [...deepCopy(primaryProfile.value.subscriptions), ...additions] })
        showToast({ message: t('Settings.Data Settings.All subscriptions have been successfully imported'), icon: ['fas', 'rss'] })
      } else if (entry.type === 'history') {
        await importYouTubeWatchHistory(JSON.parse(entry.content))
      } else if (entry.type === 'searchHistory') {
        await importYouTubeSearchHistory(JSON.parse(entry.content))
      } else if (entry.type === 'playlists') {
        await importTakeoutPlaylist(entry.playlist)
        importedPlaylists = true
      }
    }, (error, type, path) => {
      if (type === 'playlists') failedPlaylists = true
      console.error('Unable to import Takeout entry', path, error)
      showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${path ?? error}`, icon: ['fas', 'circle-exclamation'] })
    })
    if (importedPlaylists && !failedPlaylists) {
      showToast({ message: t('Settings.Data Settings.All playlists has been successfully imported'), icon: ['fas', 'bookmark'] })
    }
    closeTakeoutImport()
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    takeoutBusy.value = false
  }
}

function openProfileSettings() {
  store.dispatch('showSettingsWindow', 'profile')
}

/**
 * @param {string} fileName
 * @param {string | Blob | (() => Promise<Blob>)} content
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
    return response
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
 * @returns {unknown[] | null}
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

  return records.length === 0 ? null : records
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
    await importCsvYouTubeSubscriptions(content)
  } else if (filename.endsWith('.db')) {
    const records = parseImportedLineDelimitedJson(content)
    if (records !== null) {
      importFreeTubeSubscriptions(records)
    }
  } else if (filename.endsWith('.opml') || filename.endsWith('.xml')) {
    await importOpmlYouTubeSubscriptions(content)
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
        await importYouTubeSubscriptions(jsonContent)
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
 * @param {(progressOperation: ReturnType<typeof startProgressBarOperation>) => Promise<void> | void} importSubscriptions
 */
function runWithDataImportProgress(importSubscriptions) {
  const progressOperation = startProgressBarOperation(store, {
    icon: ['fas', 'sync'],
    message: '',
    percentage: 0,
  })
  try {
    const result = importSubscriptions(progressOperation)
    if (result instanceof Promise) {
      return result.finally(() => progressOperation.finish())
    }
    progressOperation.finish()
  } catch (error) {
    progressOperation.finish()
    throw error
  }
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

  if (!shouldUpdatePrimaryProfile) {
    return
  }

  store.dispatch('updateProfile', updatedPrimaryProfile)

  showToast({
    message: t('Settings.Data Settings.All subscriptions and profiles have been successfully imported'),
    icon: ['fas', 'rss'],
  })
}

/**
 * @param {string} textDecode
 */
function importCsvYouTubeSubscriptions(textDecode) { // first row = header, last row = empty
  return runWithDataImportProgress(async () => {
    const youtubeSubscriptions = textDecode.split('\n').filter(sub => {
      return sub !== ''
    })
    const subscriptions = []

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
    await store.dispatch('updateProfile', primaryProfile.value)
    showToast({
      message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
      icon: ['fas', 'rss'],
    })
  })
}

/**
 * @param {object} textDecode
 */
function importYouTubeSubscriptions(textDecode) {
  return runWithDataImportProgress(async progressOperation => {
    const subscriptions = []
    let count = 0

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
      progressOperation.update({ percentage: progressPercentage })
    })

    primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(subscriptions)
    await store.dispatch('updateProfile', primaryProfile.value)
    showToast({
      message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
      icon: ['fas', 'rss'],
    })
  })
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

  return runWithDataImportProgress(async progressOperation => {
    const subscriptions = []

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
      progressOperation.update({ percentage: progressPercentage })
    })

    primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(subscriptions)
    await store.dispatch('updateProfile', primaryProfile.value)
    showToast({
      message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
      icon: ['fas', 'rss'],
    })
  })
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
  runWithDataImportProgress(progressOperation => {
    const newSubscriptions = []

    subscriptions.forEach((channel, index) => {
      if (!isChannelSubscribed(channel.id, newSubscriptions)) {
        newSubscriptions.push(channel)
      }

      const progressPercentage = ((index + 1) / subscriptions.length) * 100
      progressOperation.update({ percentage: progressPercentage })
    })

    primaryProfile.value.subscriptions = primaryProfile.value.subscriptions.concat(newSubscriptions)
    store.dispatch('updateProfile', primaryProfile.value)
    showToast({
      message: t('Settings.Data Settings.All subscriptions have been successfully imported'),
      icon: ['fas', 'rss'],
    })
  })
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
    const records = parseImportedLineDelimitedJson(content)
    if (records !== null) {
      importFreeTubeWatchHistory(records)
    }
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
  let importedCount = 0

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
      importedCount++
    }
  })

  if (importedCount === 0) {
    return
  }

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
  const { entries, skipped, unknownKeys } = parseTakeoutWatchHistory(historyData)
  for (const key of unknownKeys) {
    showToast({ message: `Unknown data key: ${key}`, icon: ['fas', 'circle-exclamation'] })
  }
  if (skipped > 0) {
    showToast({ message: t('Settings.Data Settings.History object has insufficient data, skipping item'), icon: ['fas', 'circle-exclamation'] })
  }
  const historyItems = new Map(deepCopy(Object.entries(historyCacheById.value)))
  for (const entry of entries) historyItems.set(entry.videoId, entry)

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

async function importTakeoutPlaylist(playlist) {
  const existing = allPlaylists.value.find(item => item.playlistName === playlist.playlistName)
  if (existing === undefined) {
    if (await store.dispatch('addPlaylist', playlist) !== true) {
      throw new Error('Unable to save playlist')
    }
  } else {
    const videos = deepCopy(existing.videos)
    const known = new Set(videos.map(video => `${video.videoId}:${video.timeAdded}`))
    for (const video of playlist.videos) {
      const key = `${video.videoId}:${video.timeAdded}`
      if (!known.has(key)) {
        processToBeAddedPlaylistVideo(video)
        videos.push(video)
        known.add(key)
      }
    }
    await store.dispatch('importPlaylist', { createdAt: existing.createdAt, lastUpdatedAt: Date.now(), ...playlist, _id: existing._id, videos })
  }
}

async function normalizeImportedPlaylistThumbnail(playlist) {
  if (!isJsonObject(playlist) || !Object.hasOwn(playlist, 'customThumbnail') || playlist.customThumbnail === '') return
  try {
    playlist.customThumbnail = await normalizePlaylistThumbnail(playlist.customThumbnail)
  } catch (error) {
    delete playlist.customThumbnail
    console.error('Unable to import playlist thumbnail:', error)
    showToast({ message: t('Profile.The selected image could not be loaded'), icon: ['fas', 'circle-exclamation'] })
  }
}

async function importPlaylists() {
  let response
  try {
    response = await readFileWithPicker(
      t('Settings.Data Settings.Playlist File'),
      {
        'application/x-freetube-db': '.db',
        'text/csv': '.csv',
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

  if (response.filename.toLowerCase().endsWith('.csv')) {
    try {
      const playlist = parseTakeoutPlaylistCsv(data, response.filename)
      if (playlist === null) { throw new Error('Invalid playlist CSV') }
      await importTakeoutPlaylist(playlist)
      showToast({ message: t('Settings.Data Settings.All playlists has been successfully imported'), icon: ['fas', 'bookmark'] })
    } catch (error) {
      console.error('Unable to import Takeout playlist', response.filename, error)
      showToast({ message: `${t('Settings.Data Settings.Unable to read file')}: ${response.filename}`, icon: ['fas', 'circle-exclamation'] })
    }
    return
  }

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
    if (playlists === null) {
      return
    }
  }

  const requiredKeys = [
    'playlistName',
    'videos',
  ]

  const optionalKeys = [
    '_id',
    'description',
    'createdAt',
    'customThumbnail',
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
  let importedCount = 0

  for (const playlistData of playlists) {
    await normalizeImportedPlaylistThumbnail(playlistData)
  }

  playlists.forEach((playlistData) => {
    // We would technically already be done by the time the data is parsed,
    // however we want to limit the possibility of malicious data being sent
    // to the app, so we'll only grab the data we need here.

    if (!isJsonObject(playlistData) || !Array.isArray(playlistData.videos)) {
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
          if (!isJsonObject(video)) {
            return
          }

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

    importedCount++

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
      ...(Object.hasOwn(playlistObject, 'customThumbnail') ? { customThumbnail: playlistObject.customThumbnail } : {}),
      videos: playlistVideos
    })
  })

  if (importedCount === 0) {
    return
  }

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
    const records = parseImportedLineDelimitedJson(content)
    if (records !== null) {
      importFreeTubeSearchHistory(records)
    }
  } else if (filename.endsWith('.json')) {
    importYouTubeSearchHistory(JSON.parse(content))
  }
}

/**
 * @param {unknown[]} searchHistoryRecords
 */
async function importFreeTubeSearchHistory(searchHistoryRecords) {
  // deep copy so we don't get errors from Electron when we try to pass reactive objects through the IPC channels
  const currentEntries = deepCopy(searchHistoryEntries.value)
  const importedEntries = []

  searchHistoryRecords.forEach((entry) => {
    if (!isJsonObject(entry) || typeof entry._id !== 'string' || typeof entry.lastUpdatedAt !== 'number') {
      showToast({
        message: t('Settings.Data Settings.History object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error('Missing keys:', entry)
    } else {
      importedEntries.push(normalizeSearchHistoryEntry({
        _id: entry._id,
        query: typeof entry.query === 'string' ? entry.query : entry._id,
        lastUpdatedAt: entry.lastUpdatedAt,
        searchSettings: isJsonObject(entry.searchSettings) ? entry.searchSettings : undefined,
      }))
    }
  })

  if (importedEntries.length === 0) {
    return
  }

  const newSearchHistoryEntries = mergeSearchHistoryEntries(currentEntries, importedEntries)

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
  const currentEntries = deepCopy(searchHistoryEntries.value)
  const { entries: importedEntries, skipped } = parseTakeoutSearchHistory(historyData)
  if (skipped > 0) {
    showToast({ message: t('Settings.Data Settings.History object has insufficient data, skipping item'), icon: ['fas', 'circle-exclamation'] })
  }

  const newSearchHistoryEntries = mergeSearchHistoryEntries(currentEntries, importedEntries)

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
      title: `Searched for ${entry.query}`,
      titleUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(entry.query)}`,
      time: new Date(entry.lastUpdatedAt).toISOString(),
      searchSettings: normalizeSearchSettings(entry.searchSettings),
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

  const content = response.content
  let importedSettings
  let rows
  try {
    importedSettings = JSON.parse(content.trim())
  } catch {
    rows = parseImportedLineDelimitedJson(content)
  }

  // A database containing one row is also valid JSON. Treat it like the
  // rows of a multi-setting export, not a settings object with _id/value keys.
  if (isJsonObject(importedSettings) && Object.hasOwn(importedSettings, '_id')) {
    rows = [importedSettings]
  }
  if (rows) {
    importedSettings = Object.fromEntries(rows.filter((entry) => {
      if (isJsonObject(entry) && typeof entry._id === 'string' && Object.hasOwn(entry, 'value')) {
        return true
      }
      showToast({
        message: t('Settings.Data Settings.Setting object has insufficient data, skipping item'),
        icon: ['fas', 'circle-exclamation'],
      })
      return false
    }).map(entry => [entry._id, entry.value]))
  }
  if (!isJsonObject(importedSettings) || Object.keys(importedSettings).length === 0) {
    showToast({
      message: t('Settings.Data Settings.Unable to read file'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  if (!await applyImportedSettings(importedSettings)) return

  showToast({
    message: t('Settings.Data Settings.All settings have been successfully imported'),
    icon: ['fas', 'sliders-h'],
  })
}

async function applyImportedSettings(importedSettings) {
  importedSettings = migrateLegacySettings(importedSettings)

  const currentTransferableSettings = transferableSettings.value
  const currentSettings = store.state.settings
  let acceptedSettings = 0

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

    acceptedSettings++
    const currentValue = currentTransferableSettings[importedKey]
    const areValuesEqual = currentValue === importedValue ||
      (typeof importedValue === 'object' && JSON.stringify(currentValue) === JSON.stringify(importedValue))
    if (areValuesEqual) {
      continue
    }

    const updaterId = defaultUpdaterId(importedKey)
    await store.dispatch(updaterId, importedValue)
  }
  return acceptedSettings > 0
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
