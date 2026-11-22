<template>
  <div class="platformFilters">
    <div class="filterControls">
      <FtSelect
        :placeholder="t('Global.Sort By')"
        :value="filters.sort"
        :select-names="sortNames"
        :select-values="options.sorts"
        :icon="SORT_ICONS[filters.sort]"
        @change="emit('change', { sort: $event === options.defaultSort ? undefined : $event })"
      />
      <FtSelect
        v-if="options.types"
        :placeholder="t('Platforms.Video Type.Video Type')"
        :value="filters.type ?? ALL"
        :select-names="typeNames"
        :select-values="[ALL, ...options.types]"
        :icon="['fas', 'video']"
        @change="emit('change', { type: $event || undefined })"
      />
      <FtSelect
        v-if="platform.filterLanguages"
        multiple
        searchable
        :placeholder="t('Platforms.Language')"
        :value="languages.length > 0 ? languages : [ALL]"
        :select-names="languageOptions.names"
        :select-values="languageOptions.values"
        :icon="['fas', 'language']"
        @change="changeLanguages"
      />
      <FtInput
        v-if="searchesTags"
        class="tagSearch"
        input-type="search"
        :label="t('Platforms.Stream Tags')"
        :placeholder="t('Platforms.Search Tags')"
        :action-button-label="t('Platforms.Add Tag')"
        :force-action-button-icon-name="['fas', 'plus']"
        :icon="['fas', 'hashtag']"
        :value="tagQuery"
        :maxlength="25"
        :data-list="tagSuggestions"
        @input="searchTags"
        @click="addTag"
      />
    </div>
    <ul
      v-if="tags.length > 0"
      class="selectedTags"
      :aria-label="t('Platforms.Stream Tags')"
    >
      <li
        v-for="tag in tags"
        :key="tag"
        class="tagChip"
      >
        <bdi>{{ tag }}</bdi>
        <button
          type="button"
          class="removeTagButton"
          :title="t('Platforms.Remove Tag', { tag })"
          :aria-label="t('Platforms.Remove Tag', { tag })"
          @click="emit('change', { tag: tags.filter(value => value !== tag) })"
        >
          <FtIcon
            :icon="['fas', 'xmark']"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtInput from '../FtInput/FtInput.vue'
import FtSelect from '../FtSelect/FtSelect.vue'

import { getPlatformFetch } from '../../helpers/platformFetch'

/**
 * @typedef {import('../../../platforms/types').PlatformCategorySort} PlatformCategorySort
 * @typedef {import('../../../platforms/types').PlatformVideoType} PlatformVideoType
 */

/** @type {Record<PlatformCategorySort, string[]>} */
const SORT_ICONS = {
  viewers: ['fas', 'arrow-down-wide-short'],
  viewers_ascending: ['fas', 'arrow-down-short-wide'],
  started: ['fas', 'clock'],
  relevance: ['fas', 'thumbs-up'],
  published: ['fas', 'clock'],
  views: ['fas', 'arrow-down-wide-short'],
  top_day: ['fas', 'fire'],
  top_week: ['fas', 'fire'],
  top_month: ['fas', 'fire'],
  top_all: ['fas', 'fire']
}
// The first option of the type and language lists, which none of the others
// are checked with. Choosing it clears them.
const ALL = ''
const TAG_SEARCH_DELAY_MS = 300

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').Platform>} */
  platform: {
    type: Object,
    required: true
  },
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformFilterOptions>} */
  options: {
    type: Object,
    required: true
  },
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformFilters>} */
  filters: {
    type: Object,
    required: true
  }
})

// The query values to change: `sort`, `type`, `language` and `tag`
const emit = defineEmits(['change'])

const { t, locale } = useI18n()

const languages = computed(() => props.filters.languages ?? [])
const tags = computed(() => props.filters.tags ?? [])
const searchesTags = computed(() => props.options.tags === true && typeof props.platform.searchStreamTags === 'function')

const sortNames = computed(() => {
  /** @type {Record<PlatformCategorySort, string>} */
  const names = {
    viewers: t('Platforms.Sort.Viewers'),
    viewers_ascending: t('Platforms.Sort.Viewers Ascending'),
    started: t('Platforms.Sort.Started'),
    relevance: t('Platforms.Sort.Relevance'),
    published: t('Platforms.Sort.Published'),
    views: t('Platforms.Sort.Views'),
    top_day: t('Platforms.Sort.Top Day'),
    top_week: t('Platforms.Sort.Top Week'),
    top_month: t('Platforms.Sort.Top Month'),
    top_all: t('Platforms.Sort.Top All')
  }
  return props.options.sorts.map(sort => names[sort])
})

