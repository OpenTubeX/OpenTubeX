import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref, unref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')

test('mobile thumbnail actions retain availability, state, and handlers', () => {
  const start = source.indexOf('const mobileThumbnailActions = computed(')
  assert.notEqual(start, -1, 'thumbnail actions must be available in the mobile context menu')
  const end = source.indexOf('\nconst openMobileContextActions', start)
  const calls = []
  const context = { computed,
    extraThumbnailActionButton: ref(null), showPlaylists: ref(true),
    isInAnyPlaylist: ref(false), isQuickBookmarkEnabled: ref(true), props: reactive({ quickBookmarkButtonEnabled: true, canMoveVideoUp: false, canMoveVideoDown: false, canRemoveFromPlaylist: false }),
    quickBookmarkIconText: ref('Bookmark'), quickBookmarkIcon: ref(['far', 'bookmark']),
    isInQuickBookmarkPlaylist: ref(false), inUserPlaylist: ref(false),
    effectiveListTypeIsList: ref(true),
    canToggleLiveReminder: ref(false), liveReminderActive: ref(false), liveReminderLoading: ref(false),
    t: key => key,
    mobilePlaylistPickerOpen: ref(false),
    handleExtraThumbnailAction: () => calls.push('extra'), toggleQuickBookmarked: () => calls.push('bookmark'),
    moveVideoUp: () => calls.push('up'), moveVideoDown: () => calls.push('down'),
    removeFromPlaylist: () => calls.push('remove'), toggleLiveReminder: () => calls.push('reminder')
  }
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.actions = mobileThumbnailActions', context)
  assert.equal(context.actions.value.length, 2)
  context.actions.value.forEach(action => action.run())
  assert.equal(context.mobilePlaylistPickerOpen.value, true)
  assert.deepEqual(calls, ['bookmark'])
  context.isInQuickBookmarkPlaylist.value = true
  assert.equal(context.actions.value[1].pressed, true)
  context.showPlaylists.value = false
  context.props.quickBookmarkButtonEnabled = false
  assert.equal(context.actions.value.length, 0)
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
  assert.deepEqual(calls.slice(1), ['extra', 'up', 'down', 'remove'])
})

test('the thumbnail row is reactive and only appears at the root of its mobile menu', async () => {
  const app = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = app.indexOf('const mobileContextThumbnailActions = computed(')
  const context = {
    computed, unref,
    mobileContextMenuStack: ref([{}]),
    mobileContextActions: ref({ thumbnailActions: [{ label: 'Bookmark' }] })
  }
  vm.runInNewContext(app.slice(start, app.indexOf('const mobileContextMenuRows', start)) + '\nglobalThis.actions = mobileContextThumbnailActions', context)
  assert.equal(context.actions.value.length, 1)
  context.mobileContextMenuStack.value.push({})
  assert.equal(context.actions.value.length, 0)
  context.mobileContextMenuStack.value.pop()
  assert.equal(context.actions.value.length, 1)
  context.mobileContextActions.value = { actions: [] }
  assert.equal(context.actions.value.length, 0)
})
