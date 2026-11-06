<template>
  <header class="sectionHeading">
    <h2>
      <FtIcon
        :icon="icon"
        color="var(--primary-color)"
        aria-hidden="true"
      />
      {{ title }}
    </h2>
    <button
      v-if="viewAllButton"
      type="button"
      class="viewAllLink"
      @click="emit('view-all')"
    >
      <FtIcon :icon="['fas', 'arrow-right']" />
      {{ t('Home Page.View all') }}
    </button>
    <RouterLink
      v-else-if="to"
      class="viewAllLink"
      :to="to"
    >
      <FtIcon :icon="['fas', 'arrow-right']" />
      {{ t('Home Page.View all') }}
    </RouterLink>
  </header>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

defineProps({
  title: { type: String, required: true },
  icon: { type: Array, required: true },
  to: { type: [String, Object], default: '' },
  viewAllButton: { type: Boolean, default: false },
})

const emit = defineEmits(['view-all'])
const { t } = useI18n()
</script>
