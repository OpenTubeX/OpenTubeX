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
    link.closest('.ft-list-channel, .ft-list-post, .channel')?.querySelector('.h3Title, .channelName, .authorNameLink')?.textContent?.trim() ||
    link.textContent?.trim() ||
    id

  return { id, name }
}

export function getChannelLinkMenuItems({ id, name }, t) {
  const hidden = store.getters.getChannelsHiddenNames.has(id)

  return [{
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
