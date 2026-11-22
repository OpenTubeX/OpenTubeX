<template>
  <div class="ft-list-video ft-list-item grid platformCategory">
    <div class="videoThumbnail">
      <RouterLink
        class="thumbnailLink"
        :to="route"
        :data-tab-title="category.name"
        tabindex="-1"
        aria-hidden="true"
      >
        <FtRetryImage
          :src="category.thumbnail"
          :fallback-icon="['fas', 'gamepad']"
          class="thumbnailImage"
          alt=""
        />
      </RouterLink>
    </div>
    <div class="info">
      <RouterLink
        class="title"
        :to="route"
        :data-tab-title="category.name"
        :title="category.name"
      >
        <h3
          class="h3Title"
          dir="auto"
        >
          {{ category.name }}
        </h3>
      </RouterLink>
      <div
        v-if="viewerText"
        class="infoLine"
      >
        {{ viewerText }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { formatViewCount } from '../../helpers/utils'
import { getPlatformCategoryRoute } from '../../../platforms/index'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformCategory>} */
  category: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()

const route = computed(() => getPlatformCategoryRoute(props.category.platform, props.category.id))
const viewerText = computed(() => {
  const count = props.category.viewerCount
  if (count == null || store.getters.getHideVideoViews) return ''
  return t('Global.Counts.Watching Count', { count: formatViewCount(count, store.getters.getShortenViewCounts) }, count)
})
</script>

<style scoped lang="scss">
@use '../../scss-partials/ft-list-item';

@include ft-list-item.thumbnail-hover-outline;

// Box art is portrait, unlike the video thumbnails of grid cards
.platformCategory.grid .videoThumbnail .thumbnailImage {
  aspect-ratio: 3 / 4;
}

.infoLine {
  color: var(--tertiary-text-color);
  font-size: 14px;
}
</style>
