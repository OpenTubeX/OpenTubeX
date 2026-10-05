<template>
  <FtButton
    :label="t('Settings.Download Settings.Manage Automatic Downloads', { channelCount: enabledRuleCount })"
    :icon="['fas', 'download']"
    @click="showManager = true"
  />
  <FtSettingsSubpage
    :open="showManager"
    :title="t('Settings.Download Settings.Automatic Downloads')"
    :icon="['fas', 'download']"
    @close="showManager = false"
  >
    <div class="automaticDownloadsHeader">
      <div class="automaticDownloadsDescription">
        <p>{{ t('Settings.Download Settings.Automatic Downloads Description') }}</p>
        <p class="automaticDownloadsHint">
          {{ t('Settings.Download Settings.Automatic Downloads New Only') }}
        </p>
      </div>
      <FtInput
        input-type="search"
        :label="t('Settings.Channel Settings.Search Channels')"
        :icon="['fas', 'search']"
        :placeholder="t('Form Inputs.Search Text Hint')"
        :show-action-button="false"
        :value="searchQuery"
        @input="searchQuery = $event"
      />
    </div>
    <div
      ref="automaticDownloadsScroller"
      v-overlay-scrollbars
      class="automaticDownloadsScroller"
    >
      <div ref="automaticDownloadsContent">
        <p
          v-if="channels.length === 0"
          class="emptyState"
        >
          {{ t('Settings.Download Settings.Automatic Downloads No Channels') }}
        </p>
        <p
          v-else-if="visibleChannels.length === 0"
          class="emptyState"
        >
          {{ t('Settings.Download Settings.No Matching Automatic Download Channels') }}
        </p>
        <ul
          v-else
          class="channelRules"
        >
          <li
            v-for="channel in visibleChannels"
            :key="channel.id"
            class="channelRule"
          >
            <div class="channelRuleHeader">
              <FtRetryImage
                v-if="channel.thumbnail"
                :fallback-icon="['fas', 'circle-user']"
                class="channelThumbnail"
                :src="channel.thumbnail"
                alt=""
              />
              <span
                v-else
                class="channelThumbnail channelThumbnailPlaceholder"
              >
                <FtIcon :icon="['fas', 'circle-user']" />
              </span>
              <FtToggleSwitch
                class="channelToggle"
                :label="channel.name || channel.id"
                :compact="true"
                :default-value="rules[channel.id] !== undefined"
                @change="enabled => setChannelEnabled(channel.id, enabled)"
              />
            </div>
            <div
              v-if="rules[channel.id] !== undefined"
              class="channelRuleOptions"
            >
              <div class="templateAndTypes">
                <FtSelect
                  class="templateSelect"
                  :placeholder="t('Downloads.Template')"
                  :value="ruleFor(channel.id).template"
                  :select-names="templateNames"
                  :select-values="templateValues"
                  :show-icon="false"
                  @change="value => updateRule(channel.id, 'template', value)"
                />
                <FtToggleSwitch
                  :label="t('Global.Videos')"
                  :compact="true"
                  :default-value="ruleFor(channel.id).includeVideos"
                  @change="value => updateRule(channel.id, 'includeVideos', value)"
                />
                <FtToggleSwitch
                  :label="t('Global.Shorts')"
                  :compact="true"
                  :default-value="ruleFor(channel.id).includeShorts"
                  @change="value => updateRule(channel.id, 'includeShorts', value)"
                />
                <FtToggleSwitch
                  :label="t('Settings.Download Settings.Automatic Downloads Livestreams')"
                  :compact="true"
                  :default-value="ruleFor(channel.id).includeLivestreams"
                  @change="value => updateRule(channel.id, 'includeLivestreams', value)"
                />
              </div>
              <div class="filterGrid">
                <FtInput
                  input-type="number"
                  :icon="['fas', 'clock']"
                  :label="t('Settings.Download Settings.Minimum Duration Seconds')"
                  :placeholder="t('Form Inputs.No Minimum')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="9"
                  :value="displayNumber(ruleFor(channel.id).minDurationSeconds)"
                  @input="value => updateNumber(channel.id, 'minDurationSeconds', value)"
                />
                <FtInput
                  input-type="number"
                  :icon="['fas', 'clock']"
                  :label="t('Settings.Download Settings.Maximum Duration Seconds')"
                  :placeholder="t('Form Inputs.No Maximum')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="9"
                  :value="displayNumber(ruleFor(channel.id).maxDurationSeconds)"
                  @input="value => updateNumber(channel.id, 'maxDurationSeconds', value)"
                />
                <FtInput
                  input-type="number"
                  :icon="['fas', 'file-lines']"
                  :label="t('Settings.Download Settings.Minimum File Size MB')"
                  :placeholder="t('Form Inputs.No Minimum')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="9"
                  :value="displayNumber(ruleFor(channel.id).minFileSizeMb)"
                  @input="value => updateNumber(channel.id, 'minFileSizeMb', value)"
                />
                <FtInput
                  input-type="number"
                  :icon="['fas', 'file-lines']"
                  :label="t('Settings.Download Settings.Maximum File Size MB')"
                  :placeholder="t('Form Inputs.No Maximum')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="9"
                  :value="displayNumber(ruleFor(channel.id).maxFileSizeMb)"
                  @input="value => updateNumber(channel.id, 'maxFileSizeMb', value)"
                />
                <FtInput
                  input-type="number"
                  :icon="['fas', 'clock']"
                  :label="t('Settings.Download Settings.Maximum Age Days')"
                  :placeholder="t('Form Inputs.Any Age')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="6"
                  :value="displayNumber(ruleFor(channel.id).maxAgeDays)"
                  @input="value => updateNumber(channel.id, 'maxAgeDays', value)"
                />
              </div>
              <div class="titleFilters">
                <FtInput
                  :icon="['fas', 'filter']"
                  :label="t('Settings.Download Settings.Title Includes')"
                  :placeholder="t('Form Inputs.Included Terms Example')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="200"
                  :value="ruleFor(channel.id).titleIncludes"
                  @input="value => updateRule(channel.id, 'titleIncludes', value)"
                />
                <FtInput
                  :icon="['fas', 'filter']"
                  :label="t('Settings.Download Settings.Title Excludes')"
                  :placeholder="t('Form Inputs.Excluded Terms Example')"
                  :show-label="true"
                  :show-action-button="false"
                  :maxlength="200"
                  :value="ruleFor(channel.id).titleExcludes"
                  @input="value => updateRule(channel.id, 'titleExcludes', value)"
                />
              </div>
              <p class="filterHint">
                {{ t('Settings.Download Settings.Title Filter Hint') }}
              </p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import {
  DEFAULT_AUTOMATIC_DOWNLOAD_RULE,
  normalizeAutomaticDownloadRule,
  parseAutomaticDownloadRules
} from '../../helpers/automaticDownloadRules'
import { DEFAULT_DOWNLOAD_TEMPLATES } from '../../helpers/downloadTemplates'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const { locale, t } = useI18n()
const showManager = ref(false)
const searchQuery = ref('')
const automaticDownloadsScroller = useTemplateRef('automaticDownloadsScroller')
const automaticDownloadsContent = useTemplateRef('automaticDownloadsContent')

