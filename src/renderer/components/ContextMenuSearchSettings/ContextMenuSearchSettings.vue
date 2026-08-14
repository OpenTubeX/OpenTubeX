<template>
  <FtSettingsSection
    :title="t('Settings.Context Menu Search Settings.Context Menu Search Settings')"
  >
    <p class="description">
      {{ t('Settings.Context Menu Search Settings.Description') }}
    </p>
    <p class="hint">
      {{ t('Settings.Context Menu Search Settings.Icon Hint') }}
    </p>

    <div class="engineList">
      <div
        v-for="engine in searchEngines"
        :key="engine.id"
        class="engineRow"
      >
        <div class="engineToggle">
          <img
            v-if="hasFavicon(engine)"
            class="engineIcon"
            :src="engine.icon"
            alt=""
            referrerpolicy="no-referrer"
            @error="handleFaviconError(engine)"
          >
          <FtIcon
            v-else
            class="engineIcon fallbackIcon"
            :icon="['fas', 'search']"
          />
          <FtToggleSwitch
            :label="engine.name"
            :default-value="engine.enabled"
            :compact="true"
            @change="updateEnabled(engine.id, $event)"
          />
        </div>
        <template v-if="engine.id.startsWith('custom-')">
          <FtInput
            :key="inputKey(engine.id, 'name')"
            :placeholder="t('Settings.Context Menu Search Settings.Engine Name')"
            :value="engine.name"
            :show-action-button="false"
            @blur="updateCustomEngine(engine.id, 'name', $event)"
          />
          <FtInput
            :key="inputKey(engine.id, 'url')"
            input-type="url"
            :placeholder="t('Settings.Context Menu Search Settings.Search URL')"
            :value="engine.url"
            :show-action-button="false"
            @blur="updateCustomEngine(engine.id, 'url', $event)"
          />
          <button
            class="removeEngine"
            :aria-label="t('Settings.Context Menu Search Settings.Remove Engine', { engine: engine.name })"
            :title="t('Settings.Context Menu Search Settings.Remove Engine', { engine: engine.name })"
            @click="removeEngine(engine.id)"
          >
            <FtIcon :icon="['fas', 'trash']" />
          </button>
        </template>
        <code v-else>{{ engine.url }}</code>
      </div>
    </div>

    <h3>{{ t('Settings.Context Menu Search Settings.Add Custom Engine') }}</h3>
    <div class="addEngine">
      <FtInput
        :placeholder="t('Settings.Context Menu Search Settings.Engine Name')"
        :value="customName"
        :show-action-button="false"
        @input="customName = $event"
      />
      <FtInput
        input-type="url"
        :placeholder="t('Settings.Context Menu Search Settings.Search URL')"
        :value="customUrl"
        :show-action-button="false"
        @input="customUrl = $event"
        @keydown.enter="addCustomEngine"
      />
      <FtButton
        :label="t('Settings.Context Menu Search Settings.Add Engine')"
        :icon="['fas', 'plus']"
        @click="addCustomEngine"
      />
    </div>
    <p class="hint">
      {{ t('Settings.Context Menu Search Settings.URL Hint') }}
    </p>
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import {
  isValidSearchUrlTemplate,
  MAX_CUSTOM_SEARCH_ENGINES,
  parseSearchEngines
} from '../../../searchEngines'

const { t } = useI18n()
const customName = ref('')
const customUrl = ref('')
const failedFavicons = ref(new Set())
const resolvedFavicons = ref(new Map())
const inputRevisions = ref(new Map())

const configuredSearchEngines = computed(() => {
  return parseSearchEngines(store.getters.getContextMenuSearchEngines)
})

const searchEngines = computed(() => {
  return configuredSearchEngines.value.map(engine => ({
    ...engine,
    icon: resolvedFavicons.value.get(engine.url) ?? ''
  }))
})

function saveSearchEngines(engines) {
  const settings = engines.map(({ id, name, url, enabled }) => ({ id, name, url, enabled }))
  store.dispatch('updateContextMenuSearchEngines', JSON.stringify(settings))
}

function hasFavicon(engine) {
  return engine.icon.length > 0 && !failedFavicons.value.has(`${engine.id}:${engine.icon}`)
}

function handleFaviconError(engine) {
  failedFavicons.value = new Set([...failedFavicons.value, `${engine.id}:${engine.icon}`])
}

watch(configuredSearchEngines, (engines) => {
  for (const engine of engines) {
    if (!engine.enabled || resolvedFavicons.value.has(engine.url)) continue

    window.ftElectron.resolveFavicon(engine.url).then(icon => {
      resolvedFavicons.value = new Map([...resolvedFavicons.value, [engine.url, icon]])
    }).catch(() => {})
  }
}, { immediate: true })

function updateEnabled(id, enabled) {
  saveSearchEngines(searchEngines.value.map(engine => (
    engine.id === id ? { ...engine, enabled } : engine
  )))
}

function showInvalidEngineToast() {
  showToast({
    message: t('Settings.Context Menu Search Settings.Invalid Engine'),
    icon: ['fas', 'circle-exclamation']
  })
}

function showEngineLimitToast() {
  const count = MAX_CUSTOM_SEARCH_ENGINES

  showToast({
    message: t('Settings.Context Menu Search Settings.Engine Limit', {
      count
    }, count),
    icon: ['fas', 'circle-exclamation']
  })
}

function inputKey(id, field) {
  return `${id}:${field}:${inputRevisions.value.get(`${id}:${field}`) ?? 0}`
}

function resetCustomEngineInput(id, field) {
  const key = `${id}:${field}`
  inputRevisions.value = new Map([
    ...inputRevisions.value,
    [key, (inputRevisions.value.get(key) ?? 0) + 1]
  ])
}

function updateCustomEngine(id, field, value) {
  const trimmedValue = value.trim()
  if (
    (field === 'name' && (trimmedValue.length === 0 || trimmedValue.length > 50)) ||
    (field === 'url' && !isValidSearchUrlTemplate(trimmedValue))
  ) {
    showInvalidEngineToast()
    resetCustomEngineInput(id, field)
    return
  }

  saveSearchEngines(searchEngines.value.map(engine => (
    engine.id === id ? { ...engine, [field]: trimmedValue } : engine
  )))
}

function addCustomEngine() {
  const name = customName.value.trim()
  const url = customUrl.value.trim()
  if (name.length === 0 || name.length > 50 || !isValidSearchUrlTemplate(url)) {
    showInvalidEngineToast()
    return
  }
  const customEngineCount = searchEngines.value
    .filter(engine => engine.id.startsWith('custom-'))
    .length
  if (customEngineCount >= MAX_CUSTOM_SEARCH_ENGINES) {
    showEngineLimitToast()
    return
  }

  saveSearchEngines([
    ...searchEngines.value,
    {
      id: `custom-${crypto.randomUUID()}`,
      name,
      url,
      enabled: true
    }
  ])
  customName.value = ''
  customUrl.value = ''
}

function removeEngine(id) {
  saveSearchEngines(searchEngines.value.filter(engine => engine.id !== id))
}
</script>

<style scoped src="./ContextMenuSearchSettings.css" />
