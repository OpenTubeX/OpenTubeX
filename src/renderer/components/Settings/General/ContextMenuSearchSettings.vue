<template>
  <FtSettingsSection
    :title="t('Settings.Context Menu Search Settings.Context Menu Search Settings')"
    :icon="['fas', 'magnifying-glass']"
    sync-setting-key="contextMenuSearchEngines"
  >
    <p class="description">
      {{ t('Settings.Context Menu Search Settings.Description') }}
    </p>
    <p class="hint">
      {{ t('Settings.Context Menu Search Settings.Icon Hint') }}
    </p>

    <div
      ref="engineList"
      class="engineList"
    >
      <div
        v-for="engine in searchEngines"
        :key="engine.id"
        class="engineRow"
      >
        <div class="engineToggle">
          <FtRetryImage
            v-if="hasFavicon(engine)"
            :fallback-icon="['fas', 'search']"
            class="engineIcon"
            :src="engine.icon"
            alt=""
            referrerpolicy="no-referrer"
            @error="handleFaviconError(engine)"
          />
          <FtIcon
            v-else
            class="engineIcon fallbackIcon"
            :icon="['fas', 'search']"
          />
          <FtToggleSwitch
            :label="engine.name"
            :default-value="engine.enabled"
            :compact="true"
            :hide-label="isCustomEngine(engine)"
            @change="updateEnabled(engine.id, $event)"
          />
          <template v-if="isCustomEngine(engine)">
            <input
              v-if="isEditing(engine.id, 'name')"
              v-model="editingValue"
              class="engineNameInput"
              type="text"
              maxlength="50"
              :placeholder="t('Form Inputs.Example', { example: 'DuckDuckGo' })"
              :aria-label="t('Settings.Context Menu Search Settings.Engine Name')"
              :data-engine-name-input="engine.id"
              data-settings-escape-scope
              @blur="finishEdit(engine.id, 'name')"
              @keydown="handleEditKeydown($event, engine.id, 'name')"
            >
            <button
              v-else
              type="button"
              class="engineEditButton engineNameButton"
              :data-engine-name-button="engine.id"
              :aria-label="t('Settings.Context Menu Search Settings.Rename Engine', { engine: engine.name })"
              :title="t('Settings.Context Menu Search Settings.Rename Engine', { engine: engine.name })"
              @click="startEdit(engine, 'name')"
            >
              <span>{{ engine.name }}</span>
              <FtIcon
                :icon="['fas', 'edit']"
                aria-hidden="true"
              />
            </button>
          </template>
        </div>
        <template v-if="isCustomEngine(engine)">
          <input
            v-if="isEditing(engine.id, 'url')"
            v-model="editingValue"
            class="engineUrlInput"
            type="url"
            dir="ltr"
            :aria-label="t('Settings.Context Menu Search Settings.Search URL')"
            :data-engine-url-input="engine.id"
            data-settings-escape-scope
            @blur="finishEdit(engine.id, 'url')"
            @keydown="handleEditKeydown($event, engine.id, 'url')"
          >
          <button
            v-else
            type="button"
            class="engineEditButton engineUrlButton"
            :data-engine-url-button="engine.id"
            :aria-label="t('Settings.Context Menu Search Settings.Edit Engine URL', { engine: engine.name })"
            :title="t('Settings.Context Menu Search Settings.Edit Engine URL', { engine: engine.name })"
            @click="startEdit(engine, 'url')"
          >
            <code dir="ltr">{{ engine.url }}</code>
            <FtIcon
              :icon="['fas', 'edit']"
              aria-hidden="true"
            />
          </button>
          <FtIconButton
            class="removeEngine"
            :title="t('Settings.Context Menu Search Settings.Remove Engine', { engine: engine.name })"
            :icon="['fas', 'trash']"
            theme="destructive"
            @click="removeEngine(engine.id)"
          />
        </template>
        <code
          v-else
          dir="ltr"
        >{{ engine.url }}</code>
      </div>
    </div>

    <h3>{{ t('Settings.Context Menu Search Settings.Add Custom Engine') }}</h3>
    <div class="addEngine">
      <FtInput
        :label="t('Settings.Context Menu Search Settings.Engine Name')"
        :icon="['fas', 'font']"
        :placeholder="t('Form Inputs.Example', { example: 'DuckDuckGo' })"
        :value="customName"
        :show-action-button="false"
        @input="customName = $event"
      />
      <FtInput
        input-type="url"
        :label="t('Settings.Context Menu Search Settings.Search URL')"
        :icon="['fas', 'link']"
        placeholder="https://example.com/search?q=%s"
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
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtIconButton from '../../FtIconButton/FtIconButton.vue'
import FtRetryImage from '../../FtRetryImage.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { resolveSearchEngineFavicon } from '../../../helpers/searchEngineFavicon'
import { showToast } from '../../../helpers/utils'
import {
  isValidSearchUrlTemplate,
  MAX_CUSTOM_SEARCH_ENGINES,
  parseSearchEngines
} from '../../../../searchEngines'

const { t } = useI18n()
const customName = ref('')
const customUrl = ref('')
const failedFavicons = ref(new Set())
const resolvedFavicons = ref(new Map())
// The custom engine field being edited, as { id, field }.
const editing = ref(null)
const editingValue = ref('')
const engineList = useTemplateRef('engineList')

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

    resolveSearchEngineFavicon(engine.url).then(icon => {
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

function isCustomEngine(engine) {
  return engine.id.startsWith('custom-')
}

function updateCustomEngine(id, changes) {
  saveSearchEngines(searchEngines.value.map(engine => (
    engine.id === id ? { ...engine, ...changes } : engine
  )))
}

async function focusEngineElement(attribute, id) {
  await nextTick()
  const element = engineList.value?.querySelector(`[${attribute}="${CSS.escape(id)}"]`)
  element?.focus()
  return element
}

function isEditing(id, field) {
  return editing.value?.id === id && editing.value.field === field
}

async function startEdit(engine, field) {
  editing.value = { id: engine.id, field }
  editingValue.value = engine[field]
  const input = await focusEngineElement(`data-engine-${field}-input`, engine.id)
  input?.select()
}

function stopEdit(id, field, keepFocus) {
  editing.value = null
  editingValue.value = ''
  if (keepFocus) focusEngineElement(`data-engine-${field}-button`, id)
}

function finishEdit(id, field, keepFocus = false) {
  if (!isEditing(id, field)) return
  const value = editingValue.value.trim()
  stopEdit(id, field, keepFocus)

  if (field === 'name') {
    // Like renaming a tab group, an empty name keeps the old one.
    if (value.length > 0) updateCustomEngine(id, { name: value })
  } else if (isValidSearchUrlTemplate(value)) {
    updateCustomEngine(id, { url: value })
  } else {
    // The saved address stays.
    showInvalidEngineToast()
  }
}

function cancelEdit(id, field) {
  if (!isEditing(id, field)) return
  stopEdit(id, field, true)
}

function handleEditKeydown(event, id, field) {
  // An IME confirms or cancels its composition with Enter and Escape.
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    finishEdit(id, field, true)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelEdit(id, field)
  }
}

function addCustomEngine() {
  const name = customName.value.trim()
  const url = customUrl.value.trim()
  if (name.length === 0 || name.length > 50 || !isValidSearchUrlTemplate(url)) {
    showInvalidEngineToast()
    return
  }
  const customEngineCount = searchEngines.value.filter(isCustomEngine).length
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
