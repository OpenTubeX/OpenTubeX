<template>
  <div class="addToPlaylistDropdown">
    <p class="dropdownHeader">
      {{ t('User Playlists.Save to') }}
    </p>
    <ul
      class="playlistList"
      role="listbox"
      :aria-label="t('User Playlists.Add to Playlist')"
    >
      <li
        v-for="playlist in playlists"
        :key="playlist._id"
        class="playlistRow"
        role="option"
        :aria-selected="containedIds.has(playlist._id)"
        tabindex="0"
        @click="togglePlaylist(playlist)"
        @keydown.enter.prevent="togglePlaylist(playlist)"
        @keydown.space.prevent="togglePlaylist(playlist)"
      >
        <img
          alt=""
          class="playlistThumbnail"
          :src="playlistThumbnail(playlist)"
        >
        <span class="playlistDetails">
          <span class="playlistName">{{ playlist.playlistName }}</span>
          <span class="videoCount">{{ t('Global.Counts.Video Count', { count: playlist.videos.length }, playlist.videos.length) }}</span>
        </span>
        <FontAwesomeIcon
          class="stateIcon"
          :icon="containedIds.has(playlist._id) ? ['fas', 'bookmark'] : ['far', 'bookmark']"
          fixed-width
        />
      </li>
    </ul>
    <button
      type="button"
      class="playlistRow createRow"
      @click="openCreatePlaylistPrompt"
    >
      <FontAwesomeIcon
        :icon="['fas', 'plus']"
        fixed-width
      />
      <span>{{ t('User Playlists.Create New Playlist') }}</span>
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'

import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  videoData: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()

const allPlaylists = computed(() => store.getters.getAllPlaylists)

// Freeze the row order while the dropdown is open,
// otherwise toggling a playlist bumps its lastUpdatedAt and makes the rows jump around
const initialOrder = allPlaylists.value
  .slice()
  .sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
  .map((playlist) => playlist._id)

const playlists = computed(() => {
  const playlistsById = new Map(allPlaylists.value.map((playlist) => [playlist._id, playlist]))

  const rows = []
  for (const id of initialOrder) {
    const playlist = playlistsById.get(id)
    if (playlist != null) {
      rows.push(playlist)
      playlistsById.delete(id)
    }
  }

  // Playlists created while the dropdown is open go at the end
  rows.push(...playlistsById.values())

  return rows
})

const containedIds = computed(() => {
  const videoId = props.videoData.videoId

  return new Set(
    allPlaylists.value
      .filter((playlist) => playlist.videos.some((video) => video.videoId === videoId))
      .map((playlist) => playlist._id)
  )
})

/**
 * @param {object} playlist
 */
function playlistThumbnail(playlist) {
  if (playlist.videos.length === 0) {
    return thumbnailPlaceholder
  }

  const origin = store.getters.getBackendPreference === 'invidious'
    ? store.getters.getCurrentInvidiousInstanceUrl
    : 'https://i.ytimg.com'

  return `${origin}/vi/${playlist.videos[0].videoId}/mqdefault.jpg`
}

/**
 * @param {object} playlist
 */
async function togglePlaylist(playlist) {
  const pendingKey = `${playlist._id}:${props.videoData.videoId}`

  if (pendingToggles.has(pendingKey)) {
    return
  }

  pendingToggles.add(pendingKey)
  try {
    const playlistName = playlist.playlistName

    if (containedIds.value.has(playlist._id)) {
      const removed = await store.dispatch('removeVideo', {
        _id: playlist._id,
        // Remove all playlist items with the same videoId
        videoId: props.videoData.videoId,
      })

      showToast(removed
        ? t('Video.Video has been removed from {playlistName}', { playlistName })
        : t('Video.There was a problem removing the video from {playlistName}', { playlistName }))
    } else {
      const saved = await store.dispatch('addVideo', {
        _id: playlist._id,
        // The action mutates the passed object, so hand it a copy
        videoData: { ...props.videoData },
      })

      showToast(saved
        ? t('Video.Video has been saved to {playlistName}', { playlistName })
        : t('Video.There was a problem saving the video to {playlistName}', { playlistName }))
    }
  } finally {
    pendingToggles.delete(pendingKey)
  }
}

function openCreatePlaylistPrompt() {
  store.dispatch('showCreatePlaylistPrompt', {
    title: store.getters.getNewPlaylistDefaultProperties.title || '',
    // The new playlist is created with this video already in it
    videos: [{ ...props.videoData }],
  })
}
</script>

<script>
/**
 * `playlistId:videoId` pairs with an in-flight add/remove. Guards against a second
 * activation reading the same stale `containedIds` before the first write commits,
 * which would otherwise persist a duplicate entry.
 *
 * Module scoped on purpose: closing and reopening the dropdown remounts this
 * component, and the same video can have another playlist control mounted
 * elsewhere, so a per-instance set would not catch either case.
 */
const pendingToggles = new Set()
</script>

<style scoped lang="scss" src="./FtAddToPlaylistDropdown.scss" />