let contentResizeObserver = null
let observationGeneration = 0

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return

  await nextTick()
  if (generation !== observationGeneration || !showManager.value) return
  const scroller = automaticDownloadsScroller.value
  const content = automaticDownloadsContent.value
  if (!scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => {
  observationGeneration += 1
  stopObservingContent()
})

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

const pendingRules = ref(null)
let ruleUpdateSequence = 0
const rules = computed(() => parseAutomaticDownloadRules(pendingRules.value ?? store.getters.getYtDlpAutomaticDownloadRules))
const channels = computed(() => {
  const allChannelsProfile = store.getters.getProfileList[0]
  const collator = new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })
  return [...(allChannelsProfile?.subscriptions ?? [])]
    .sort((a, b) => collator.compare(a.name || a.id, b.name || b.id))
})
const enabledRuleCount = computed(() => channels.value.filter(channel => rules.value[channel.id] !== undefined).length)
const visibleChannels = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (query === '') return channels.value
  return channels.value.filter(channel => (
    (channel.name || '').toLocaleLowerCase().includes(query) || channel.id.toLocaleLowerCase().includes(query)
  ))
})

const customTemplates = computed(() => {
  try {
    const parsed = JSON.parse(store.getters.getYtDlpDownloadTemplates || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})
const templateNames = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.label(t)),
  ...customTemplates.value.map(template => template.name)
])
const templateValues = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value),
  ...customTemplates.value.map(template => `template:${template.name}`)
])

