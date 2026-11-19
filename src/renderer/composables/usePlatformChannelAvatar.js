import { computed, onBeforeUnmount, ref, watch } from 'vue'

import store from '../store/index'

import { fetchChannelInfo } from '../helpers/channel-preferences'
import { findFollowedChannel } from '../helpers/platformFeed'
import { getPlatform, getPlatformChannelKey } from '../../platforms/index'

/**
 * Resolves the avatar of the channel of an item from another platform: the
 * one its list came with, the followed channel's, or the one the channel's
 * page has, which loads once per session for every item of the channel.
 * @param {() => { platform?: string | null, channelId?: string | null, avatar?: string | null }} source
 * @param {{ enabled?: () => boolean, inList?: boolean }} [options] `enabled` tells
 *   whether to load avatars that aren't known. Items `inList` load theirs behind
 *   each other, and not from platforms with heavy channel pages.
 * @returns {import('vue').Ref<string | null>}
 */
export function usePlatformChannelAvatar(source, { enabled = () => true, inList = true } = {}) {
  const avatar = ref(null)
  let generation = 0

  const channel = computed(() => {
    const { platform, channelId } = source()
    const found = platform && channelId ? getPlatform(platform) : null
    return found ? { platform: found.id, id: channelId, heavy: found.heavyChannels === true } : null
  })
  const known = computed(() => source().avatar ||
    (channel.value && findFollowedChannel(channel.value.platform, channel.value.id)?.avatar) || null)
  const key = computed(() => channel.value && !(inList && channel.value.heavy) ? getPlatformChannelKey(channel.value) : null)

  watch([known, key, enabled], async ([knownAvatar, channelKey, canLoad]) => {
    const current = ++generation
    avatar.value = knownAvatar
    if (knownAvatar || !channelKey || !canLoad) return

    const info = await fetchChannelInfo(channelKey, {
      preference: store.getters.getBackendPreference,
      fallback: store.getters.getBackendFallback
    }, { throttle: inList, isWanted: () => current === generation })
    if (current === generation) avatar.value = info?.thumbnail || null
  }, { immediate: true })

  onBeforeUnmount(() => {
    generation++
  })

  return avatar
}
