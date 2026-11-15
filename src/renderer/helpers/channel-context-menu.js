import store from '../store/index'
import { showToast } from './utils'

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

  return [{
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
}
