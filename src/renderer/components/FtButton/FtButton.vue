<template>
  <button
    class="btn ripple"
    :class="[buttonTheme, `variant-${buttonVariant}`, `shape-${shape}`, `size-${size}`, { selected }]"
    :aria-pressed="selected ?? $attrs['aria-pressed']"
    :style="{
      '--button-base': buttonTheme === '' ? backgroundColor : undefined,
      '--button-on-base': buttonTheme === '' ? textColor : undefined
    }"
    @click="click"
  >
    <slot>
      <FtIcon
        v-if="icon"
        :icon="icon"
        aria-hidden="true"
      />
      {{ label }}
    </slot>
  </button>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: '',
    validator: value => ['', 'filled', 'tonal', 'outlined', 'text', 'elevated'].includes(value)
  },
  shape: {
    type: String,
    default: 'round',
    validator: value => ['round', 'square'].includes(value)
  },
  size: {
    type: String,
    default: 'small',
    validator: value => ['extra-small', 'small', 'medium', 'large', 'extra-large'].includes(value)
  },
  selected: {
    type: Boolean,
    default: null
  },
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

const buttonVariant = computed(() => props.variant || (
  props.backgroundColor === null || props.backgroundColor === 'null' ? 'outlined' : buttonTheme.value === 'secondary' ? 'tonal' : 'filled'
))

function click() {
  emit('click')
}
</script>

<style scoped src="./FtButton.css" />
