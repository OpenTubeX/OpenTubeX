import { reactive } from 'vue'

import store from '../store/index'
import { isVideoHiddenByPreferences } from './subscriptions'

/**
 * Whether a list shows the entry blurred because a block list matches it.
 * Lists that blur entries must remove them with the `...ToRemove` block list getters.
 * @param {object} video
 * @param {{ useChannelsHidden?: boolean, hideChannelsBasedOnText?: boolean }} [options]
 */
export function isBlurredByBlockLists(video, { useChannelsHidden = true, hideChannelsBasedOnText = true } = {}) {
  return store.getters.getBlurBlockedItemsActive && isVideoHiddenByPreferences(video, {
    hiddenChannelNames: useChannelsHidden ? store.getters.getActiveChannelsHiddenNames : undefined,
    forbiddenTitles: store.getters.getActiveForbiddenTitles,
    hideChannelsBasedOnText,
  })
}

/**
 * Keys of blocked items revealed this session, shared so that windowed and cached lists
 * keep them revealed when they remount the item.
 * @type {Set<string>}
 */
export const revealedBlockedItems = reactive(new Set())
