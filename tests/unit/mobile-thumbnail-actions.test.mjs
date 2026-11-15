import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')

test('mobile thumbnail actions retain availability, state, and handlers', () => {
  const start = source.indexOf('const mobileThumbnailActions = computed(')
  assert.notEqual(start, -1, 'thumbnail actions must be available in the mobile context menu')
  const end = source.indexOf('\nconst openMobileContextActions', start)
  const calls = []
  const context = {
    computed,
    process: { env: { IS_CAPACITOR: true } },
    store: { getters: reactive({ getTabsEnabled: true }) },
    extraThumbnailActionButton: ref(null),
    showPlaylists: ref(true),
    isInAnyPlaylist: ref(false),
    isQuickBookmarkEnabled: ref(true),
    props: reactive({ quickBookmarkButtonEnabled: true, canMoveVideoUp: false, canMoveVideoDown: false, canRemoveFromPlaylist: false }),
    quickBookmarkIconText: ref('Bookmark'),
    quickBookmarkIcon: ref(['far', 'bookmark']),
    quickBookmarkPlaylist: ref({ playlistName: 'Favorites' }),
    isInQuickBookmarkPlaylist: ref(false),
    inUserPlaylist: ref(false),
    verticalMoveControls: ref(true),
    canToggleLiveReminder: ref(false),
    liveReminderActive: ref(false),
    liveReminderLoading: ref(false),
    t: key => key,
    mobilePlaylistPickerOpen: ref(false),
    handleOptionsClick: option => calls.push(option),
    toggleQuickBookmarked: () => calls.push('bookmark'),
    moveVideoUp: () => calls.push('up'),
    moveVideoDown: () => calls.push('down'),
    removeFromPlaylist: () => calls.push('remove'),
    toggleLiveReminder: () => calls.push('reminder')
  }
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.actions = mobileThumbnailActions', context)
  assert.equal(context.actions.value.length, 3)
  assert.equal(context.actions.value[0].label, 'Context Menu.Open in a Background Tab')
  assert.deepEqual(Array.from(context.actions.value, action => action.shortLabel), ['Context Menu.Background Tab', 'User Playlists.Save', 'Favorites'])
  context.actions.value.forEach(action => action.run())
  assert.equal(context.mobilePlaylistPickerOpen.value, true)
  assert.deepEqual(calls, ['openBackgroundTab', 'bookmark'])
  context.isInQuickBookmarkPlaylist.value = true
  assert.equal(context.actions.value[2].pressed, true)
  context.showPlaylists.value = false
  context.props.quickBookmarkButtonEnabled = false
  assert.equal(context.actions.value.length, 1)
  context.inUserPlaylist.value = true
  context.props.canMoveVideoUp = true
  context.props.canMoveVideoDown = true
  context.props.canRemoveFromPlaylist = true
  context.canToggleLiveReminder.value = true
  context.liveReminderLoading.value = true
  context.extraThumbnailActionButton.value = { title: 'Extra', icon: ['fas', 'eye'] }
  assert.equal(context.actions.value.length, 5)
  assert.equal(context.actions.value.at(-1).enabled, false)
  context.actions.value.slice(0, 4).forEach(action => action.run())
  assert.deepEqual(calls.slice(2), ['openBackgroundTab', 'up', 'down', 'remove'])
  context.store.getters.getTabsEnabled = false
  assert.equal(context.actions.value.length, 4)
  assert.ok(context.actions.value.every(action => action.label !== 'Context Menu.Open in a Background Tab'))
})
