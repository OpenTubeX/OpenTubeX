<template>
  <FtIconButton
    ref="iconButton"
    class="shareButton"
    :title="shareTitle"
    theme="secondary"
    :size="size"
    :icon="['fas', 'share-alt']"
    :dropdown-modal-on-mobile="true"
    dropdown-position-x="left"
    dropdown-class="content-width"
    :dropdown-position-y="dropdownPositionY"
    :force-dropdown="true"
  >
    <div class="shareMenu">
      <div
        v-if="isVideo && !externalUrl"
        class="shareTimestamp"
      >
        <FtIcon
          class="shareTimestampIcon"
          :icon="['fas', 'clock']"
          aria-hidden="true"
        />
        <FtToggleSwitch
          :label="t('Share.Include Timestamp')"
          compact
          trailing
          :default-value="includeTimestamp"
          @change="updateIncludeTimestamp"
        />
      </div>
      <div class="shareLinks">
        <template
          v-for="(section, sectionIndex) in shareSections"
          :key="section.id"
        >
          <div
            v-if="sectionIndex > 0"
            class="shareSectionDivider"
          />
          <section
            class="shareSection"
            :aria-labelledby="section.id"
          >
            <div
              :id="section.id"
              class="shareSectionHeader"
            >
              <img
                v-if="section.kind === 'youtube'"
                class="youtubeLogo"
                src="~../../assets/img/yt_logo_mono_dark.png"
                alt="YouTube"
                width="794"
                height="178"
              >
              <template v-else-if="section.kind === 'invidious'">
                <span class="invidiousLogo" /> Invidious
              </template>
              <template v-else>
                {{ section.label }}
              </template>
            </div>
            <template
              v-for="action in section.actions"
              :key="action.label"
            >
              <div
                v-if="action.embedStart"
                class="shareActionDivider"
              />
              <button
                type="button"
                class="shareAction promptAction"
                @click="action.run"
              >
                <FtIcon
                  :icon="action.icon"
                  aria-hidden="true"
                />
                <span>{{ action.label }}</span>
              </button>
            </template>
          </section>
        </template>
      </div>
    </div>
  </FtIconButton>
</template>

<script setup>
import { computed, ref, useId, useTemplateRef } from 'vue'
import { copyToClipboard, openExternalLink, shareLink } from '../../helpers/utils'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { useI18n } from 'vue-i18n'

import { FtIcon } from '@opentubex/icons'

import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'
import { usesInvidiousInstance } from '../../../apiBackends'

const { t } = useI18n()
const canShare = process.env.IS_CAPACITOR || (process.env.IS_ELECTRON && ['darwin', 'win32'].includes(process.platform))

const props = defineProps({
  shareTargetType: {
    /**
     * Allows to render the dropdown conditionally
     * 'Channel' will exclude embed links
     * 'Video' (default) keeps the original behaviour
     */
    type: String,
    default: 'Video'
  },
  id: {
    type: String,
    required: true
  },
  externalUrl: {
    type: String,
    default: ''
  },
  playlistId: {
    type: String,
    default: ''
  },
  getTimestamp: {
    type: Function,
    default: null
  },
  dropdownPositionY: {
    type: String,
    default: 'bottom'
  },
  size: {
    type: Number,
    default: 20
  }
})

const sectionId = useId()
const includeTimestamp = ref(false)
const iconButton = useTemplateRef('iconButton')

const isChannel = computed(() => {
  return props.shareTargetType === 'Channel'
})

const isPlaylist = computed(() => {
  return props.shareTargetType === 'Playlist'
})

const isPost = computed(() => {
  return props.shareTargetType === 'Post'
})

const isVideo = computed(() => {
  return props.shareTargetType === 'Video'
})

const externalHostname = computed(() => {
  try {
    return new URL(props.externalUrl).hostname
  } catch {
    return ''
  }
})

const shareTitle = computed(() => {
  if (isChannel.value) {
    return t('Share.Share Channel')
  }
  if (isPlaylist.value) {
    return t('Share.Share Playlist')
  }
  if (isPost.value) {
    return t('Share.Share Post')
  }
  return t('Share.Share Video')
})

const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

const showInvidiousOptions = computed(() => {
  return usesInvidiousInstance(store.getters.getBackendPreference, store.getters.getBackendFallback)
})

const selectedUserPlaylist = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return store.getters.getPlaylist(props.playlistId)
})

const playlistSharable = computed(() => {
  // `playlistId` can be undefined
  // User playlist ID should not be shared
  return props.playlistId && props.playlistId.length !== 0 && selectedUserPlaylist.value == null
})

const invidiousURL = computed(() => {
  if (isChannel.value) {
    return `${currentInvidiousInstanceUrl.value}/channel/${props.id}`
  }
  if (isPlaylist.value) {
    return `${currentInvidiousInstanceUrl.value}/playlist?list=${props.id}`
  }
  if (isPost.value) {
    return `${currentInvidiousInstanceUrl.value}/post/${props.id}`
  }
  return getInvidiousVideoUrl(
    currentInvidiousInstanceUrl.value,
    props.id,
    playlistSharable.value ? props.playlistId : ''
  )
})

const invidiousEmbedURL = computed(() => {
  if (isPlaylist.value) {
    return `${currentInvidiousInstanceUrl.value}/embed/videoseries?list=${props.id}`
  }
  return `${currentInvidiousInstanceUrl.value}/embed/${props.id}`
})

