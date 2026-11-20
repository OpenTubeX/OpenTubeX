import { shallowRef } from 'vue'

import store from '../store/index'
import { subscribeToChannel, unsubscribeFromChannel } from './channel-subscriptions'
import { showToast } from './utils'

/**
 * The unsubscribe confirmation that App shows for channel menus.
 * @type {import('vue').ShallowRef<{ channelName: string, resolve: (confirmed: boolean) => void } | null>}
 */
export const channelUnsubscribeConfirmation = shallowRef(null)

/** @param {string} channelName */
function confirmUnsubscription(channelName) {
  if (!store.getters.getUnsubscriptionPopupStatus) return Promise.resolve(true)
  channelUnsubscribeConfirmation.value?.resolve(false)
  return new Promise((resolve) => {
    channelUnsubscribeConfirmation.value = { channelName, resolve }
  })
}

export function getChannelLinkDetails(link) {
  const prefix = `${window.location.href.split('#')[0]}#/channel/`
  if (!link.href.startsWith(prefix)) return null

  const id = link.href.slice(prefix.length).match(/^[^/?#]+/)?.[0]
  if (!id) return null

  const name = link.dataset.tabTitle?.trim() ||
    link.getAttribute('title')?.trim() ||
    link.getAttribute('aria-label')?.trim() ||
    link.closest('.ft-list-channel, .author-div, .channel')?.querySelector('.h3Title, .channelName, .authorNameLink')?.textContent?.trim() ||
    link.textContent?.trim() ||
    id

  const image = link.querySelector('img:not(.retryImagePlaceholder)') ??
    link.closest('.ft-list-channel, .author-div, .channel, .profileRow')?.querySelector('img:not(.retryImagePlaceholder)')
  const thumbnail = image?.getAttribute('src') ||
    store.getters.getSubscribedChannelsById.get(id)?.thumbnail ||
    store.getters.getChannelThumbnail(id) || null

  return {
    id,
    name,
    thumbnail: typeof thumbnail === 'string'
      ? thumbnail.replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
      : null
  }
}

export function getChannelLinkMenuItems({ id, name, thumbnail }, t) {
  const hidden = store.getters.getChannelsHiddenNames.has(id)
  const pinned = store.getters.getPinnedChannels.some(channel => channel.id === id)

  const items = [{
    label: pinned ? t('User Playlists.Unpin from Navigation') : t('User Playlists.Pin to Navigation'),
    icon: ['fas', pinned ? 'thumbtack-slash' : 'thumbtack'],
    enabled: true,
    run: async () => {
      const saved = await store.dispatch('updatePinnedChannels', channels => [
        ...channels.filter(channel => channel.id !== id),
        ...pinned ? [] : [{ id, name, thumbnail }],
      ])
      if (!saved) {
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      }
    }
  }, {
    label: hidden ? t('Video.Unhide Channel') : t('Video.Hide Channel'),
    icon: hidden ? ['fas', 'user-check'] : ['fas', 'user-lock'],
    enabled: true,
    run: () => {
      const channels = store.getters.getChannelsHiddenParsed
      const updated = hidden
        ? channels.filter(channel => channel.name !== id)
        : [...channels, { name: id, preferredName: name }]
      store.dispatch('updateChannelsHidden', JSON.stringify(updated))
      showToast({
        message: hidden
          ? t('Channel Unhidden', { channel: name })
          : t('Channel Hidden', { channel: name }),
        icon: hidden ? ['fas', 'eye'] : ['fas', 'eye-slash']
      })
    }
  }]

  // Subscriptions are saved by channel ID only.
  if (!/^UC[\w-]{22}$/.test(id)) return items

  const subscribed = store.getters.getActiveSubscribedChannelIdSet.has(id)
  // The action applies to the profile the menu showed, even if it changes before the user confirms.
  const profileId = store.getters.getActiveProfile._id
  const getProfile = () => store.getters.getProfileList.find(profile => profile._id === profileId)
  return [{
    label: subscribed ? t('Channel.Unsubscribe') : t('Channel.Subscribe'),
    icon: ['fas', subscribed ? 'user-minus' : 'user-plus'],
    enabled: true,
    run: async () => {
      if (!subscribed) {
        const profile = getProfile()
        if (profile) await subscribeToChannel(profile, { id, name, thumbnail }, t)
      } else if (await confirmUnsubscription(name)) {
        const profile = getProfile()
        if (profile) await unsubscribeFromChannel(profile, id, t)
      }
    }
  }, ...items]
}
