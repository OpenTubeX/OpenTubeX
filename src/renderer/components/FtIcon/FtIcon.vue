<template>
  <FontAwesomeIcon
    v-if="useFontAwesome || !iconifyId"
    v-bind="forwardedAttrs"
    :icon="icon"
    :fixed-width="fixedWidth"
    :size="size"
    :transform="transform"
    :class="iconClass"
    :style="fontAwesomeStyle"
  />
  <span
    v-else
    v-bind="forwardedAttrs"
    :data-prefix="semanticIcon?.[0]"
    :data-icon="semanticIcon?.[1]"
    class="ft-icon"
    :class="[{ 'ft-icon--fw': fixedWidth }, iconClass]"
    :style="iconifyWrapperStyle"
  >
    <Icon
      class="ft-icon__glyph"
      :icon="iconifyId"
      :style="iconifyGlyphStyle"
      width="1em"
      height="1em"
      aria-hidden="true"
    />
  </span>
</template>

<script setup>
import { computed, normalizeStyle, useAttrs } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome-original'

import faAliasToCanon from '../../icons/faAliasToCanon.json'
import { currentIconPack } from '../../icons/iconPackState'
import { normalizeFaIcon, resolveIconifyId } from '../../icons/resolveIconifyId'

defineOptions({
  inheritAttrs: false
})

const props = defineProps({
  icon: {
    type: [Array, String, Object],
    required: true
  },
  fixedWidth: {
    type: Boolean,
    default: false
  },
  size: {
    type: [String, Number],
    default: null
  },
  transform: {
    type: [String, Object],
    default: null
  }
})

/** @type {Record<string, string>} */
const FA_SIZE_TO_EM = {
  '2xs': '0.625em',
  xs: '0.75em',
  sm: '0.875em',
  lg: '1.25em',
  xl: '1.5em',
  '2xl': '2em',
  '1x': '1em',
  '2x': '2em',
  '3x': '3em',
  '4x': '4em',
  '5x': '5em',
  '6x': '6em',
  '7x': '7em',
  '8x': '8em',
  '9x': '9em',
  '10x': '10em'
}

const attrs = useAttrs()

const useFontAwesome = computed(() => currentIconPack.value === 'fontawesome')

const iconifyId = computed(() => resolveIconifyId(props.icon))

// Preserve Font Awesome's semantic metadata when a different pack renders the
// glyph. Existing styling and consumers can then identify an icon independently
// of the active pack's visual name.
const semanticIcon = computed(() => {
  const normalized = normalizeFaIcon(props.icon)
  if (!normalized) {
    return null
  }
  return [normalized[0], faAliasToCanon[normalized[1]] || normalized[1]]
})

const iconClass = computed(() => attrs.class)

/**
 * Forward non-class/style attrs (e.g. aria-hidden) onto the rendered SVG/wrapper.
 */
const forwardedAttrs = computed(() => {
  /** @type {Record<string, unknown>} */
  const rest = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class' || key === 'style') {
      continue
    }
    rest[key] = value
  }
  return rest
})

const baseStyle = computed(() => {
  const style = attrs.style
  if (style == null || style === '') {
    return {}
  }
  // Wrap strings so normalizeStyle parses them into an object we can merge.
  const normalized = normalizeStyle(
    typeof style === 'string' ? [style] : style
  )
  return {
    ...(normalized && typeof normalized === 'object' ? normalized : {})
  }
})

/** FA branch keeps keyword sizes on the component prop; only merge attrs.style. */
const fontAwesomeStyle = computed(() => baseStyle.value)

/**
 * @param {string | number | null | undefined} size
 * @returns {string | null}
 */
function cssFontSizeFromFaSize(size) {
  if (size == null || size === '') {
    return null
  }
  if (typeof size === 'number' || /^\d+(\.\d+)?$/.test(String(size))) {
    return `${size}px`
  }
  const key = String(size)
  if (FA_SIZE_TO_EM[key]) {
    return FA_SIZE_TO_EM[key]
  }
  // Already a CSS length (e.g. 1.2em, 20px)
  return key
}

const iconifyWrapperStyle = computed(() => {
  const style = { ...baseStyle.value }
  const fontSize = cssFontSizeFromFaSize(props.size)
  if (fontSize != null) {
    style.fontSize = fontSize
  }
  return style
})

/**
 * Approximate Font Awesome power-transforms for Iconify glyphs.
 * Uses FA's 16-unit grid: shrink-7 ≈ scale(9/16), up-1 ≈ translateY(-1/16em).
 * @param {string | Record<string, unknown> | null | undefined} transform
 * @returns {{ transform?: string }}
 */
function cssFromFaTransform(transform) {
  if (transform == null || transform === '') {
    return {}
  }

  if (typeof transform === 'object' && !Array.isArray(transform)) {
    const size = typeof transform.size === 'number' ? transform.size : 16
    const x = typeof transform.x === 'number' ? transform.x : 0
    const y = typeof transform.y === 'number' ? transform.y : 0
    const rotate = typeof transform.rotate === 'number' ? transform.rotate : 0
    const flipX = transform.flipX ? -1 : 1
    const flipY = transform.flipY ? -1 : 1
    return {
      transform: `translate(${x / 16}em, ${y / 16}em) scale(${(size / 16) * flipX}, ${(size / 16) * flipY}) rotate(${rotate}deg)`
    }
  }

  const tokens = String(transform).trim().split(/\s+/).filter(Boolean)
  let size = 16
  let x = 0
  let y = 0
  let rotate = 0
  let flipX = 1
  let flipY = 1

  for (const token of tokens) {
    let match = /^shrink-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      size -= Number(match[1])
      continue
    }
    match = /^grow-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      size += Number(match[1])
      continue
    }
    match = /^up-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      y -= Number(match[1])
      continue
    }
    match = /^down-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      y += Number(match[1])
      continue
    }
    match = /^left-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      x -= Number(match[1])
      continue
    }
    match = /^right-(\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      x += Number(match[1])
      continue
    }
    match = /^rotate-(-?\d+(?:\.\d+)?)$/.exec(token)
    if (match) {
      rotate += Number(match[1])
      continue
    }
    if (token === 'flip-h') {
      flipX *= -1
      continue
    }
    if (token === 'flip-v') {
      flipY *= -1
    }
  }

  const scaleX = (size / 16) * flipX
  const scaleY = (size / 16) * flipY
  return {
    transform: `translate(${x / 16}em, ${y / 16}em) scale(${scaleX}, ${scaleY}) rotate(${rotate}deg)`
  }
}

const iconifyGlyphStyle = computed(() => cssFromFaTransform(props.transform))
</script>

<style>
.ft-icon {
  display: inline-block;
  flex-shrink: 0;
  line-height: 1;
  overflow: visible;
  vertical-align: -0.125em;
}

.ft-icon__glyph {
  display: block;
  /* Center when callers stretch .ft-icon wider than 1em (e.g. SideNav .navIcon). */
  margin-inline: auto;
}

.ft-icon--fw {
  inline-size: 1.25em;
  text-align: center;
}
</style>
