<template>
  <FtPrompt
    autosize
    fixed-layout
    :label="t('Subscriptions.RSS Feeds.RSSHub.Title')"
    :busy="busy"
    @click="emit('close')"
  >
    <div class="rssHubForm">
      <p class="formHint">
        {{ t('Subscriptions.RSS Feeds.RSSHub.Description') }}
      </p>
      <FtInput
        class="instanceInput"
        :label="t('Subscriptions.RSS Feeds.RSSHub.Instance')"
        placeholder="https://rsshub.example.com"
        :icon="['fas', 'server']"
        :show-label="true"
        :show-action-button="false"
        :show-data-when-empty="true"
        :select-on-click="true"
        :value="instanceText"
        :data-list="instanceUrls"
        :data-list-properties="instanceProperties"
        @input="instanceText = $event"
        @change="loadServices"
        @click="loadServices"
      />
      <p
        v-if="servicesError"
        class="formMessage error"
        role="alert"
      >
        <FtIcon
          :icon="['fas', 'circle-exclamation']"
          aria-hidden="true"
        />
        {{ t('Subscriptions.RSS Feeds.RSSHub.Services Could Not Be Loaded') }}
      </p>
      <FtInput
        ref="serviceInput"
        class="serviceInput"
        :label="t('Subscriptions.RSS Feeds.RSSHub.Service')"
        :placeholder="servicesLoading ? t('Subscriptions.RSS Feeds.RSSHub.Loading Services') : t('Subscriptions.RSS Feeds.RSSHub.Search Services')"
        :icon="['fas', 'globe']"
        :show-label="true"
        :show-action-button="false"
        :show-data-when-empty="true"
        :disabled="services.length === 0"
        :value="serviceText"
        :data-list="serviceLabels"
        @input="searchServices"
        @click="selectService"
      />
      <template v-if="service">
        <FtSelect
          :placeholder="t('Subscriptions.RSS Feeds.RSSHub.Feed Type')"
          :icon="['fas', 'list']"
          :value="routePath"
          :select-names="service.routes.map(serviceRoute => serviceRoute.name)"
          :select-values="service.routes.map(serviceRoute => serviceRoute.path)"
          @change="selectRoute"
        />
        <p
          v-if="route?.requiresConfig"
          class="formMessage"
        >
          <FtIcon
            :icon="['fas', 'triangle-exclamation']"
            aria-hidden="true"
          />
          {{ t('Subscriptions.RSS Feeds.RSSHub.Requires Configuration') }}
        </p>
        <template
          v-for="parameter in route?.parameters ?? []"
          :key="`${routePath}:${parameter.name}`"
        >
          <FtSelect
            v-if="parameter.options.length > 0"
            :placeholder="parameterLabel(parameter)"
            :value="parameterValues[parameter.name] ?? ''"
            :select-names="parameterOptions(parameter).map(option => option.label)"
            :select-values="parameterOptions(parameter).map(option => option.value)"
            :tooltip="parameter.description"
            @change="value => parameterValues[parameter.name] = value"
          />
          <FtInput
            v-else
            :label="parameterLabel(parameter)"
            :placeholder="parameter.example ? t('Form Inputs.Example', { example: parameter.example }) : parameter.name"
            :supporting-text="parameter.description"
            :show-label="true"
            :show-action-button="false"
            :value="parameterValues[parameter.name] ?? ''"
            @input="value => parameterValues[parameter.name] = value"
            @click="addFeed"
          />
        </template>
        <p
          v-if="feed.url"
          class="feedUrlPreview"
        >
          {{ feed.url }}
        </p>
      </template>
    </div>
    <template #footer>
      <FtFlexBox>
        <FtButton
          theme="primary"
          :label="t('Subscriptions.RSS Feeds.Add Feed')"
          :icon="['fas', 'plus']"
          :disabled="!feed.url || busy"
          @click="addFeed"
        />
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="emit('close')"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'

import store from '../../../store/index'
import {
  buildRssHubFeedUrl,
  fetchRssHubInstances,
  fetchRssHubServices,
  normalizeRssHubInstance
} from '../../../helpers/rssHub'

