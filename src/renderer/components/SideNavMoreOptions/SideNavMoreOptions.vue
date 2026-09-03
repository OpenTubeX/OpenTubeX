<template>
  <div
    ref="menuRef"
    class="sideNavMoreOptions"
  >
    <div
      class="navOption moreOptionNav"
      :class="{ 'router-link-active': overflowRouteActive }"
      tabindex="0"
      role="button"
      :aria-labelledby="hideLabelsSideBar ? null : 'moreNavLabel'"
      :aria-label="hideLabelsSideBar ? $t('More') : null"
      :aria-expanded="openMoreOptions"
      :title="$t('More')"
      @click="openMoreOptions = !openMoreOptions"
      @keydown.enter.space.prevent="openMoreOptions = !openMoreOptions"
    >
      <FtIcon
        :icon="['fas', 'ellipsis-h']"
        class="navIcon"
        :class="applyNavIconExpand"
      />
      <p
        v-if="!hideLabelsSideBar"
        id="moreNavLabel"
        class="navLabel"
      >
        {{ $t("More") }}
      </p>
    </div>
    <div
      v-if="openMoreOptions"
      class="moreOptionContainer"
    >
      <router-link
        v-for="item in items"
        :key="item.id"
        class="navOption"
        :title="item.label"
        :aria-label="hideLabelsSideBar ? item.label : null"
        :to="`/${item.id}`"
        @click="closeMenu"
      >
        <FtIcon
          :icon="item.icon"
          class="navIcon"
          :class="applyNavIconExpand"
        />
        <p
          v-if="!hideLabelsSideBar"
          class="navLabel"
        >
          {{ item.label }}
        </p>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import store from '../../store/index'

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
})

const openMoreOptions = ref(false)
const route = useRoute()

const menuRef = useTemplateRef('menuRef')
const overflowRouteActive = computed(() => props.items.some(item => route.path === `/${item.id}`))

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => {
  return store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideLabelsSideBar.value
  }
})

function closeMenu() {
  openMoreOptions.value = false
}

function handleClickOutside(event) {
  if (openMoreOptions.value && menuRef.value && !menuRef.value.contains(event.target)) {
    closeMenu()
  }
}

const router = useRouter()
let removeNavigationHook = null

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  removeNavigationHook = router.afterEach(closeMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  removeNavigationHook?.()
  removeNavigationHook = null
})
</script>

<style scoped src="./SideNavMoreOptions.css" />
