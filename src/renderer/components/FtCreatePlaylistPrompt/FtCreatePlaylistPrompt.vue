<template>
  <FtPrompt
    autosize
    fixed-layout
    :label="title"
    @click="hideCreatePlaylistPrompt"
  >
    <FtFlexBox>
      <FtInput
        ref="playlistNameInput"
        :label="$t('User Playlists.Playlist Name')"
        :icon="['fas', 'list']"
        :placeholder="$t('Form Inputs.Example', { example: $t('Tab Organizer.Icon Labels.Music') })"
        :show-action-button="false"
        :value="playlistName"
        :maxlength="255"
        class="playlistNameInput"
        @input="handlePlaylistNameInput"
        @click="createNewPlaylist"
      />
    </FtFlexBox>
    <FtFlexBox v-if="playlistNameBlank">
      <p>
        {{ $t('User Playlists.SinglePlaylistView.Toast["Playlist name cannot be empty. Please input a name."]') }}
      </p>
    </FtFlexBox>
    <FtFlexBox v-if="playlistWithNameExists">
      <p>
        {{ $t('User Playlists.CreatePlaylistPrompt.Toast["There is already a playlist with this name. Please pick a different name."]') }}
      </p>
    </FtFlexBox>
    <FtFlexBox v-if="youTubeAvailable">
      <FtToggleSwitch
        :label="$t('User Playlists.CreatePlaylistPrompt.Create on YouTube')"
        :default-value="createOnYouTube"
        compact
        @change="createOnYouTube = $event"
      />
    </FtFlexBox>
    <template #footer>
      <FtFlexBox>
        <FtButton
          theme="primary"
          :label="$t('User Playlists.CreatePlaylistPrompt.Create')"
          :icon="['fas', 'playlist-add']"
          :disabled="playlistPersistenceDisabled || creating"
          @click="createNewPlaylist"
        />
        <FtButton
          :label="$t('User Playlists.Cancel')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="hideCreatePlaylistPrompt"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'

import { showToast } from '../../helpers/utils'
import { canCreateYouTubePlaylists, createYouTubePlaylistWithVideos } from '../../helpers/youtube-sync'

const { t } = useI18n()

const title = computed(() => t('User Playlists.CreatePlaylistPrompt.New Playlist Name'))

/** @type {import('vue').ComputedRef<object[]>} */
const allPlaylists = computed(() => store.getters.getAllPlaylists)

/** @type {import('vue').Ref<string>} */
const playlistName = ref(store.getters.getNewPlaylistVideoObject.title)

const playlistNameBlank = computed(() => {
  return playlistName.value !== '' && playlistName.value.trim() === ''
})

const playlistWithNameExists = computed(() => {
  const playlistName_ = playlistName.value

  if (playlistName_ === '') {
    return false
  }

  return allPlaylists.value.some((playlist) => playlist.playlistName === playlistName_)
})

const playlistPersistenceDisabled = computed(() => {
  return playlistName.value === '' || playlistNameBlank.value || playlistWithNameExists.value
})

const playlistNameInput = useTemplateRef('playlistNameInput')

// With playlist sync on, new playlists go to YouTube unless turned off here.
const youTubeAvailable = canCreateYouTubePlaylists()
const createOnYouTube = ref(youTubeAvailable)
const creating = ref(false)

onMounted(() => {
  // Faster to input required playlist name
  nextTick(() => playlistNameInput.value?.focus())
})

/**
 * @param {string} input
 */
function handlePlaylistNameInput(input) {
  const trimmed = input.trim()

  // Need to show message for blank input
  playlistName.value = trimmed === '' ? input : trimmed
}

async function createNewPlaylist() {
  // It is still possible to attempt to create via pressing enter
  if (playlistPersistenceDisabled.value || creating.value) { return }

  // Copy any videos handed over by the opener (e.g. the add to playlist dropdown),
  // as they get processed in place and must not be reactive store state
  const initialVideos = (store.getters.getNewPlaylistVideoObject.videos ?? [])
    .map((video) => ({ ...video }))

  const playlistObject = {
    playlistName: playlistName.value,
    protected: false,
    description: store.getters.getNewPlaylistVideoObject.description || '',
    videos: initialVideos,
  }

  const sourcePlaylistId = store.getters.getNewPlaylistVideoObject.sourcePlaylistId
  if (sourcePlaylistId) playlistObject.sourcePlaylistId = sourcePlaylistId

  creating.value = true
  try {
    const saved = youTubeAvailable && createOnYouTube.value
      ? await createYouTubePlaylistWithVideos(playlistObject)
      : await store.dispatch('addPlaylist', playlistObject)
    if (!saved) throw new Error('Could not save the playlist')
    showToast({
      message: t('User Playlists.CreatePlaylistPrompt.Toast["Playlist {playlistName} has been successfully created."]', {
        playlistName: playlistName.value,
      }),
      icon: ['fac', 'playlist-check'],
    })
  } catch (e) {
    showToast({
      message: t('User Playlists.CreatePlaylistPrompt.Toast["There was an issue with creating the playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  } finally {
    creating.value = false
    hideCreatePlaylistPrompt()
  }
}

function hideCreatePlaylistPrompt() {
  store.commit('setShowCreatePlaylistPrompt', false)
}
</script>

<style scoped src="./FtCreatePlaylistPrompt.css" />
