<template>
  <Teleport
    :to="fullscreenTarget || 'body'"
    :disabled="fullscreenTarget === null"
  >
    <Transition name="context-menu">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="contextMenu"
        :class="{ submenusOpenStart }"
        :style="menuStyle"
        role="menu"
        :aria-label="t('Context Menu.Context Menu')"
        @contextmenu.prevent
        @pointerdown.stop
      >
        <template
          v-for="(item, index) in items"
          :key="item.actionId ?? `separator-${index}`"
        >
          <div
            v-if="item.type === 'separator'"
            class="separator"
            role="separator"
          />
          <div
            v-else-if="item.submenu"
            class="submenuContainer"
          >
            <button
              class="menuItem"
              :class="{ disabled: !item.enabled }"
              type="button"
              role="menuitem"
              :disabled="!item.enabled"
              aria-haspopup="menu"
              @pointerdown.prevent
            >
              <span
                class="itemIcon"
                aria-hidden="true"
              >
                <FontAwesomeIcon :icon="getItemIcon(item)" />
              </span>
              <span>{{ translateLabel(item.label) }}</span>
              <span
                class="submenuArrow"
                aria-hidden="true"
              />
            </button>
            <div
              class="submenu"
              role="menu"
            >
              <template
                v-for="(child, childIndex) in item.submenu"
                :key="child.actionId ?? `separator-${childIndex}`"
              >
                <div
                  v-if="child.type === 'separator'"
                  class="separator"
                  role="separator"
                />
                <button
                  v-else
                  class="menuItem"
                  :class="{ disabled: !child.enabled }"
                  type="button"
                  :role="child.type === 'radio' ? 'menuitemradio' : 'menuitem'"
                  :aria-checked="child.type === 'radio' ? child.checked : undefined"
                  :disabled="!child.enabled"
                  @pointerdown.prevent
                  @click="execute(child)"
                >
                  <span
                    class="itemIcon"
                    :class="getItemIconClass(child)"
                    aria-hidden="true"
                  >
                    <FontAwesomeIcon :icon="getItemIcon(child, item.label)" />
                    <FontAwesomeIcon
                      v-if="child.checked"
                      class="checkedMark"
                      :icon="['fas', 'check']"
                    />
                  </span>
                  <span>{{ translateLabel(child.label) }}</span>
                </button>
              </template>
            </div>
          </div>
          <button
            v-else
            class="menuItem"
            :class="{ disabled: !item.enabled }"
            type="button"
            :role="item.type === 'radio' ? 'menuitemradio' : 'menuitem'"
            :aria-checked="item.type === 'radio' ? item.checked : undefined"
            :disabled="!item.enabled"
            @pointerdown.prevent
            @click="execute(item)"
          >
            <span
              class="itemIcon"
              :class="getItemIconClass(item)"
              aria-hidden="true"
            >
              <FontAwesomeIcon :icon="getItemIcon(item)" />
              <FontAwesomeIcon
                v-if="item.checked"
                class="checkedMark"
                :icon="['fas', 'check']"
              />
            </span>
            <span>{{ translateLabel(item.label) }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()
const menuRef = useTemplateRef('menuRef')
const fullscreenTarget = ref(null)
const isOpen = ref(false)
const items = ref([])
const sessionId = ref(null)
const position = ref({ x: 0, y: 0 })
const submenusOpenStart = ref(false)
const verticalTabLayout = ref(false)
let openRequest = 0

const menuStyle = computed(() => ({
  insetInlineStart: `${position.value.x}px`,
  insetBlockStart: `${position.value.y}px`
}))

function updateFullscreenTarget() {
  fullscreenTarget.value = document.fullscreenElement
}

const itemIcons = {
  'Close Tab': ['fas', 'xmark'],
  'Close Tabs': ['fas', 'rectangle-xmark'],
  'Copy Image': ['fas', 'images'],
  'Copy Image Address': ['fas', 'link'],
  'Copy Invidious Link': ['fas', 'link'],
  'Copy Link': ['fas', 'link'],
  'Copy YouTube Link': ['fab', 'youtube'],
  'Copy YouTube Links': ['fab', 'youtube'],
  Copy: ['fas', 'copy'],
  Cut: ['fas', 'scissors'],
  Default: ['fas', 'circle'],
  'Duplicate Tab': ['fas', 'clone'],
  'Load Tab': ['fas', 'download'],
  'Load Tabs': ['fas', 'download'],
  'Move Tab': ['fas', 'exchange-alt'],
  'Move Tab to Window': ['fas', 'display'],
  'Move Tabs': ['fas', 'exchange-alt'],
  'Move Tabs to Window': ['fas', 'display'],
  'New Tab': ['fas', 'plus'],
  'Open in a New Tab': ['fas', 'arrow-up-right-from-square'],
  'Open in a New Window': ['fas', 'external-link-alt'],
  'Other Tabs': ['fas', 'times-circle'],
  Paste: ['fas', 'paste'],
  'Pin Tab': ['fas', 'thumbtack'],
  'Pin Tabs': ['fas', 'thumbtack'],
  'Reload All Feeds': ['fas', 'sync'],
  'Reload Live': ['fas', 'sync'],
  'Reload Posts': ['fas', 'sync'],
  'Reload Shorts': ['fas', 'sync'],
  'Reload Tab': ['fas', 'sync'],
  'Reload Tabs': ['fas', 'sync'],
  'Reload Videos': ['fas', 'sync'],
  'Reopen Closed Tab': ['fas', 'clock-rotate-left'],
  'Save Image As…': ['fas', 'file-image'],
  'Select All': ['fas', 'check'],
  'Tab Color': ['fas', 'palette'],
  'To the Bottom': ['fas', 'arrow-down'],
  'To the Left': ['fas', 'arrow-left'],
  'To the Right': ['fas', 'arrow-right'],
  'To the Top': ['fas', 'arrow-up'],
  'Unload Tab': ['fas', 'right-from-bracket'],
  'Unload Tabs': ['fas', 'right-from-bracket'],
  'Unpin Tab': ['fas', 'thumbtack-slash'],
  'Unpin Tabs': ['fas', 'thumbtack-slash']
}

const colorLabels = new Set(['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'])

function getItemIcon(item, parentLabel = '') {
  if (colorLabels.has(item.label)) return ['fas', 'circle']
  if (item.label === 'To Beginning') return ['fas', verticalTabLayout.value ? 'arrow-up' : 'arrow-left']
  if (item.label === 'To End') return ['fas', verticalTabLayout.value ? 'arrow-down' : 'arrow-right']
  if (/^Close \d+ Tabs$/.test(item.label)) return ['fas', 'rectangle-xmark']
  if (/^Duplicate \d+ Tabs$/.test(item.label)) return ['fas', 'clone']
  if (/^Search /.test(item.label)) return ['fas', 'search']
  if (/is too long for search/.test(item.label)) return ['fas', 'circle-exclamation']
  if (parentLabel === 'Move Tab to Window' || parentLabel === 'Move Tabs to Window') return ['fas', 'display']
  return itemIcons[item.label] ?? ['fas', 'circle']
}

function getItemIconClass(item) {
  return colorLabels.has(item.label)
    ? ['colorIcon', `color-${item.label.toLowerCase()}`]
    : undefined
}

function getSelectionText(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    return target.value.slice(start, end)
  }

  return window.getSelection()?.toString() ?? ''
}

