<template>
  <div>
    <ft-card class="card">
      <div class="heading">
        <h2>
          <FontAwesomeIcon
            :icon="['fas', 'user-check']"
            class="headingIcon"
          />
          {{ $t('Channels.Title') }}
        </h2>
        <FtProfileSelector
          v-if="hideProfileSelectorInHeader"
          class="profileSelector"
        />
      </div>
      <ft-input
        v-show="subscribedChannels.length > 1"
        ref="searchBarChannels"
        :placeholder="$t('Channels.Search bar placeholder')"
        :value="query"
        :show-clear-text-button="true"
        :show-action-button="false"
        :maxlength="255"
        @input="handleQueryChange"
        @clear="() => handleQueryChange('')"
      />
      <ft-flex-box
        v-if="activeSubscriptionList.length === 0"
      >
        <p class="message">
          {{ $t('Channels.Empty') }}
        </p>
      </ft-flex-box>
      <template v-else>
        <ft-flex-box class="count">
          {{ $t('Channels.Count', { number: channelList.length }) }}
        </ft-flex-box>
        <ft-flex-box class="channels">
          <div
            v-for="channel in displayedChannels"
            :key="channel.id"
            class="channel"
          >
            <router-link
              tabindex="-1"
              class="thumbnailContainer"
              :to="`/channel/${channel.id}`"
            >
              <img
                v-if="channel.thumbnail != null"
                class="channelThumbnail"
                :src="thumbnailURL(channel.thumbnail)"
                alt=""
                @error.once="updateThumbnail(channel)"
              >
              <font-awesome-icon
                v-else
                class="channelThumbnail"
                :icon="['fas', 'circle-user']"
              />
            </router-link>
            <router-link
              class="channelName"
              dir="auto"
              :title="channel.name"
              :to="`/channel/${channel.id}`"
            >
              {{ channel.name }}
            </router-link>
            <div
              v-if="!hideUnsubscribeButton"
              class="unsubscribeContainer"
            >
              <ft-subscribe-button
                :channel-id="channel.id"
                :channel-name="channel.name"
                :channel-thumbnail="channel.thumbnail"
                :open-dropdown-on-subscribe="false"
              />
            </div>
          </div>
        </ft-flex-box>
        <FtAutoLoadNextPageWrapper
          v-if="hasMoreChannels"
          :key="channelLimit"
          @load-next-page="loadMoreChannels"
        >
          <ft-flex-box>
            <FtButton
              :label="$t('Channels.Load More Channels')"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              @click="loadMoreChannels"
            />
          </ft-flex-box>
        </FtAutoLoadNextPageWrapper>
      </template>
    </ft-card>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onMounted, onBeforeUnmount, ref, watch, useTemplateRef } from 'vue'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtProfileSelector from '../../components/FtProfileSelector/FtProfileSelector.vue'
import FtSubscribeButton from '../../components/FtSubscribeButton/FtSubscribeButton.vue'
import { invidiousGetChannelInfo, youtubeImageUrlToInvidious, invidiousImageUrlToInvidious } from '../../helpers/api/invidious'
import { getLocalChannel, parseLocalChannelHeader } from '../../helpers/api/local'
import { ctrlFHandler } from '../../helpers/utils'
import { useI18n } from 'vue-i18n'
import store from '../../store/index'

const route = useRoute()
const router = useRouter()
const { locale } = useI18n()

const re = {
  url: /(.+=\w)\d+(.+)/,
  ivToYt: /^.+ggpht\/(.+)/
}
const ytBaseURL = 'https://yt3.ggpht.com'
const thumbnailSize = 176
const channelsPerPage = 50
let errorCount = 0

const query = ref('')
const channelLimit = ref(channelsPerPage)
const subscribedChannels = ref([])
const filteredChannels = ref([])

const searchBarChannels = useTemplateRef('searchBarChannels')

/** @type {import('vue').ComputedRef<object>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

/** @type {import('vue').ComputedRef<string>} */
const activeProfileId = computed(() => {
  return activeProfile.value._id
})

/** @type {import('vue').ComputedRef<Array>} */
const activeSubscriptionList = computed(() => {
  return activeProfile.value.subscriptions
})