const youtubeChannelUrl = computed(() => {
  return `https://www.youtube.com/channel/${props.id}`
})

const youtubePlaylistUrl = computed(() => {
  return `https://youtube.com/playlist?list=${props.id}`
})

const youtubeURL = computed(() => {
  if (isChannel.value) {
    return youtubeChannelUrl.value
  }
  if (isPlaylist.value) {
    return youtubePlaylistUrl.value
  }
  if (isPost.value) {
    return `https://www.youtube.com/post/${props.id}`
  }
  let videoUrl = `https://www.youtube.com/watch?v=${props.id}`
  if (playlistSharable.value) {
    // `index` seems can be ignored
    videoUrl += `&list=${props.playlistId}`
  }
  return videoUrl
})

const youtubeShareURL = computed(() => {
  if (isChannel.value) {
    return youtubeChannelUrl.value
  }
  if (isPlaylist.value) {
    return youtubePlaylistUrl.value
  }
  if (isPost.value) {
    return `https://www.youtube.com/post/${props.id}`
  }
  return getYoutubeVideoShareUrl(props.id, playlistSharable.value ? props.playlistId : '')
})

const youtubeEmbedURL = computed(() => {
  if (isPlaylist.value) {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${props.id}`
  }
  return `https://www.youtube-nocookie.com/embed/${props.id}`
})

/**
 * @param {() => void} share
 * @param {() => void} copy
 * @param {() => void} open
 * @param {{ copy: () => void, open: () => void } | null} [embed]
 */
function linkActions(share, copy, open, embed = null) {
  return [
    ...(canShare ? [{ icon: ['fas', 'share-alt'], label: t('Share.Share Link'), run: share }] : []),
    { icon: ['fas', 'copy'], label: t('Share.Copy Link'), run: copy },
    { icon: ['fas', 'globe'], label: t('Share.Open Link'), run: open },
    ...(embed
      ? [
          { icon: ['fas', 'copy'], label: t('Share.Copy Embed'), run: embed.copy, embedStart: true },
          { icon: ['fas', 'globe'], label: t('Share.Open Embed'), run: embed.open }
        ]
      : [])
  ]
}

const shareSections = computed(() => {
  if (props.externalUrl) {
    return [{ id: `${sectionId}-external`, kind: 'external', label: externalHostname.value, actions: linkActions(shareExternal, copyExternal, openExternal) }]
  }
  const hasEmbed = isVideo.value || isPlaylist.value
  const sections = [{
    id: `${sectionId}-youtube`,
    kind: 'youtube',
    actions: linkActions(shareYoutube, copyYoutube, openYoutube, hasEmbed ? { copy: copyYoutubeEmbed, open: openYoutubeEmbed } : null)
  }]
  if (showInvidiousOptions.value) {
    sections.push({
      id: `${sectionId}-invidious`,
      kind: 'invidious',
      actions: linkActions(shareInvidious, copyInvidious, openInvidious, hasEmbed ? { copy: copyInvidiousEmbed, open: openInvidiousEmbed } : null)
    })
  }
  return sections
})

if (isVideo.value && !props.externalUrl && !props.getTimestamp) {
  console.error('Error in props validation: A Video FtShareButton requires a valid get-timestamp function.')
}

function shareExternal() {
  iconButton.value.hideDropdown()
  return shareLink(props.externalUrl)
}

function copyExternal() {
  copyToClipboard(props.externalUrl)
  iconButton.value.hideDropdown()
}

function openExternal() {
  openExternalLink(props.externalUrl)
  iconButton.value.hideDropdown()
}

function shareYoutube() {
  const url = getFinalUrl(youtubeShareURL.value)
  iconButton.value.hideDropdown()
  return shareLink(url)
}

function shareInvidious() {
  const url = getFinalUrl(invidiousURL.value)
  iconButton.value.hideDropdown()
  return shareLink(url)
}

function openInvidious() {
  openExternalLink(getFinalUrl(invidiousURL.value))
  iconButton.value.hideDropdown()
}

function copyInvidious() {
  copyToClipboard(getFinalUrl(invidiousURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.Invidious URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openYoutube() {
  openExternalLink(getFinalUrl(youtubeURL.value))
  iconButton.value.hideDropdown()
}

function copyYoutube() {
  copyToClipboard(getFinalUrl(youtubeShareURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.YouTube URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openYoutubeEmbed() {
  openExternalLink(getFinalUrl(youtubeEmbedURL.value))
  iconButton.value.hideDropdown()
}

function copyYoutubeEmbed() {
  copyToClipboard(getFinalUrl(youtubeEmbedURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.YouTube Embed URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openInvidiousEmbed() {
  openExternalLink(getFinalUrl(invidiousEmbedURL.value))
  iconButton.value.hideDropdown()
}

function copyInvidiousEmbed() {
  copyToClipboard(getFinalUrl(invidiousEmbedURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.Invidious Embed URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function getCopySuccessMessage(defaultMessage) {
  return includeTimestamp.value ? t('Share.Timestamp Link Copied') : defaultMessage
}

function updateIncludeTimestamp() {
  includeTimestamp.value = !includeTimestamp.value
}

function getFinalUrl(url) {
  if (isChannel.value || isPlaylist.value || isPost.value) {
    return url
  }
  return includeTimestamp.value ? appendTimestamp(url, props.getTimestamp()) : url
}
</script>
<style scoped src="./FtShareButton.css" />
