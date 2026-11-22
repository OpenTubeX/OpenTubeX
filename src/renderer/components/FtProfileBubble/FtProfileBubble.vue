<template>
  <div
    class="bubblePadding"
    tabindex="0"
    role="button"
    :aria-labelledby="id"
    @click="click"
    @keydown.space.enter.prevent="click"
  >
    <FtProfileIcon
      class="bubble"
      :profile="profile"
      :fallback="profileInitial"
    />
    <div
      :id="id"
      class="profileName"
      dir="auto"
    >
      {{ translatedProfileName }}
      <FtIcon
        v-if="isSeparate"
        class="separateProfileIcon"
        :icon="['fas', 'user-lock']"
        role="img"
        :title="t('Profile.Separate Profile')"
        :aria-label="t('Profile.Separate Profile')"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

import { getFirstCharacter } from '../../helpers/strings'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'

const props = defineProps({
  profileName: {
    type: String,
    required: true
  },
  isMainProfile: {
    type: Boolean,
    required: true
  },
  /** Whether the profile keeps its own data */
  isSeparate: {
    type: Boolean,
    default: false
  },
  backgroundColor: {
    type: String,
    required: true
  },
  textColor: {
    type: String,
    required: true
  },
  icon: {
    type: Object,
    default: null
  }
})

const { locale, t } = useI18n()

const id = useId()

const translatedProfileName = computed(() => {
  return props.isMainProfile ? t('Profile.All Channels') : props.profileName
})

const profileInitial = computed(() => {
  return props.profileName
    ? getFirstCharacter(translatedProfileName.value, locale.value)
    : ''
})

const profile = computed(() => ({
  bgColor: props.backgroundColor,
  textColor: props.textColor,
  icon: props.icon
}))

const emit = defineEmits(['click'])

function click() {
  emit('click')
}
</script>

<style scoped src="./FtProfileBubble.css" />
