<template>
  <FtPrompt
    theme="flex-column"
    fixed-layout
    card-class="subscriptionGroupEditor"
    :label="title"
    :inert="showDeletePrompt"
    :busy="saving"
    @click="close"
  >
    <template #label="{ labelId }">
      <h2
        :id="labelId"
        class="editorHeading"
      >
        {{ title }}
      </h2>
      <FtInput
        ref="nameInput"
        class="groupNameInput"
        :label="t('Subscription Groups.Group Name')"
        :placeholder="t('Form Inputs.Example', { example: t('Tab Organizer.Icon Labels.Music') })"
        :show-action-button="false"
        :value="name"
        :maxlength="255"
        @input="name = $event"
        @click="save"
      />
      <FtInput
        v-if="channels.length > 1"
        class="channelSearchInput"
        input-type="search"
        :label="t('Channels.Search bar placeholder')"
        :icon="['fas', 'search']"
        :placeholder="t('Form Inputs.Search Text Hint')"
        :show-action-button="false"
        :value="query"
        :maxlength="255"
        @input="query = $event"
      />
      <p class="selectedCount">
        {{ t('Profile.{number} selected', { number: selectedSubscribedCount }) }}
      </p>
    </template>
    <p
      v-if="channels.length === 0"
      class="message"
    >
      {{ t('Channels.Empty') }}
    </p>
    <FtFlexBox
      v-else
      class="channelPicker"
    >
      <FtChannelBubble
        v-for="channel in displayedChannels"
        :key="channel.id"
        :channel-id="channel.id"
        :channel-name="channel.name"
        :channel-thumbnail="channel.thumbnail"
        selectable
        :selected="selected.has(channel.id)"
        @change="toggleChannel(channel.id)"
      />
    </FtFlexBox>
    <template #footer>
      <FtFlexBox>
        <FtButton
          v-if="group !== null"
          theme="destructive"
          :label="t('Subscription Groups.Delete Group')"
          :icon="['fas', 'trash']"
          @click="showDeletePrompt = true"
        />
        <FtButton
          theme="primary"
          :label="group === null ? t('Subscription Groups.Create') : t('Subscription Groups.Save')"
          :icon="group === null ? ['fas', 'plus'] : ['fas', 'floppy-disk']"
          :disabled="name.trim() === ''"
          @click="save"
        />
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="close"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
  <FtPrompt
    v-if="showDeletePrompt"
    :label="t('Subscription Groups.Delete Prompt', { groupName: group.name })"
    :option-names="[t('Yes, Delete'), t('Cancel')]"
    :option-values="['delete', 'cancel']"
    is-first-option-destructive
    autosize
    @click="handleDeletePrompt"
  />
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtChannelBubble from '../FtChannelBubble/FtChannelBubble.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  /** The group to edit, or `null` to create one */
  group: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

const { locale, t } = useI18n()

const title = computed(() => {
  return props.group === null ? t('Subscription Groups.New Group') : t('Subscription Groups.Edit Group')
})

const name = ref(props.group?.name ?? '')
const query = ref('')
const saving = ref(false)
const showDeletePrompt = ref(false)

// Channels this device isn't subscribed to stay in the group, as other
// devices may still be subscribed to them.
/** @type {import('vue').Reactive<Set<string>>} */
const selected = reactive(new Set(props.group?.channelIds ?? []))

const channels = computed(() => {
  const instanceUrl = store.getters.getBackendPreference === 'invidious'
    ? store.getters.getCurrentInvidiousInstanceUrl
    : null

  // The all channels profile is always the first profile in the array
  return store.getters.getProfileList[0].subscriptions.map(({ id, name, thumbnail }) => ({
    id,
    name: name ?? id,
    thumbnail: instanceUrl === null ? thumbnail : youtubeImageUrlToInvidious(thumbnail, instanceUrl)
  }))
})

// Members are listed first, ordered once so that toggling doesn't move channels.
const initialMembers = new Set(selected)
const sortedChannels = computed(() => {
  const collator = new Intl.Collator([locale.value, 'en'], { sensitivity: 'base', numeric: true })
  return channels.value.toSorted((a, b) => {
    return Number(initialMembers.has(b.id)) - Number(initialMembers.has(a.id)) || collator.compare(a.name, b.name)
  })
})

const displayedChannels = computed(() => {
  const search = query.value.trim().toLowerCase()
  if (search === '') return sortedChannels.value
  return sortedChannels.value.filter(channel => channel.name.toLowerCase().includes(search))
})

const selectedSubscribedCount = computed(() => {
  return channels.value.reduce((count, channel) => count + Number(selected.has(channel.id)), 0)
})

/** @param {string} channelId */
function toggleChannel(channelId) {
  if (selected.has(channelId)) {
    selected.delete(channelId)
  } else {
    selected.add(channelId)
  }
}

const nameInput = useTemplateRef('nameInput')

onMounted(() => {
  nextTick(() => nameInput.value?.focus())
})

async function save() {
  const trimmedName = name.value.trim()
  if (trimmedName === '' || saving.value) return

  saving.value = true
  const channelIds = [...selected]
  let saved
  try {
    if (props.group === null) {
      const id = await store.dispatch('createSubscriptionGroup', { name: trimmedName, channelIds })
      saved = id !== null
      if (saved) store.dispatch('selectSubscriptionGroup', id)
    } else {
      saved = await store.dispatch('saveSubscriptionGroup', { ...props.group, name: trimmedName, channelIds })
    }
  } finally {
    saving.value = false
  }

  // Keep the edits open to retry, as the failed write was rolled back
  if (saved) {
    close()
  } else {
    showSaveFailedToast()
  }
}

/** @param {'delete' | 'cancel' | null} option */
async function handleDeletePrompt(option) {
  showDeletePrompt.value = false
  if (option !== 'delete') return

  if (await store.dispatch('deleteSubscriptionGroup', props.group.id)) {
    close()
  } else {
    showSaveFailedToast()
  }
}

function showSaveFailedToast() {
  showToast({ message: t('Subscription Groups.Save Failed'), icon: ['fas', 'circle-exclamation'] })
}

function close() {
  emit('close')
}
</script>

<style scoped src="./FtSubscriptionGroupEditor.css" />
