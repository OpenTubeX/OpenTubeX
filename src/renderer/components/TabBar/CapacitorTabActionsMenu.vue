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
          class="dangerAction"
          @click="emit('close')"
        >
          <FtIcon
            :icon="['fas', 'xmark']"
            aria-hidden="true"
          />
          {{ t('Close Tab') }}
        </button>
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
})

const emit = defineEmits(['close', 'dismiss', 'duplicate', 'toggle-pinned'])
const { t } = useI18n()
</script>

<style scoped src="./CapacitorTabActionsMenu.css" />
