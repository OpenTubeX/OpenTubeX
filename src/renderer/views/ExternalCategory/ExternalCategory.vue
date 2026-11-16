<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else-if="!category"
      class="card"
    >
      <p class="message">
        {{ notFound ? t('Platforms.Category Not Found') : t('Platforms.Load Error', { platform: platform?.name ?? '' }) }}
      </p>
      <FtFlexBox>
        <FtButton
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="loadCategory"
        />
      </FtFlexBox>
    </FtCard>
    <FtCard
      v-else
      class="card"
    >
      <div class="channelHeader">
        <FtRetryImage
          class="boxArt"
          :src="category.thumbnail"
          :fallback-icon="['fas', 'gamepad']"
          alt=""
        />
        <div class="channelInfo">
          <h2
            class="channelName"
            dir="auto"
          >
            {{ category.name }}
          </h2>
          <p class="channelMeta">
            <span>
              <FtIcon
                :icon="PLATFORM_ICONS[platform.id]"
                aria-hidden="true"
              />
              {{ platform.name }}
            </span>
            <span v-if="category.viewerCount != null && !hideViews">
              {{ t('Global.Counts.Watching Count', { count: formatViewCount(category.viewerCount, shortenViewCounts) }, category.viewerCount) }}
            </span>
          </p>
        </div>
        <div class="channelActions">
          <FtIconButton
            :title="t('Platforms.Open Website', { platform: platform.name })"
            :icon="['fas', 'arrow-up-right-from-square']"
            theme="base-no-default"
            :size="20"
            :padding="8"
            @click="openExternalLink(category.url)"
          />
        </div>
      </div>
      <p
        v-if="results.length === 0"
        class="message"
      >
        {{ t('Platforms.Empty Tab') }}
      </p>
      <PlatformResultList
        class="streams"
        :results="results"
      />
    </FtCard>
  </div>
</template>

<script setup>
import { computed, shallowRef, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import PlatformResultList from '../../components/PlatformResultList/PlatformResultList.vue'

import store from '../../store/index'
import { getPlatformFetch } from '../../helpers/platformFetch'
import { formatViewCount, openExternalLink } from '../../helpers/utils'
import { useTabTitle } from '../../tabs/TabContext'
import { getPlatform, PLATFORM_ICONS } from '../../../platforms/index'

const { t } = useI18n()
const route = useRoute()
const setTabTitle = useTabTitle()

const platform = computed(() => getPlatform(route.query.platform))
const categoryId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const hideViews = computed(() => store.getters.getHideVideoViews)
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformCategory | null>} */
const category = shallowRef(null)
/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformResult[]>} */
const results = shallowRef([])
const isLoading = ref(true)
const notFound = ref(false)

let loadGeneration = 0

async function loadCategory() {
  const generation = ++loadGeneration
  isLoading.value = true
  notFound.value = false
  category.value = null
  results.value = []
  if (!platform.value?.getCategory || !categoryId.value) {
    notFound.value = true
    isLoading.value = false
    return
  }
  setTabTitle(platform.value.name)
  try {
    const result = await platform.value.getCategory(getPlatformFetch(platform.value.id), categoryId.value)
    if (generation !== loadGeneration) return
    notFound.value = result === null
    if (result) {
      category.value = result.category
      results.value = result.items.map(item => ({ kind: /** @type {const} */ ('item'), item }))
      setTabTitle(result.category.name)
    }
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load the category', error)
  } finally {
    if (generation === loadGeneration) isLoading.value = false
  }
}

watch([() => route.query.platform, () => route.query.id], loadCategory, { immediate: true })
</script>

<style scoped src="../ExternalChannel/ExternalChannel.css" />
<style scoped>
/* With a single action, it stays beside the name, which wraps instead */
.channelHeader {
  flex-wrap: nowrap;
}

.channelInfo {
  flex-basis: 0;
}

.boxArt {
  flex: none;
  inline-size: 72px;
  aspect-ratio: 3 / 4;
  border-radius: var(--shape-corner-small);
  object-fit: cover;
  font-size: 72px;
}

.streams {
  margin-block-start: 16px;
}
</style>