function ruleFor(channelId) {
  return normalizeAutomaticDownloadRule(rules.value[channelId])
}

function saveRules(updateRules) {
  const sequence = ++ruleUpdateSequence
  // Keep unsaved edits in the editor so background downloads use saved rules.
  pendingRules.value = JSON.stringify(updateRules(rules.value))
  store.dispatch('updateYtDlpAutomaticDownloadRules', value => JSON.stringify(updateRules(parseAutomaticDownloadRules(value)))).finally(() => {
    if (sequence === ruleUpdateSequence) pendingRules.value = null
  }).catch(error => console.error(error))
}

function setChannelEnabled(channelId, enabled) {
  const enabledAt = Date.now()
  saveRules(currentRules => {
    const nextRules = { ...currentRules }
    if (enabled) {
      nextRules[channelId] = { ...DEFAULT_AUTOMATIC_DOWNLOAD_RULE, enabledAt }
    } else {
      delete nextRules[channelId]
    }
    return nextRules
  })
}

function updateRule(channelId, key, value) {
  saveRules(currentRules => {
    // A field edit must not re-enable a rule removed by another writer.
    if (currentRules[channelId] === undefined) return currentRules
    return {
      ...currentRules,
      [channelId]: {
        ...normalizeAutomaticDownloadRule(currentRules[channelId]),
        [key]: value
      }
    }
  })
}

function updateNumber(channelId, key, value) {
  const number = Number(value)
  updateRule(channelId, key, value === '' || !Number.isFinite(number) || number <= 0 ? null : number)
}

function displayNumber(value) {
  return value === null ? '' : String(value)
}
</script>

<style scoped>
.automaticDownloadsHeader {
  --input-bottom-spacing: 0;

  display: grid;
  gap: 20px;
  flex: none;
  padding-block: 0 20px;
  padding-inline: 20px;
}

.automaticDownloadsDescription {
  display: grid;
  gap: 8px;
}

.automaticDownloadsHeader p {
  margin: 0;
}

.automaticDownloadsHint,
.filterHint,
.emptyState {
  color: var(--tertiary-text-color);
}

.automaticDownloadsScroller {
  min-block-size: 0;
  flex: 1;
  padding-inline: 20px;
}

.channelRules {
  display: grid;
  gap: 16px;
  padding: 0 0 24px;
  margin: 0;
  list-style: none;
}

.channelRule {
  padding: 16px;
  border: 1px solid var(--tertiary-text-color);
  border-radius: calc(10px * var(--ui-roundness));
}

.channelRuleHeader {
  display: flex;
  align-items: center;
  gap: 12px;
}

.channelThumbnail {
  inline-size: 44px;
  block-size: 44px;
  flex: none;
  border-radius: 50%;
  object-fit: cover;
  font-size: 44px;
}

.channelThumbnailPlaceholder {
  display: flex;
}

.channelToggle {
  min-inline-size: 0;
  flex: 1;
}

.channelRuleOptions {
  --settings-control-margin: 0;
  --input-bottom-spacing: 0;

  display: grid;
  gap: 20px;
  padding-block-start: 20px;
}

.templateAndTypes,
.filterGrid,
.titleFilters {
  display: grid;
  gap: 20px;
}

.templateAndTypes {
  align-items: center;
  grid-template-columns: minmax(260px, 500px) repeat(3, minmax(0, max-content));
}

.templateSelect {
  inline-size: 100%;
}

.templateAndTypes :deep(.switch-label) {
  align-items: center;
  box-sizing: border-box;
  min-block-size: var(--form-control-height);
  display: inline-flex;
}

.filterGrid,
.titleFilters {
  grid-template-columns: repeat(2, minmax(0, 340px));
}

.filterHint {
  margin: 0;
  font-size: 0.9rem;
}

@container (width <= 760px) {
  .templateAndTypes {
    grid-template-columns: repeat(3, minmax(0, max-content));
  }

  .templateSelect {
    grid-column: 1 / -1;
  }
}

@container (width <= 600px) {
  .templateAndTypes,
  .filterGrid,
  .titleFilters {
    grid-template-columns: 1fr;
  }
}
</style>