defineProps({
  busy: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['add', 'close'])

const { t } = useI18n()

/** @type {import('vue').ShallowRef<import('../../../helpers/rssHub').RssHubInstance[]>} */
const instances = shallowRef([])
const instanceUrls = computed(() => instances.value.map(instance => instance.url))
const instanceProperties = computed(() => instances.value.map(instance => ({
  displayText: [new URL(instance.url).host + new URL(instance.url).pathname.replace(/\/$/, ''), instance.location].filter(Boolean).join(' ')
})))
const instanceText = ref(store.getters.getRssHubInstance)

/** The instance that the services belong to */
const instance = ref('')
/** @type {import('vue').ShallowRef<import('../../../helpers/rssHub').RssHubService[]>} */
const services = shallowRef([])
const servicesLoading = ref(false)
const servicesError = ref(false)

/** @type {import('vue').ShallowRef<import('../../../helpers/rssHub').RssHubService | null>} */
const service = shallowRef(null)
const serviceText = ref('')
// Names that start with the search come first, matches only in the address last
const rankedServices = computed(() => {
  const query = serviceText.value.trim().toLocaleLowerCase()
  if (query === '' || service.value !== null) return services.value
  const rank = (/** @type {import('../../../helpers/rssHub').RssHubService} */ item) => {
    const name = item.name.toLocaleLowerCase()
    if (name.startsWith(query)) return 0
    if (name.split(/[\s\-_.·:()]+/).some(word => word.startsWith(query))) return 1
    return name.includes(query) ? 2 : 3
  }
  return services.value
    .map(item => ({ item, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item)
})
const serviceLabels = computed(() => rankedServices.value.map(serviceLabel))
const serviceInput = useTemplateRef('serviceInput')
const routePath = ref('')
const route = computed(() => service.value?.routes.find(serviceRoute => serviceRoute.path === routePath.value) ?? null)
/** @type {import('vue').Ref<Record<string, string>>} */
const parameterValues = ref({})

const feed = computed(() => service.value && route.value
  ? buildRssHubFeedUrl(instance.value, service.value.id, route.value, parameterValues.value)
  : { url: null, missing: [] })

onMounted(async () => {
  if (instanceText.value !== '') loadServices()
  try {
    instances.value = await fetchRssHubInstances()
  } catch (error) {
    // A custom instance still works without the public list
    console.error('Failed to load the public RSSHub instances', error)
  }
})

// Some services share a name and site, so their ID tells them apart
const serviceLabelsById = computed(() => {
  const labels = services.value.map(item => item.url ? `${item.name} (${item.url})` : item.name)
  return new Map(services.value.map((item, index) => [item.id,
    labels.indexOf(labels[index]) === labels.lastIndexOf(labels[index]) ? labels[index] : `${labels[index]} · ${item.id}`]))
})

/**
 * @param {import('../../../helpers/rssHub').RssHubService} item
 */
function serviceLabel(item) {
  return serviceLabelsById.value.get(item.id) ?? item.name
}

let servicesGeneration = 0

async function loadServices() {
  const url = normalizeRssHubInstance(instanceText.value)
  if (url === instance.value && (servicesLoading.value || services.value.length > 0)) return

  const generation = ++servicesGeneration
  instance.value = url ?? ''
  services.value = []
  service.value = null
  serviceText.value = ''
  servicesError.value = false
  if (url === null) {
    servicesError.value = instanceText.value.trim() !== ''
    return
  }

  servicesLoading.value = true
  try {
    const result = await fetchRssHubServices(url)
    if (generation !== servicesGeneration) return
    services.value = result
    if (store.getters.getRssHubInstance !== url) store.dispatch('updateRssHubInstance', url)
    await nextTick()
    serviceInput.value?.focus()
  } catch (error) {
    if (generation !== servicesGeneration) return
    console.error('Failed to load the RSSHub services', error)
    servicesError.value = true
  } finally {
    if (generation === servicesGeneration) servicesLoading.value = false
  }
}

/**
 * @param {string} text
 */
function searchServices(text) {
  serviceText.value = text
  // Editing the name starts a new search
  if (service.value && text !== serviceLabel(service.value)) service.value = null
}

/**
 * Takes the picked suggestion, or the best match for typed text.
 * @param {string} text
 */
function selectService(text) {
  const query = text.trim().toLocaleLowerCase()
  if (query === '') return
  const match = services.value.find(item => serviceLabel(item).toLocaleLowerCase() === query || item.name.toLocaleLowerCase() === query) ??
    rankedServices.value.find(item => serviceLabel(item).toLocaleLowerCase().includes(query))
  if (!match) return

  service.value = match
  serviceText.value = serviceLabel(match)
  selectRoute(match.routes[0].path)
}

/**
 * @param {string} path
 */
function selectRoute(path) {
  routePath.value = path
  const selected = service.value?.routes.find(serviceRoute => serviceRoute.path === path)
  parameterValues.value = Object.fromEntries((selected?.parameters ?? [])
    .filter(parameter => parameter.options.length > 0)
    .map(parameter => {
      const options = parameterOptions(parameter)
      const preset = options.find(option => option.value === parameter.default) ?? options[0]
      return [parameter.name, preset.value]
    }))
}

/**
 * @param {import('../../../helpers/rssHub').RssHubParameter} parameter
 */
function parameterLabel(parameter) {
  return parameter.optional
    ? t('Subscriptions.RSS Feeds.RSSHub.Optional Parameter', { parameter: parameter.name })
    : parameter.name
}

/**
 * Optional parameters without a listed default can stay unset.
 * @param {import('../../../helpers/rssHub').RssHubParameter} parameter
 */
function parameterOptions(parameter) {
  return parameter.optional && !parameter.options.some(option => option.value === parameter.default)
    ? [{ value: '', label: t('Subscriptions.RSS Feeds.RSSHub.Not Set') }, ...parameter.options]
    : parameter.options
}

function addFeed() {
  if (feed.value.url) emit('add', feed.value.url)
}
</script>

<style scoped src="./RssHubFeedPrompt.css" />
