import assert from 'node:assert/strict'
import test from 'node:test'
import { createIosPlayerHandoff } from '../../src/renderer/helpers/player/iosPlayerHandoff.js'

function fixture({ hidden = true, enabled = true } = {}) {
  const listeners = new Map()
  const document = {
    hidden,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type) },
  }
  let clock = 0
  const scope = { contains: video => video.scope === scope }
  const oldVideo = { tagName: 'VIDEO', scope }
  const oldRoot = { parentElement: scope, querySelector: () => oldVideo, contains: video => video === oldVideo }
  const nextVideo = { tagName: 'VIDEO', scope, currentTime: 20, paused: false, seeking: false }
  let removed = 0
  const handoff = createIosPlayerHandoff({ document, now: () => clock, isEnabled: () => enabled })
  const emit = (type, target = nextVideo) => listeners.get(type)?.({ type, target })
  return {
    document, listeners, oldRoot, oldVideo, nextVideo, handoff, emit,
    leave: () => handoff.leave(oldRoot, () => removed++),
    advance(ms, seconds) { clock += ms; nextVideo.currentTime += seconds; emit('timeupdate') },
    get removed() { return removed },
  }
}

test('keeps the old media DOM through a background gap and removes it after the replacement clock advances', () => {
  const f = fixture()
  f.leave()
  assert.equal(f.removed, 0, 'removing the ended element before the next start makes physical iPad audio silent')
  f.advance(20000, 0)
  assert.equal(f.removed, 0, 'a SABR wait must not expire the handoff')
  f.emit('playing')
  f.advance(500, 0.5)
  assert.equal(f.removed, 0, 'playing alone does not establish audible playback')
  f.advance(750, 0.75)
  assert.equal(f.removed, 1)
  assert.equal(f.listeners.size, 0)
  f.handoff.dispose()
  assert.equal(f.removed, 1)
})

test('ignores old media, other tabs, pauses and seeks', () => {
  const f = fixture()
  f.leave()
  f.emit('playing', f.oldVideo)
  f.emit('playing', { ...f.nextVideo, scope: {} })
  f.advance(2000, 2)
  assert.equal(f.removed, 0)
  f.emit('playing')
  f.nextVideo.paused = true
  f.advance(2000, 2)
  assert.equal(f.removed, 0)
  f.nextVideo.paused = false
  f.emit('playing')
  f.emit('seeking')
  f.advance(2000, 60)
  assert.equal(f.removed, 0)
  f.emit('seeked')
  f.advance(1250, 1)
  assert.equal(f.removed, 1)
})

for (const hidden of [true, false]) {
  test(`does not retain DOM when ${hidden ? 'disabled on this platform/tab' : 'foregrounded'}`, () => {
    const f = fixture({ hidden, enabled: !hidden })
    f.leave()
    assert.equal(f.removed, 1)
    assert.equal(f.listeners.size, 0)
  })
}

for (const reason of ['foreground', 'dispose']) {
  test(`cleans a failed handoff on ${reason}`, () => {
    const f = fixture()
    f.leave()
    if (reason === 'foreground') {
      f.document.hidden = false
      f.emit('visibilitychange')
    } else f.handoff.dispose()
    assert.equal(f.removed, 1)
    assert.equal(f.listeners.size, 0)
  })
}

test('retains at most the original player when another load fails before playing', () => {
  const f = fixture()
  f.leave()
  let failedRemoved = 0
  f.handoff.leave({ ...f.oldRoot, contains: () => false }, () => failedRemoved++)
  assert.equal(failedRemoved, 1)
  assert.equal(f.removed, 0)
  f.emit('playing')
  f.advance(1250, 1)
  assert.equal(f.removed, 1)
})

test('Vue retains the outgoing component across a replacement mount, including a same-video retry', async () => {
  const { BaseTransition, createRenderer, h, nextTick, ref } = await import('vue')
  const { readFile } = await import('node:fs/promises')
  const template = await readFile(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
  assert.match(template, /<Transition\s+:css="false"\s+@leave="leavePlayer"\s*>\s*<ft-shaka-video-player\s+v-if="showShakaPlayer"\s+:key="isIOS \? playerMountKey : undefined"/)

  function node(tag) {
    return {
      tagName: tag.toUpperCase(), children: [], parentElement: null,
      contains(other) { return other === this || this.children.some(child => child.contains(other)) },
      querySelector() { return this.children.find(child => ['VIDEO', 'AUDIO'].includes(child.tagName)) ?? null },
    }
  }
  const renderer = createRenderer({
    createElement: node, createComment: () => node('comment'), createText: () => node('text'),
    setElementText() {}, setText() {}, patchProp() {},
    insert(child, parent, anchor) {
      if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1)
      child.parentElement = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove(child) {
      child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1)
      child.parentElement = null
    },
    parentNode: child => child.parentElement,
    nextSibling: child => child.parentElement?.children[child.parentElement.children.indexOf(child) + 1] ?? null,
  })
  const f = fixture()
  const visible = ref(true)
  const key = ref(0)
  const Player = { render: () => h('div', [h('video')]) }
  const root = node('root')
  const app = renderer.createApp({ render: () => h(BaseTransition, { onLeave: f.handoff.leave }, {
    default: () => visible.value ? [h(Player, { key: key.value })] : [],
  }) })
  app.mount(root)
  const first = root.children[0]
  visible.value = false
  await nextTick()
  assert.equal(first.parentElement, root)
  key.value++
  visible.value = true
  await nextTick()
  assert.equal(first.parentElement, root, 'Vue must not cancel the pending leave when the next player mounts')
  const next = root.children.find(child => child !== first && child.tagName === 'DIV').children[0]
  Object.assign(next, { currentTime: 0, paused: false, seeking: false })
  f.emit('playing', next)
  f.advance(1250, 0)
  next.currentTime = 1
  f.emit('timeupdate', next)
  assert.equal(first.parentElement, null)
  assert.equal(root.children.filter(child => child.tagName === 'DIV').length, 1)
  app.unmount()
  f.handoff.dispose()
})

test('supports later queue handoffs but never retains nodes after its owner is disposed', () => {
  const f = fixture()
  f.leave()
  f.emit('playing')
  f.advance(1250, 1)
  f.leave()
  assert.equal(f.removed, 1, 'a later queued video still gets a handoff')
  f.handoff.dispose()
  assert.equal(f.removed, 2)
  f.leave()
  assert.equal(f.removed, 3, 'teardown cannot arm a new retention after disposal')
  assert.equal(f.listeners.size, 0)
})
