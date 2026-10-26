<template>
  <div class="subscriptionGroupBar">
    <FtTabs
      v-if="groups.length > 0"
      class="groupTabs"
      role="tablist"
      :aria-label="t('Subscription Groups.Groups')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id ?? ''"
        :ref="element => setTabRef(tab.id, element)"
        class="groupTab"
        type="button"
        role="tab"
        :aria-selected="activeGroupId === tab.id"
        :aria-controls="panelId"
        :tabindex="activeGroupId === tab.id ? 0 : -1"
        :data-subscription-group="tab.id ?? ''"
        @click="selectGroup(tab.id)"
        @keydown.left.right.home.end="switchGroup($event, tab.id)"
      >
        <span
          class="groupName"
          dir="auto"
        >{{ tab.name }}</span>
      </button>
    </FtTabs>
    <div class="groupActions">
      <template v-if="groups.length > 0">
        <FtIconButton
          v-if="activeGroup !== null"
          class="groupAction"
          :title="t('Subscription Groups.Edit Group')"
          :icon="['fas', 'pencil']"
          theme="base-no-default"
          :padding="8"
          :size="18"
          @click="openEditor(activeGroup)"
        />
        <FtIconButton
          class="groupAction"
          :title="t('Subscription Groups.New Group')"
          :icon="['fas', 'plus']"
          theme="base-no-default"
          :padding="8"
          :size="18"
          @click="openEditor(null)"
        />
      </template>
      <FtButton
        v-else
        class="newGroupButton"
        :label="t('Subscription Groups.New Group')"
        :icon="['fas', 'plus']"
        @click="openEditor(null)"
      />
    </div>
    <FtSubscriptionGroupEditor
      v-if="editorOpen"
      :group="editedGroup"
      @close="closeEditor"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtSubscriptionGroupEditor from '../FtSubscriptionGroupEditor/FtSubscriptionGroupEditor.vue'
import FtTabs from '../FtTabs/FtTabs.vue'

import store from '../../store/index'

defineProps({
  /** ID of the element whose content the groups filter */
  panelId: {
    type: String,
    default: null
  }
})

const { t } = useI18n()

/** @type {import('vue').ComputedRef<import('../../helpers/subscription-groups').SubscriptionGroup[]>} */
const groups = computed(() => store.getters.getSubscriptionGroupList)
const activeGroup = computed(() => store.getters.getActiveSubscriptionGroup)
const activeGroupId = computed(() => activeGroup.value?.id ?? null)

const tabs = computed(() => [
  { id: null, name: t('Subscription Groups.All') },
  ...groups.value
])

/** @type {Map<string | null, HTMLElement>} */
const tabRefs = new Map()

/**
 * @param {string | null} groupId
 * @param {Element | import('vue').ComponentPublicInstance | null} element
 */
function setTabRef(groupId, element) {
  if (element instanceof HTMLElement) {
    tabRefs.set(groupId, element)
  } else {
    tabRefs.delete(groupId)
  }
}

/** @param {string | null} groupId */
function selectGroup(groupId) {
  if (groupId !== activeGroupId.value) store.dispatch('selectSubscriptionGroup', groupId)
}

/**
 * @param {KeyboardEvent} event
 * @param {string | null} focusedGroupId
 */
function switchGroup(event, focusedGroupId) {
  // Alt+Left and Alt+Right navigate back and forward
  if (event.altKey) return
  event.preventDefault()

  const ids = tabs.value.map(tab => tab.id)
  let index = ids.indexOf(focusedGroupId)
  // The tabs follow the reading direction, so left points back in RTL.
  const forward = (event.key === 'ArrowRight') !== (getComputedStyle(event.currentTarget).direction === 'rtl')

  if (event.key === 'Home') {
    index = 0
  } else if (event.key === 'End') {
    index = ids.length - 1
  } else if (forward) {
    index = index >= ids.length - 1 ? 0 : index + 1
  } else {
    index = index <= 0 ? ids.length - 1 : index - 1
  }

  const groupId = ids[index]
  selectGroup(groupId)
  nextTick(() => tabRefs.get(groupId)?.focus())
  store.dispatch('showOutlines')
}

const editorOpen = ref(false)
/** @type {import('vue').ShallowRef<import('../../helpers/subscription-groups').SubscriptionGroup | null>} */
const editedGroup = shallowRef(null)

/** @param {import('../../helpers/subscription-groups').SubscriptionGroup | null} group */
function openEditor(group) {
  editedGroup.value = group
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  editedGroup.value = null
}
</script>

<style scoped src="./FtSubscriptionGroupBar.css" />
