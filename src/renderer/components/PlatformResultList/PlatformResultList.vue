<template>
  <!-- Categories have portrait box art, so they get portrait columns -->
  <FtAutoGrid
    :grid="categories || layout === 'grid'"
    :youtube-style-shorts="categories"
    :item-count="results.length"
    :item-keys="keys"
  >
    <template
      v-for="(result, index) in results"
      :key="keys[index]"
    >
      <FtListFeedItem
        v-if="result.kind === 'item'"
        :data="result.item"
        :layout="layout"
        :avatar="avatar"
        :seen-actions="false"
      />
      <FtListPlatformChannel
        v-else-if="result.kind === 'channel'"
        :channel="result.channel"
        :layout="layout"
      />
      <FtListPlatformCategory
        v-else-if="result.kind === 'category'"
        :category="result.category"
      />
      <FtListPlatformPlaylist
        v-else
        :playlist="result.playlist"
        :layout="layout"
      />
    </template>
  </FtAutoGrid>
</template>

<script setup>
import { computed } from 'vue'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtListFeedItem from '../FtListFeedItem/FtListFeedItem.vue'
import FtListPlatformCategory from '../FtListPlatformCategory/FtListPlatformCategory.vue'
import FtListPlatformChannel from '../FtListPlatformChannel/FtListPlatformChannel.vue'
import FtListPlatformPlaylist from '../FtListPlatformPlaylist/FtListPlatformPlaylist.vue'

import store from '../../store/index'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformResult[]>} */
  results: {
    type: Array,
    required: true
  },
  /** The avatar of the channel all items belong to */
  avatar: {
    type: String,
    default: null
  }
})

// Full width is a single-column grid, so its items render as grid cards.
const layout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')
const categories = computed(() => props.results.length > 0 && props.results.every(result => result.kind === 'category'))
// Pages can repeat an item that moved between their requests
const keys = computed(() => props.results.map((result, index) => {
  const value = result.kind === 'item'
    ? result.item
    : result.kind === 'channel' ? result.channel : result.kind === 'category' ? result.category : result.playlist
  return `${index}:${result.kind}:${value.platform}:${value.id}`
}))
</script>