/** @type {import('vue').ComputedRef<Array>} */
const channelList = computed(() => {
  if (query.value !== '') {
    return filteredChannels.value
  } else {
    return subscribedChannels.value
  }
})

const displayedChannels = computed(() => {
  return channelList.value.slice(0, channelLimit.value)
})

const hasMoreChannels = computed(() => {
  return displayedChannels.value.length < channelList.value.length
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => {
  return store.getters.getHideUnsubscribeButton
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideProfileSelectorInHeader = computed(() => {
  return store.getters.getHideProfileSelectorInHeader
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

function getSubscription() {
  subscribedChannels.value = activeSubscriptionList.value.slice().sort((a, b) => {
    return a.name?.toLowerCase().localeCompare(b.name?.toLowerCase(), locale.value)
  })
}

function filterChannels() {
  if (query.value === '') {
    filteredChannels.value = []
    return
  }

  const escapedQuery = query.value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')
  const re = new RegExp(escapedQuery, 'i')
  filteredChannels.value = subscribedChannels.value.filter(channel => {
    return re.test(channel.name)
  })
}

function thumbnailURL(originalURL) {
  if (originalURL == null) { return null }
  let newURL = originalURL
  // Sometimes relative protocol URLs are passed in
  if (originalURL.startsWith('//')) {
    newURL = `https:${originalURL}`
  }
  const hostname = new URL(newURL).hostname
  if (hostname === 'yt3.ggpht.com' || hostname === 'yt3.googleusercontent.com') {
    if (backendPreference.value === 'invidious') { // YT to IV
      newURL = youtubeImageUrlToInvidious(newURL, currentInvidiousInstanceUrl.value)
    }
  } else {
    if (backendPreference.value === 'local') { // IV to YT
      newURL = newURL.replace(re.ivToYt, `${ytBaseURL}/$1`)
    } else { // IV to IV
      newURL = invidiousImageUrlToInvidious(newURL, currentInvidiousInstanceUrl.value)
    }
  }

  return newURL.replace(re.url, `$1${thumbnailSize}$2`)
}

function updateThumbnail(channel) {
  errorCount += 1
  if (backendPreference.value === 'local') {
    // avoid too many concurrent requests
    setTimeout(() => {
      getLocalChannel(channel.id).then(response => {
        if (!response.alert) {
          store.dispatch('updateSubscriptionDetails', {
            channelThumbnailUrl: thumbnailURL(parseLocalChannelHeader(response).thumbnailUrl),
            channelName: channel.name,
            channelId: channel.id
          })
        }
      })
    }, errorCount * 500)
  } else {
    setTimeout(() => {
      invidiousGetChannelInfo(channel.id).then(response => {
        store.dispatch('updateSubscriptionDetails', {
          channelThumbnailUrl: thumbnailURL(response.authorThumbnails[0].url),
          channelName: channel.name,
          channelId: channel.id
        })
      })
    }, errorCount * 500)
  }
}

function handleQueryChange(val) {
  query.value = val
  channelLimit.value = channelsPerPage
  filterChannels()

  saveStateInRouter(val)
}

function loadMoreChannels() {
  channelLimit.value += channelsPerPage
}

async function saveStateInRouter(query) {
  if (query === '') {
    await router.replace({ name: 'subscribedChannels' }).catch(failure => {
      if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
        return
      }

      throw failure
    })
    return
  }

  await router.replace({
    name: 'subscribedChannels',
    query: { searchQueryText: query },
  }).catch(failure => {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      return
    }

    throw failure
  })
}

function keyboardShortcutHandler(event) {
  ctrlFHandler(event, searchBarChannels.value)
}

watch(activeProfileId, () => {
  query.value = ''
  channelLimit.value = channelsPerPage
  getSubscription()
})

watch(activeSubscriptionList, () => {
  getSubscription()
  filterChannels()
})

// region created

getSubscription()

const oldQuery = route.query.searchQueryText ?? ''
if (oldQuery !== null && oldQuery !== '') {
  handleQueryChange(oldQuery)
}

// endregion created

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})
</script>
<style scoped src="./SubscribedChannels.css" />
