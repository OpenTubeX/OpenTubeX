import { shallowRef } from 'vue'

import store from '../store/index'
import { getPlatformFetch } from './platformFetch'
import { findFollowedChannel, followPlatformChannel, supportsPlatformFollows, unfollowPlatformChannel } from './platformFeed'
import { copyToClipboard, showToast } from './utils'
import { getPlatform, getPlatformChannelKey } from '../../platforms/index'

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
  const appUrl = window.location.href.split('#')[0]
  const platformChannel = getPlatformChannelLinkDetails(link, appUrl)
  if (platformChannel) return platformChannel

  const prefix = `${appUrl}#/channel/`
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

export function getChannelLinkMenuItems(channel, t) {
  if (channel.platform) return getPlatformChannelLinkMenuItems(channel, t)

  const { id, name, thumbnail } = channel
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
        if (profile) {
          const { subscribeToChannel } = await import('./channel-subscriptions')
          await subscribeToChannel(profile, { id, name, thumbnail }, t)
        }
      } else if (await confirmUnsubscription(name)) {
        const profile = getProfile()
        if (profile) {
          const { unsubscribeFromChannel } = await import('./channel-subscriptions')
          await unsubscribeFromChannel(profile, id, t)
        }
      }
    }
  }, ...items]
}

/**
 * The channel of another platform that a link opens.
 * @param {HTMLAnchorElement} link
 * @param {string} appUrl
 */
function getPlatformChannelLinkDetails(link, appUrl) {
  const prefix = `${appUrl}#/external-channel?`
  if (!link.href.startsWith(prefix) || !supportsPlatformFollows) return null
  const query = new URLSearchParams(link.href.slice(prefix.length))
  const platform = getPlatform(query.get('platform'))
  const id = query.get('id')
  if (!platform || !id) return null

  const name = link.dataset.tabTitle?.trim() ||
    link.closest('.ft-list-channel')?.querySelector('.h3Title')?.textContent?.trim() ||
    link.textContent?.trim() ||
    id
  return { platform: platform.id, id, name }
}

/**
 * The pin of a channel of another platform, also when the link has another of
 * its IDs, like an address does.
 * @param {string} platformId
 * @param {string} id
 */
function findPinnedPlatformChannel(platformId, id) {
  const platform = getPlatform(platformId)
  return store.getters.getPinnedChannels.find(channel => channel.platform === platformId &&
    (channel.channelId === id || (channel.url && platform?.parseChannelUrl(channel.url) === id)))
}

/**
 * The details of a channel of another platform, from where the app has them or loaded.
 * @param {string} platformId
 * @param {string} id
 * @returns {Promise<{ platform: string, id: string, name: string, url: string, avatar?: string } | null>}
 */
async function loadPlatformChannel(platformId, id) {
  const followed = findFollowedChannel(platformId, id)
  if (followed) return followed
  return await getPlatform(platformId)?.getChannel(getPlatformFetch(platformId), id) ?? null
}

/**
 * @param {{ platform: string, id: string, name: string }} channel
 * @param {(key: string, parameters?: object) => string} t
 */
function getPlatformChannelLinkMenuItems({ platform, id, name }, t) {
  const followed = findFollowedChannel(platform, id)
  const pinned = findPinnedPlatformChannel(platform, id)
  const showError = (message) => showToast({ message, icon: ['fas', 'circle-exclamation'] })
  const showLoadError = (error) => {
    console.error('Failed to load the channel', error)
    showError(t('Subscriptions.Platforms.Channel Could Not Be Loaded'))
  }

  return [{
    label: followed ? t('Subscriptions.Platforms.Unfollow') : t('Subscriptions.Platforms.Follow'),
    icon: ['fas', followed ? 'user-minus' : 'user-plus'],
    enabled: true,
    run: async () => {
      try {
        if (followed) {
          await unfollowPlatformChannel(followed)
        } else if (await followPlatformChannel(platform, id) === null) {
          showError(t('Subscriptions.Platforms.Channel Not Found'))
        }
      } catch (error) {
        showLoadError(error)
      }
    }
  }, {
    label: pinned ? t('User Playlists.Unpin from Navigation') : t('User Playlists.Pin to Navigation'),
    icon: ['fas', pinned ? 'thumbtack-slash' : 'thumbtack'],
    enabled: true,
    run: async () => {
      let pin = null
      if (!pinned) {
        try {
          const channel = await loadPlatformChannel(platform, id)
          if (!channel) {
            showError(t('Subscriptions.Platforms.Channel Not Found'))
            return
          }
          // Keyed by platform, as IDs of different platforms can be the same
          pin = {
            id: getPlatformChannelKey(channel),
            platform,
            channelId: channel.id,
            name: channel.name,
            thumbnail: channel.avatar ?? null,
            url: channel.url
          }
        } catch (error) {
          showLoadError(error)
          return
        }
      }
      const removedId = pinned?.id ?? pin.id
      const saved = await store.dispatch('updatePinnedChannels', channels => [
        ...channels.filter(channel => channel.id !== removedId),
        ...pin ? [pin] : [],
      ])
      if (!saved) showError(t('Channel.Failed to save subscription settings'))
    }
  }, {
    label: t('Share.Copy Link'),
    icon: ['fas', 'link'],
    enabled: true,
    run: async () => {
      let url = followed?.url ?? pinned?.url
      if (!url) {
        try {
          url = (await loadPlatformChannel(platform, id))?.url
        } catch (error) {
          showLoadError(error)
          return
        }
      }
      if (url) {
        copyToClipboard(url)
      } else {
        showError(t('Subscriptions.Platforms.Channel Not Found'))
      }
    }
  }]
}
