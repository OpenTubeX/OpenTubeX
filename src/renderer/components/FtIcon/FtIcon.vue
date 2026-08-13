<template>
  <span
    v-if="customEmoji"
    v-bind="forwardedAttrs"
    class="ft-custom-icon"
    :class="iconClass"
    :style="customIconStyle"
    dir="auto"
  >
    <span class="ft-custom-icon__emoji">{{ customEmoji }}</span>
  </span>
  <img
    v-else-if="customImageSource"
    v-bind="forwardedAttrs"
    class="ft-custom-icon ft-custom-icon--image"
    :class="iconClass"
    :style="customIconStyle"
    :src="customImageSource"
    alt=""
    draggable="false"
  >
  <span
    v-else-if="iconifyId"
    v-bind="forwardedAttrs"
    :data-prefix="semanticIcon?.[0]"
    :data-icon="semanticIcon?.[1]"
    :data-icon-pack="currentIconPack"
    class="ft-icon"
    :class="[{ 'ft-icon--fw': fixedWidth, 'ft-icon--spin': spin }, iconClass]"
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

import faAliasToCanon from '../../icons/faAliasToCanon.json'
import { currentIconPack } from '../../icons/iconPackState'
import { normalizeFaIcon, resolveIconifyId } from '../../icons/resolveIconifyId'
import { getCustomIconImageSource } from '../../helpers/customIcons'

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
  },
  color: {
    type: String,
    default: null
  },
  spin: {
    type: Boolean,
    default: false
  }
})

/** @type {Record<string, string>} */
const ICON_SIZE_TO_EM = {
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

const customEmoji = computed(() => {
  return props.icon?.type === 'emoji' && typeof props.icon.value === 'string'
    ? props.icon.value
    : ''
})

const customImageSource = computed(() => getCustomIconImageSource(props.icon))
const iconifyId = computed(() => resolveIconifyId(props.icon))

// Preserve the stable semantic metadata used by existing styling and consumers,
// independently of the active pack's visual name.
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
  if (!('aria-hidden' in rest) && !('aria-label' in rest) && !('aria-labelledby' in rest)) {
    rest['aria-hidden'] = 'true'
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

/**
 * @param {string | number | null | undefined} size
 * @returns {string | null}
 */
function cssFontSizeFromIconSize(size) {
  if (size == null || size === '') {
    return null
  }
  if (typeof size === 'number' || /^\d+(\.\d+)?$/.test(String(size))) {
    return `${size}px`
  }
  const key = String(size)
  if (ICON_SIZE_TO_EM[key]) {
    return ICON_SIZE_TO_EM[key]
  }
  // Already a CSS length (e.g. 1.2em, 20px)
  return key
}

const iconifyWrapperStyle = computed(() => {
  const style = { ...baseStyle.value }
  const fontSize = cssFontSizeFromIconSize(props.size)
  if (fontSize != null) {
    style.fontSize = fontSize
  }
  // Iconify glyphs paint with currentColor, so the `color` prop becomes CSS.
  if (props.color != null && props.color !== '') {
    style.color = props.color
  }
  return style
})

const customIconStyle = computed(() => iconifyWrapperStyle.value)

/**
 * Interpret the existing transform syntax on a 16-unit grid.
 * @param {string | Record<string, unknown> | null | undefined} transform
 * @returns {{ transform?: string }}
 */
function cssFromIconTransform(transform) {
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

const iconifyGlyphStyle = computed(() => cssFromIconTransform(props.transform))
</script>

<style>
.ft-custom-icon {
  display: inline-flex;
  flex-shrink: 0;
  inline-size: 1em;
  block-size: 1em;
  align-items: center;
  justify-content: center;
  line-height: 1;
  object-fit: cover;
  overflow: hidden;
  position: relative;
  vertical-align: -0.125em;
}

.ft-custom-icon--image {
  border-radius: calc(2px * var(--ui-roundness));
}

.ft-custom-icon__emoji {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  line-height: 1;
  position: absolute;
}

.ft-icon {
  display: inline-block;
  flex-shrink: 0;
  inline-size: var(--icon-width, 1.25em);
  line-height: 1;
  overflow: visible;
  text-align: center;
  vertical-align: -0.125em;
}

.ft-icon__glyph {
  display: block;
  /* Center when callers stretch .ft-icon wider than 1em (e.g. SideNav .navIcon). */
  margin-inline: auto;
  /* The selected packs leave some padding in their view boxes. */
  scale: 1.2;
}

.ft-icon--fw {
  inline-size: 1.25em;
}

.ft-icon--spin .ft-icon__glyph {
  animation: ft-icon-spin 2s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .ft-icon--spin .ft-icon__glyph {
    animation-duration: 10s;
  }
}

@keyframes ft-icon-spin {
  from {
    rotate: 0deg;
  }

  to {
    rotate: 360deg;
  }
}
</style>
