<template>
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
  <p
    v-safer-html="displayText"
    dir="auto"
    @click="catchTimestampClick"
  />
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { vSaferHtml } from '../directives/vSaferHtml.js'

const props = defineProps({
  inputHtml: {
    type: String,
    default: ''
  },
  linkTabIndex: {
    type: String,
    default: '0'
  },
  highlight: {
    type: String,
    default: ''
  }
})

const router = useRouter()
const videoId = router.currentRoute.value.params.id

function highlightHtmlText(inputHtml, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery === '') {
    return inputHtml
  }

  const document = new DOMParser().parseFromString(inputHtml, 'text/html')
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const textNodes = []
  let textNode = walker.nextNode()

  while (textNode !== null) {
    textNodes.push(textNode)
    textNode = walker.nextNode()
  }

  for (const node of textNodes) {
    const text = node.textContent ?? ''
    const normalizedText = text.toLocaleLowerCase()
    let start = 0
    let matchIndex = normalizedText.indexOf(normalizedQuery)

    if (matchIndex === -1) {
      continue
    }

    const fragment = document.createDocumentFragment()
    while (matchIndex !== -1) {
      fragment.append(text.slice(start, matchIndex))

      const mark = document.createElement('mark')
      mark.textContent = text.slice(matchIndex, matchIndex + normalizedQuery.length)
      fragment.append(mark)

      start = matchIndex + normalizedQuery.length
      matchIndex = normalizedText.indexOf(normalizedQuery, start)
    }
    fragment.append(text.slice(start))
    node.replaceWith(fragment)
  }

  return document.body.innerHTML
}

/** @type {import('vue').ComputedRef<string>} */
const displayText = computed(() => {
  const timestampHtml = props.inputHtml.replaceAll(/(?:(\d+):)?(\d+):(\d+)/g, (timestamp, hours, minutes, seconds) => {
    let time = 60 * Number(minutes) + Number(seconds)

    if (hours) {
      time += 3600 * Number(hours)
    }

    const url = router.resolve({
      path: `/watch/${videoId}`,
      query: {
        timestamp: time
      }
    }).href

    // Adding the URL lets the user open the video in a new window at this timestamp
    return `<a tabindex="${props.linkTabIndex}" href="${url}" data-time="${time}">${timestamp}</a>`
  })

  return highlightHtmlText(timestampHtml, props.highlight)
})

const emit = defineEmits(['timestamp-event'])

/**
 * @param {PointerEvent} event
 */
function catchTimestampClick(event) {
  /** @type {HTMLAnchorElement} */
  const target = event.target

  if (target.tagName === 'A' && target.dataset.time) {
    const timeSeconds = parseInt(target.dataset.time)

    if (!isNaN(timeSeconds)) {
      event.preventDefault()

      emit('timestamp-event', timeSeconds)
      window.scrollTo(0, 0)
    }
  }
}
</script>
