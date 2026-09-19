<template>
  <Transition name="capacitor-tab-actions">
    <div
      v-if="tab"
      class="capacitorTabActionsBackdrop"
      :class="`mode-${mode}`"
      @pointerdown.self.stop
      @click.self.stop="emit('dismiss')"
      @keydown.esc.stop.prevent="showCloseMenu ? setCloseMenu(false) : emit('dismiss')"
    >
      <section
        class="capacitorTabActions"
        role="menu"
        :aria-label="showCloseMenu ? t('Context Menu.Close Tabs') : title"
      >
        <header class="capacitorTabActionHeader">
          <button
            v-if="showCloseMenu"
            ref="submenuBack"
            type="button"
            @click="setCloseMenu(false)"
          >
            <FtIcon
              :icon="['fas', 'arrow-left']"
              aria-hidden="true"
            />
            {{ t('Back') }}
          </button>
          <strong dir="auto">{{ showCloseMenu ? t('Context Menu.Close Tabs') : title }}</strong>
        </header>
        <div
          ref="actionList"
          v-overlay-scrollbars
          class="capacitorTabActionList"
        >
          <div
            ref="actionContent"
            class="capacitorTabActionContent"
          >
            <template v-if="showCloseMenu">
              <button
                v-for="(label, position) in { before: t('Context Menu.Close Tabs Before'), after: t('Context Menu.Close Tabs After'), other: t('Context Menu.Close Other Tabs') }"
                :key="position"
                type="button"
                role="menuitem"
                class="dangerAction"
                :disabled="!relatedTabIds[position].length"
                @click="emit('close-related', position)"
              >
                <FtIcon
                  :icon="['fas', 'rectangle-xmark']"
                  aria-hidden="true"
                />
                {{ label }}
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                role="menuitem"
                @click="emit('select')"
              >
                <FtIcon
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
                {{ t('Context Menu.Select Tab') }}
              </button>
              <button
                v-if="youtubeUrl"
                type="button"
                role="menuitem"
                @click="emit('copy-youtube-link')"
              >
                <FtIcon
                  :icon="['fab', 'youtube']"
                  aria-hidden="true"
                />
                {{ t('Context Menu.Copy YouTube Link') }}
              </button>
              <button
                type="button"
                role="menuitem"
                @click="emit('toggle-pinned')"
              >
                <FtIcon
                  :icon="tab.isPinned ? ['fas', 'thumbtack-slash'] : ['fas', 'thumbtack']"
                  aria-hidden="true"
                />
                {{ tab.isPinned ? t('Context Menu.Unpin Tab') : t('Context Menu.Pin Tab') }}
              </button>
              <button
                type="button"
                role="menuitem"
                @click="emit('duplicate')"
              >
                <FtIcon
                  :icon="['fas', 'clone']"
                  aria-hidden="true"
                />
                {{ t('Context Menu.Duplicate Tab') }}
              </button>
              <button
                type="button"
                role="menuitem"
                @click="emit('reload')"
              >
                <FtIcon
                  :icon="['fas', 'sync']"
                  aria-hidden="true"
                />
                {{ t('Context Menu.Reload Tab') }}
              </button>
              <button
                type="button"
                role="menuitem"
                :disabled="!canToggleLoaded"
                @click="emit('toggle-loaded')"
              >
                <FtIcon
                  :icon="tab.loadState === 'unloaded' ? ['fas', 'download'] : ['fas', 'right-from-bracket']"
                  aria-hidden="true"
                />
                {{ tab.loadState === 'unloaded' ? t('Context Menu.Load Tab') : t('Context Menu.Unload Tab') }}
              </button>
              <button
                ref="closeMenuTrigger"
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                :aria-expanded="showCloseMenu"
                class="closeMenuTrigger"
                @click="setCloseMenu(true)"
              >
                <FtIcon
                  :icon="['fas', 'rectangle-xmark']"
                  aria-hidden="true"
                />
                <span>{{ t('Context Menu.Close Tabs') }}</span>
                <FtIcon
                  :icon="['fas', 'chevron-right']"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                role="menuitem"
                class="dangerAction"
                @click="emit('close')"
              >
                <FtIcon
                  :icon="['fas', 'xmark']"
                  aria-hidden="true"
                />
                {{ t('Close Tab') }}
              </button>
            </template>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  relatedTabIds: {
    type: Object,
    required: true,
  },
  mode: {
    type: String,
    required: true,
    validator: value => ['phone', 'tablet'].includes(value),
  },
  tab: {
    type: Object,
    default: null,
  },
  title: {
    type: String,
    default: '',
  },
  youtubeUrl: {
    type: String,
    default: null,
  },
  canToggleLoaded: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'select',
  'close-related',
  'close',
  'copy-youtube-link',
  'dismiss',
  'duplicate',
  'reload',
  'toggle-loaded',
  'toggle-pinned'
])
const { t } = useI18n()
const showCloseMenu = ref(false)
const actionList = useTemplateRef('actionList')
const actionContent = useTemplateRef('actionContent')
const closeMenuTrigger = useTemplateRef('closeMenuTrigger')
const submenuBack = useTemplateRef('submenuBack')
let mainScrollTop = 0

async function setCloseMenu(open) {
  if (open) mainScrollTop = actionList.value?.scrollTop ?? 0
  showCloseMenu.value = open
  await nextTick()
  if (!actionList.value) return
  restoreOverlayScrollTop(actionList.value, open ? 0 : mainScrollTop)
  clampOverlayScrollTop(actionList.value, actionContent.value)
  const target = open
    ? actionList.value.querySelector('button:not(:disabled)') ?? submenuBack.value
    : closeMenuTrigger.value
  target?.focus({ preventScroll: true })
}

watch(() => props.tab?.id, async () => {
  showCloseMenu.value = false
  mainScrollTop = 0
  await nextTick()
  if (actionList.value) restoreOverlayScrollTop(actionList.value, 0)
})

watch(actionContent, (content, _previous, onCleanup) => {
  if (!content) return
  const observer = new ResizeObserver(() => {
    if (actionList.value) clampOverlayScrollTop(actionList.value, content)
  })
  observer.observe(content)
  onCleanup(() => observer.disconnect())
})
</script>

<style scoped src="./CapacitorTabActionsMenu.css" />
