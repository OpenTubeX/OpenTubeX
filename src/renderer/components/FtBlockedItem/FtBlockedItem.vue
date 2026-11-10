<template>
  <div
    v-if="blocked"
    class="blockedItem"
    :class="{ covered }"
  >
    <div
      ref="content"
      class="blockedItemContent"
      :inert="covered"
      :aria-hidden="covered ? 'true' : null"
    >
      <slot />
    </div>
    <button
      v-if="covered"
      type="button"
      class="blockedItemReveal"
      @click.stop.prevent="reveal"
      @keydown.enter.space.stop
    >
      <span class="blockedItemLabel">
        <FtIcon
          :icon="['fas', 'eye']"
          aria-hidden="true"
        />
        {{ t('Global.Show Blocked Item') }}
      </span>
    </button>
  </div>
  <slot v-else />
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { revealedBlockedItems } from '../../helpers/blockedItems'

const props = defineProps({
  /** Whether a block list matches the item */
  blocked: {
    type: Boolean,
    default: false
  },
  /** Keeps the item revealed for the session when lists remount it */
  revealKey: {
    type: String,
    default: null
  }
})

const { t } = useI18n()
const content = useTemplateRef('content')
const revealedHere = ref(false)

const covered = computed(() => {
  return !revealedHere.value && (props.revealKey == null || !revealedBlockedItems.has(props.revealKey))
})

async function reveal() {
  revealedHere.value = true
  if (props.revealKey != null) revealedBlockedItems.add(props.revealKey)

  await nextTick()
  // The reveal button disappears, so keep keyboard focus inside the item.
  content.value?.querySelector(':is(a[href], button:not([disabled]), [tabindex]):not([tabindex="-1"])')?.focus()
}
</script>

<style scoped src="./FtBlockedItem.css" />
