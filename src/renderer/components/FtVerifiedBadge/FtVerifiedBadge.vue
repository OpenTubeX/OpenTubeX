<template>
  {{ nameParts.head }}<span
    v-if="verified || artist"
    class="verifiedBadgeGlue"
  >{{ nameParts.tail }}<FtIcon
    v-bind="$attrs"
    :icon="['fas', artist ? 'verified-artist' : 'verified']"
    class="verifiedBadge"
    role="img"
    :aria-label="label"
    :title="label"
  /></span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import { getLastCharacter } from '../../helpers/strings'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  verified: {
    type: Boolean,
    default: false
  },
  artist: {
    type: Boolean,
    default: false
  },
  /** Name the badge follows inline. Its last character wraps together with the badge. */
  name: {
    type: String,
    default: ''
  }
})

const { t } = useI18n()

const label = computed(() => props.artist ? t('Channel.Official Artist Channel') : t('Channel.Verified'))

const nameParts = computed(() => {
  const name = props.name ?? ''
  if (!props.verified && !props.artist) {
    return { head: name, tail: '' }
  }
  const tail = getLastCharacter(name)
  return { head: name.slice(0, name.length - tail.length), tail }
})
</script>

<style scoped>
.verifiedBadgeGlue {
  flex-shrink: 0;
  /* Collapses the glue's own line box to the badge when a flex container blockifies it. */
  line-height: 0;
  white-space: nowrap;
}

.verifiedBadge {
  margin-inline-start: 0.4em;
  /* The scaled glyph fills 1em, so the badge spans from the baseline to the cap height. */
  font-size: 1cap;
  vertical-align: baseline;
  opacity: 0.75;
}
</style>
