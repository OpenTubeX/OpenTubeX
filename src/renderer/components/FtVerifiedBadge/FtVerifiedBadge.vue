<template>
  <FtIcon
    v-if="verified || artist"
    :icon="['fas', artist ? 'verified-artist' : 'verified']"
    class="verifiedBadge"
    role="img"
    :aria-label="label"
    :title="label"
  />
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

const props = defineProps({
  verified: {
    type: Boolean,
    default: false
  },
  artist: {
    type: Boolean,
    default: false
  }
})

const { t } = useI18n()

const label = computed(() => props.artist ? t('Channel.Official Artist Channel') : t('Channel.Verified'))
</script>

<style scoped>
.verifiedBadge {
  flex-shrink: 0;
  margin-inline-start: 0.4em;
  /* The scaled glyph fills 1em, so the badge spans from the baseline to the cap height. */
  font-size: 1cap;
  vertical-align: baseline;
  opacity: 0.75;
}
</style>