function getContextParameters(event) {
  const target = event.target instanceof Element ? event.target : null
  const editable = target?.closest('input, textarea, [contenteditable="true"]')
  const link = target?.closest('a[href]')
  const media = target?.closest('img, video')
  const selectionText = getSelectionText(editable ?? target)
  const isEditable = editable != null && !editable.matches(':disabled, [readonly]')

  return {
    x: event.clientX,
    y: event.clientY,
    pageURL: window.location.href,
    linkURL: link?.href ?? '',
    linkText: link?.textContent?.trim() ?? '',
    srcURL: media?.currentSrc ?? media?.src ?? '',
    mediaType: media instanceof HTMLImageElement ? 'image' : media instanceof HTMLVideoElement ? 'video' : 'none',
    selectionText,
    isEditable,
    editFlags: {
      canCut: isEditable && selectionText.length > 0,
      canCopy: selectionText.length > 0,
      canPaste: isEditable,
      canSelectAll: editable != null
    }
  }
}

async function open(event) {
  if (event.defaultPrevented) return

  event.preventDefault()
  const request = ++openRequest
  const result = await window.ftElectron.contextMenu.open(getContextParameters(event))
  if (request !== openRequest || result.items.length === 0) return

  items.value = result.items
  sessionId.value = result.sessionId
  position.value = { x: event.clientX, y: event.clientY }
  submenusOpenStart.value = event.clientX > window.innerWidth / 2
  verticalTabLayout.value = document.querySelector('.app')?.classList.contains('verticalTabs') === true
  isOpen.value = true
  await nextTick()

  const rect = menuRef.value.getBoundingClientRect()
  position.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))
  }
}

function close(event) {
  if (event?.target instanceof Element && event.target.closest('.contextMenu')) return
  openRequest++
  isOpen.value = false
}

async function execute(item) {
  if (!item.enabled || !item.actionId || sessionId.value == null) return

  const currentSessionId = sessionId.value
  close()
  await window.ftElectron.contextMenu.execute(currentSessionId, item.actionId)
}

function translateLabel(label) {
  let match = /^Close (\d+) Tabs$/.exec(label)
  if (match) return t('Context Menu.Close Multiple Tabs', { count: Number(match[1]) })

  match = /^Duplicate (\d+) Tabs$/.exec(label)
  if (match) return t('Context Menu.Duplicate Multiple Tabs', { count: Number(match[1]) })

  match = /^Search "(.+)" in a New (Tab|Window)$/.exec(label)
  if (match) {
    return match[2] === 'Tab'
      ? t('Context Menu.Search Selection in New Tab', { selection: match[1] })
      : t('Context Menu.Search Selection in New Window', { selection: match[1] })
  }

  match = /^".+" is too long for search \(> (\d+) chars\)$/.exec(label)
  if (match) return t('Context Menu.Selection Too Long', { count: Number(match[1]) })

  const key = `Context Menu.${label}`
  // Labels are validated against this namespace before being translated.
  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  return te(key) ? t(key) : label
}

function handleKeydown(event) {
  if (!isOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  close()
}

onMounted(() => {
  document.addEventListener('contextmenu', open)
  document.addEventListener('pointerdown', close, true)
  document.addEventListener('fullscreenchange', updateFullscreenTarget)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', handleKeydown, true)
  updateFullscreenTarget()
})

onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', open)
  document.removeEventListener('pointerdown', close, true)
  document.removeEventListener('fullscreenchange', updateFullscreenTarget)
  window.removeEventListener('blur', close)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped src="./FtContextMenu.css" />
