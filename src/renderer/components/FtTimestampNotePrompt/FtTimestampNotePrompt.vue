<template>
  <FtPrompt
    autosize
    fixed-layout
    :busy="busy"
    :label="t('Video.Player.Timestamp Notes.Note at {time}', { time: timestamp })"
    @click="close"
  >
    <FtFlexBox>
      <FtInput
        ref="noteInput"
        class="noteInput"
        :label="t('Video.Player.Timestamp Notes.Note')"
        placeholder=""
        :icon="['fas', 'note-sticky']"
        :value="note"
        :maxlength="5000"
        :show-action-button="false"
        multiline
        @input="note = $event"
        @keydown="handleKeydown"
      />
    </FtFlexBox>
    <template #footer>
      <FtFlexBox>
        <FtButton
          v-if="canSendToObsidian"
          theme="primary"
          :label="t('Video.Player.Timestamp Notes.Add to Obsidian')"
          :icon="['fas', 'file-export']"
          :disabled="busy"
          @click="addToObsidian"
        />
        <FtButton
          :theme="canSendToObsidian ? '' : 'primary'"
          :label="t('Video.Player.Timestamp Notes.Copy as Markdown')"
          :icon="['fas', 'copy']"
          :disabled="busy"
          @click="copy"
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
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'

import { formatTimestampNote, getObsidianNoteName } from '../../helpers/timestampNotes'
import { copyToClipboard, formatDurationAsTimestamp, showToast } from '../../helpers/utils'

const props = defineProps({
  /** The video time of the note in seconds */
  seconds: {
    type: Number,
    required: true
  },
  /** The video URL at that time */
  url: {
    type: String,
    required: true
  },
  /** The video title, which names the Obsidian note */
  title: {
    type: String,
    required: true
  },
  /** Names the Obsidian note when the title can't */
  videoId: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()

const note = ref('')
const busy = ref(false)
const timestamp = computed(() => formatDurationAsTimestamp(props.seconds))

const obsidianVault = computed(() => store.getters.getObsidianVault.trim())
const canSendToObsidian = computed(() => process.env.IS_ELECTRON && obsidianVault.value !== '')

const markdown = computed(() => formatTimestampNote({ url: props.url, timestamp: timestamp.value, note: note.value }))

const noteInput = useTemplateRef('noteInput')

onMounted(() => {
  nextTick(() => noteInput.value?.focus())
})

/** @param {KeyboardEvent} event */
function handleKeydown(event) {
  // Enter starts a new line, so Ctrl+Enter submits like in other note apps
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return
  event.preventDefault()
  if (canSendToObsidian.value) {
    addToObsidian()
  } else {
    copy()
  }
}

async function copy() {
  if (busy.value) return
  busy.value = true
  // Failures are reported with a toast instead of thrown
  const copied = await copyToClipboard(markdown.value, { messageOnSuccess: t('Video.Player.Timestamp Notes.Copied') })
  busy.value = false
  // Keep the note open to try again, since an error toast explains the failure
  if (copied) close()
}

async function addToObsidian() {
  if (busy.value) return
  busy.value = true
  let opened = false
  try {
    opened = await window.ftElectron.openObsidianNote({
      vault: obsidianVault.value,
      name: getObsidianNoteName(props.title, props.videoId),
      content: markdown.value
    })
  } catch (error) {
    console.error(error)
  } finally {
    busy.value = false
  }

  // Keep the note open to copy it instead
  if (opened) {
    close()
  } else {
    showToast({ message: t('Video.Player.Timestamp Notes.Obsidian Failed'), icon: ['fas', 'circle-exclamation'] })
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
.noteInput {
  inline-size: min(600px, calc(100vw - 100px));
  max-inline-size: 100%;
}

@media only screen and (width <= 680px) {
  .noteInput {
    inline-size: 100%;
  }
}
</style>
