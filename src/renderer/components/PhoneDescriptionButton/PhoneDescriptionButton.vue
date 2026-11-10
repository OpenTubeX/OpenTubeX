<template>
  <button
    v-if="parsedDescription.excerpt || parsedDescription.hasImages || chips.length > 0 || license"
    type="button"
    class="phonePanelButton phonePanelCard phoneDescriptionButton"
    aria-haspopup="dialog"
    :aria-expanded="panelOpen"
    :aria-label="t('Description.Title')"
    :aria-describedby="describedBy"
    @click="emit('open')"
    @keydown.space.stop
    @keyup.space.stop
  >
    <span class="phoneDescriptionContent">
      <span class="phoneDescriptionHeading">
        <FtIcon
          :icon="['fas', 'file-lines']"
          aria-hidden="true"
        />
        <span class="phoneDescriptionTitle">{{ t('Description.Title') }}</span>
        <FtIcon
          :icon="['fas', 'angle-down']"
          aria-hidden="true"
        />
      </span>
      <span
        v-if="parsedDescription.excerpt"
        :id="`${id}-excerpt`"
        class="phoneDescriptionExcerpt"
        dir="auto"
      >{{ parsedDescription.excerpt }}</span>
      <span
        v-if="chips.length > 0"
        :id="`${id}-chips`"
        class="phoneDescriptionChips"
      >
        <span
          v-for="chip in chips"
          :key="chip.key"
          class="phoneDescriptionChip"
        >
          <FtIcon
            :icon="['fas', chip.icon]"
            aria-hidden="true"
          />
          <bdi>{{ chip.label }}</bdi>
          <span
            v-if="chip.count"
            class="phoneDescriptionChipCount"
          >{{ formatNumber(chip.count) }}</span>
        </span>
      </span>
    </span>
  </button>
</template>

<script setup>
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import { formatNumber } from '../../helpers/utils'

const props = defineProps({
  description: { type: String, default: '' },
  descriptionHtml: { type: String, default: '' },
  tags: { type: Array, default: () => [] },
  license: { type: String, default: null },
  games: { type: Array, default: () => [] },
  musicTracks: { type: Array, default: () => [] },
  contentDisclosures: { type: Array, default: () => [] },
  panelOpen: { type: Boolean, default: false }
})
const EXCERPT_LENGTH = 300

const emit = defineEmits(['open'])
const { t } = useI18n()
const id = useId()

const parsedDescription = computed(() => {
  // Prefer the escaped HTML (Invidious), since `description` is plain text there.
  // Without it, `description` can hold markup, e.g. formatted text runs from the local API.
  // Template contents stay inert while extracting text from remote HTML.
  const template = document.createElement('template')
  template.innerHTML = props.descriptionHtml || props.description || ''
  // Yattee separates lines with <br>, and textContent adds no space at line or block boundaries.
  for (const element of template.content.querySelectorAll('br, p, div, li')) {
    element.before(' ')
    element.after(' ')
  }
  const text = (template.content.textContent ?? '').replaceAll(/\s+/g, ' ').trim()
  return {
    // Longer than two lines on any phone, but keeps the button's accessible description short.
    excerpt: Array.from(text).slice(0, EXCERPT_LENGTH).join(''),
    // A description of only custom emoji images has no text, but the sheet still shows it.
    hasImages: template.content.querySelector('img') !== null
  }
})

const chips = computed(() => [
  ...[...new Set((props.contentDisclosures ?? []).map(item => item.label).filter(Boolean))]
    .map(label => ({ key: `disclosure-${label}`, icon: 'circle-info', label })),
  props.musicTracks.length > 0 && { key: 'music', icon: 'music', label: t('Description.Music'), count: props.musicTracks.length },
  props.games.length > 0 && { key: 'games', icon: 'gamepad', label: t('Description.Games'), count: props.games.length },
  props.tags.length > 0 && { key: 'tags', icon: 'hashtag', label: t('Description.Video Tags'), count: props.tags.length },
].filter(Boolean))

const describedBy = computed(() => [
  parsedDescription.value.excerpt && `${id}-excerpt`,
  chips.value.length > 0 && `${id}-chips`
].filter(Boolean).join(' ') || null)
</script>

<style scoped src="./PhoneDescriptionButton.css" />
<style scoped src="../phonePanelCard.css" />
