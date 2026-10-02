<template>
  <Transition name="capacitor-tab-actions">
    <div
      v-if="tab"
      class="capacitorTabActionsBackdrop"
      :class="`mode-${mode}`"
      @pointerdown.self.stop
      @click.self.stop="emit('dismiss')"
      @keydown.esc.stop.prevent="activeMenu ? setMenu(null) : emit('dismiss')"
    >
      <section
        class="capacitorTabActions"
        role="menu"
        :aria-label="menuLabel"
      >
        <header class="capacitorTabActionHeader">
          <button
            v-if="activeMenu"
            ref="submenuBack"
            type="button"
            role="menuitem"
            class="submenuBack"
            @click="setMenu(null)"
          >
            <FtIcon
              :icon="['fas', 'arrow-left']"
              aria-hidden="true"
            />
            {{ t('Back') }}
          </button>
          <strong
            v-if="!activeMenu"
            dir="auto"
          >{{ title }}</strong>
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
            <template v-if="activeMenu === 'close'">
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
            <template v-else-if="activeMenu === 'devices'">
              <button
                v-for="(device, index) in deviceMenuItem?.submenu"
                :key="index"
                type="button"
                role="menuitem"
                @click="sendToDevice(device)"
              >
                <FtIcon
                  :icon="device.icon"
                  aria-hidden="true"
                />
                {{ device.label }}
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
                v-if="deviceMenuItem"
                ref="deviceMenuTrigger"
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                :aria-expanded="activeMenu === 'devices'"
                :disabled="!deviceMenuItem.enabled"
                class="submenuTrigger"
                @click="setMenu('devices')"
              >
                <FtIcon
                  :icon="['fas', 'devices']"
                  aria-hidden="true"
                />
                <span>{{ t('Settings.Sync Settings.Open On Device') }}</span>
                <FtIcon
                  :icon="['fas', 'chevron-right']"
                  aria-hidden="true"
                />
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
                :aria-expanded="activeMenu === 'close'"
                class="submenuTrigger"
                @click="setMenu('close')"
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
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useI18n } from 'vue-i18n'
import { getTabDeviceMenuItem } from '../../helpers/tab-device-menu'

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
const activeMenu = ref(null)
const deviceMenuItem = computed(() => getTabDeviceMenuItem(props.tab ? [props.tab] : [], t))
const menuLabel = computed(() => activeMenu.value === 'close'
  ? t('Context Menu.Close Tabs')
  : activeMenu.value === 'devices' ? t('Settings.Sync Settings.Open On Device') : props.title)
const actionList = useTemplateRef('actionList')
const actionContent = useTemplateRef('actionContent')
const closeMenuTrigger = useTemplateRef('closeMenuTrigger')
const deviceMenuTrigger = useTemplateRef('deviceMenuTrigger')
const submenuBack = useTemplateRef('submenuBack')
let mainScrollTop = 0

async function sendToDevice(device) {
  emit('dismiss')
  await device.run()
}

async function setMenu(menu) {
  const previousMenu = activeMenu.value
  if (menu) mainScrollTop = actionList.value?.scrollTop ?? 0
  activeMenu.value = menu
  await nextTick()
  if (!actionList.value) return
  restoreOverlayScrollTop(actionList.value, menu ? 0 : mainScrollTop)
  clampOverlayScrollTop(actionList.value, actionContent.value)
  const firstAction = actionList.value.querySelector('button:not(:disabled)')
  const trigger = previousMenu === 'devices' ? deviceMenuTrigger.value : closeMenuTrigger.value
  const target = menu
    ? firstAction ?? submenuBack.value
    : trigger && !trigger.disabled ? trigger : firstAction
  target?.focus({ preventScroll: true })
}

watch(() => props.tab?.id, async () => {
  activeMenu.value = null
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