const typeNames = computed(() => {
  /** @type {Record<PlatformVideoType, string>} */
  const names = {
    archive: t('Platforms.Video Type.Archive'),
    highlight: t('Platforms.Video Type.Highlight'),
    upload: t('Platforms.Video Type.Upload')
  }
  return [t('Platforms.Video Type.All'), ...(props.options.types ?? []).map(type => names[type])]
})

// Languages by their names in the app's language, the catch-all last
const languageOptions = computed(() => {
  const displayNames = new Intl.DisplayNames([locale.value, 'en'], { type: 'language' })
  const codes = props.platform.filterLanguages ?? []
  const named = codes
    .filter(code => code !== 'other')
    // ICU doesn't name American Sign Language in every locale
    .map(code => ({ code, name: code === 'ase' ? t('Platforms.American Sign Language') : displayNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale.value))
  if (codes.includes('other')) named.push({ code: 'other', name: t('Platforms.Other Language') })
  return {
    names: [t('Platforms.All Languages'), ...named.map(({ name }) => name)],
    values: [ALL, ...named.map(({ code }) => code)]
  }
})

/**
 * @param {string[]} values
 */
function changeLanguages(values) {
  // Checking all languages clears the others, and checking another unchecks it
  const allChecked = values.includes(ALL) && languages.value.length > 0
  emit('change', { language: allChecked ? [] : values.filter(value => value !== ALL) })
}

const tagQuery = ref('')
/** @type {import('vue').Ref<string[]>} */
const tagSuggestions = ref([])
/** @type {ReturnType<typeof setTimeout> | undefined} */
let tagSearchTimer
/** @type {AbortController | null} */
let tagSearchController = null

/**
 * @param {string} text
 */
function searchTags(text) {
  tagQuery.value = text
  clearTimeout(tagSearchTimer)
  tagSearchController?.abort()
  const search = props.platform.searchStreamTags
  if (!search || !text.trim()) {
    tagSuggestions.value = []
    return
  }
  tagSearchTimer = setTimeout(async () => {
    const controller = new AbortController()
    tagSearchController = controller
    try {
      const suggestions = await search(getPlatformFetch(props.platform.id), text, controller.signal)
      if (!controller.signal.aborted) tagSuggestions.value = suggestions.filter(tag => !tags.value.includes(tag))
    } catch (error) {
      if (!controller.signal.aborted) console.error('Failed to search tags', error)
    }
  }, TAG_SEARCH_DELAY_MS)
}

/**
 * @param {string} text
 */
function addTag(text) {
  const tag = text.trim()
  searchTags('')
  if (tag && !tags.value.some(value => value.toLowerCase() === tag.toLowerCase())) {
    emit('change', { tag: [...tags.value, tag] })
  }
}

onBeforeUnmount(() => {
  clearTimeout(tagSearchTimer)
  tagSearchController?.abort()
})
</script>

<style scoped>
/* Cards only pad their top a little, for list items that bring their own
   padding. The labels stand out of the selects' outlines by 7px, so this puts
   them as far below the card's edge as the card's inline padding. */
.platformFilters {
  margin-block-start: calc(16px * var(--ui-density) + 4px);
}

.filterControls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14em), 1fr));
  align-items: end;
  gap: 12px 16px;
}

/* The grid sizes the controls instead of their own widths */
.filterControls > * {
  inline-size: auto;
  min-inline-size: 0;
  margin: 0;
}

/* Without the space it keeps below for messages, the field lines up with the selects */
.tagSearch {
  --input-bottom-spacing: 0;
}

.selectedTags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-block: 12px 0;
  margin-inline: 0;
  padding: 0;
  list-style: none;
}

.tagChip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-block: 2px;
  padding-inline: 10px 2px;
  border-radius: var(--shape-corner-full);
  background-color: color-mix(in srgb, var(--primary-color) 20%, transparent);
  font-size: 13px;
  line-height: 20px;
}

.removeTagButton {
  display: grid;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}

.removeTagButton:hover,
.removeTagButton:focus-visible {
  background-color: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
}
</style>
