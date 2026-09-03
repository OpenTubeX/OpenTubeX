<template>
  <Transition name="capacitor-tab-actions">
    <div
      v-if="tab"
      class="capacitorTabActionsBackdrop"
      :class="`mode-${mode}`"
      @pointerdown.self.stop
      @click.self.stop="emit('dismiss')"
      @keydown.esc="emit('dismiss')"
    >
      <section
        class="capacitorTabActions"
        role="menu"
        :aria-label="title"
      >
        <strong dir="auto">{{ title }}</strong>
        <div
          v-overlay-scrollbars
          class="capacitorTabActionList"
        >
          <button
            v-if="youtubeUrl"
            type="button"
            role="menuitem"
            @click="emit('copy-youtube-link')"
          >
            <FtIcon
              :icon="['fab', 'youtube']"
              aria-hidden="true"
            />
            {{ t('Context Menu.Copy YouTube Link') }}
          </button>
          <button
            type="button"
            role="menuitem"
            @click="emit('toggle-pinned')"
          >
            <FtIcon
              :icon="tab.isPinned ? ['fas', 'thumbtack-slash'] : ['fas', 'thumbtack']"
              aria-hidden="true"
            />
            {{ tab.isPinned ? t('Context Menu.Unpin Tab') : t('Context Menu.Pin Tab') }}
          </button>
          <button
            type="button"
            role="menuitem"
            @click="emit('duplicate')"
          >
            <FtIcon
              :icon="['fas', 'clone']"
              aria-hidden="true"
            />
            {{ t('Context Menu.Duplicate Tab') }}
          </button>
          <button
            type="button"
            role="menuitem"
            @click="emit('reload')"
          >
            <FtIcon
              :icon="['fas', 'sync']"
              aria-hidden="true"
            />
            {{ t('Context Menu.Reload Tab') }}
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!canToggleLoaded"
            @click="emit('toggle-loaded')"
          >
            <FtIcon
              :icon="tab.loadState === 'unloaded' ? ['fas', 'download'] : ['fas', 'right-from-bracket']"
              aria-hidden="true"
            />
            {{ tab.loadState === 'unloaded' ? t('Context Menu.Load Tab') : t('Context Menu.Unload Tab') }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="dangerAction"
            @click="emit('close')"
          >
            <FtIcon
              :icon="['fas', 'xmark']"
              aria-hidden="true"
            />
            {{ t('Close Tab') }}
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

defineProps({
  mode: {
    type: String,
    required: true,
    validator: value => ['phone', 'tablet'].includes(value),
  },
  tab: {
    type: Object,
    default: null,
  },
  title: {
    type: String,
    default: '',
  },
  youtubeUrl: {
    type: String,
    default: null,
  },
  canToggleLoaded: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'close',
  'copy-youtube-link',
  'dismiss',
  'duplicate',
  'reload',
  'toggle-loaded',
  'toggle-pinned'
])
const { t } = useI18n()
</script>

<style scoped src="./CapacitorTabActionsMenu.css" />
