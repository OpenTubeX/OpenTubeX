<template>
  <button
    class="btn ripple"
    :class="buttonTheme"
    :style="{
      color: buttonTheme === '' ? textColor : undefined,
      backgroundColor: buttonTheme === '' ? backgroundColor : undefined,
      borderColor: buttonTheme === '' ? backgroundColor : undefined
    }"
    @click="click"
  >
    <slot>
      <FtIcon
        v-if="icon"
        :icon="icon"
      />
      {{ label }}
    </slot>
  </button>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'

const props = defineProps({
  label: {
    type: String,
    default: ''
  },
  textColor: {
    type: String,
    default: 'var(--text-with-accent-color)'
  },
  backgroundColor: {
    type: String,
    default: 'var(--accent-color)'
  },
  theme: {
    type: String,
    default: ''
  },
  icon: {
    type: Array,
    default: null
  }
})

const emit = defineEmits(['click'])

const buttonTheme = computed(() => {
  if (props.theme !== '') return props.theme
  if (props.backgroundColor === 'var(--primary-color)' && props.textColor === 'var(--text-with-main-color)') {
    return 'primary'
  }
  if (props.backgroundColor === 'var(--accent-color)' && props.textColor === 'var(--text-with-accent-color)') {
    return 'secondary'
  }
  return ''
})

function click() {
  emit('click')
}
</script>

<style scoped src="./FtButton.css" />
