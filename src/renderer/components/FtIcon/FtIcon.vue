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
  <span
    v-else-if="customImageSource"
    v-bind="forwardedAttrs"
    class="ft-custom-icon ft-custom-icon--image"
    :class="iconClass"
    :style="customIconStyle"
  >
    <img
      :src="customImageSource"
      :style="{ visibility: customImageLoaded ? 'visible' : 'hidden' }"
      alt=""
      draggable="false"
      @load="loadedCustomImage = customImageSource"
      @error="failedCustomImage = customImageSource; loadedCustomImage = null"
      @vue:mounted="checkCachedImage"
      @vue:updated="checkCachedImage"
    >
    <span
      v-if="!customImageLoaded && failedCustomImage !== customImageSource"
      class="customImagePlaceholder ft-shimmer"
      aria-hidden="true"
    />
    <Icon
      v-else-if="!customImageLoaded"
      class="customImagePlaceholder"
      :icon="resolveIconifyId(['fas', 'file-image'])"
      width="100%"
      height="100%"
      aria-hidden="true"
    />
  </span>
  <span
    v-else-if="iconifyId"
    v-bind="forwardedAttrs"
    :data-prefix="semanticIcon?.[0]"
    :data-icon="semanticIcon?.[1]"
    :data-icon-pack="pack ?? currentIconPack"
    class="ft-icon"
    :class="[{ 'ft-icon--fw': fixedWidth, 'ft-icon--spin': spin }, iconClass]"
    :style="iconifyWrapperStyle"
  >
    <Icon
      class="ft-icon__glyph"
      :icon="iconifyId"
      width="1em"
      height="1em"
      aria-hidden="true"
    />
  </span>
</template>

<script setup>
import { computed, normalizeStyle, ref, useAttrs, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import { currentIconPack } from '../../icons/iconPackState'
import { normalizeIcon, resolveIconifyId } from '../../icons/resolveIconifyId'
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
  color: {
    type: String,
    default: null
  },
  spin: {
    type: Boolean,
    default: false
  },
  /** Draw from this pack instead of the selected one. It must be loaded. */
  pack: {
    type: String,
    default: null
  }
})

const attrs = useAttrs()

const customEmoji = computed(() => {
  return props.icon?.type === 'emoji' && typeof props.icon.value === 'string'
    ? props.icon.value
    : ''
})

const customImageSource = computed(() => getCustomIconImageSource(props.icon))
const loadedCustomImage = ref(null)
const failedCustomImage = ref(null)
const customImageLoaded = computed(() => loadedCustomImage.value === customImageSource.value)
watch(customImageSource, () => {
  loadedCustomImage.value = null
  failedCustomImage.value = null
})
function checkCachedImage({ el: image, props: imageProps }) {
  if (!image.complete) return
  if (image.naturalWidth) {
    loadedCustomImage.value = imageProps.src
  } else {
    failedCustomImage.value = imageProps.src
  }
}
const iconifyId = computed(() => resolveIconifyId(props.icon, props.pack ?? currentIconPack.value))

// Preserve the stable semantic metadata used by existing styling and consumers,
// independently of the active pack's visual name.
const semanticIcon = computed(() => normalizeIcon(props.icon))

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
  // Already a CSS length (e.g. 1.2em, 20px)
  return String(size)
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

</script>

<style>
/* Icons with their own size keep it at every Font Size setting. Icons sized
   by the surrounding text (1em) still grow with that text. */
.ft-custom-icon,
.ft-icon,
.shaka-ui-icon {
  --font-scale: 1;
}

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
  border-radius: var(--shape-corner-extra-small);
}

.ft-custom-icon--image > img,
.customImagePlaceholder {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  border-radius: inherit;
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

@keyframes ft-icon-spin {
  from {
    rotate: 0deg;
  }

  to {
    rotate: 360deg;
  }
}
</style>
