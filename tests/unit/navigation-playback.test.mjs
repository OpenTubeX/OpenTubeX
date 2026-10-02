import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { getPreviousBrowsingRoute } from '../../src/renderer/tabs/playerDockDestination.js'

const source = (await readFile(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')

const titleSource = (await readFile(new URL('../../src/renderer/tabs/TabContext.js', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')

function mountWatch(t, { paused = false, hasLoaded = true, mounted = true, enabled = true, previous = '/history', loaded = hasLoaded, mobile = false } = {}) {
  const route = { path: '/watch/video', fullPath: '/watch/video', params: { id: 'video' } }
  const props = reactive({ tabId: 'tab', route, presented: true })
  const getters = reactive({ getKeepPlayingOnNavigation: enabled, getTabById: () => ({ historyIndex: previous ? 1 : 0, history: previous ? [{ route: { path: previous } }] : [] }) })
  const provides = new Map()
  const unmount = []
  const titles = []
  const scope = effectScope()
  const video = { paused, ended: false }
  const previewRoot = {
    closest: () => ({ getBoundingClientRect: () => hostBounds }),
    getBoundingClientRect: () => ({ left: 0, top: 60.25, width: 412.25 }),
    firstElementChild: { style: { removeProperty(key) { delete this[key] } } },
    style: {
      setProperty(key, value) { this[key] = value },
      removeProperty(key) { delete this[key] }
    }
  }
  const hostBounds = { left: 0, top: 60.25, width: 412.25 }
  const tabBounds = { left: 0, top: 60.25, width: 412.25 }
  const listeners = new Map()
  let savedBrowsingScroll = null
  const viewport = {
    scrollX: 0, scrollY: 20, innerHeight: 800,
    scrollTo(position) { this.lastScroll = position; this.scrollX = position.left; this.scrollY = position.top },
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name) { listeners.delete(name) }
  }
  let lifecycle
  let disposals = 0
  async function navigate(path) {
    const to = { path, fullPath: path, params: {} }
    await lifecycle.beforeNavigate({ to, from: props.route })
    props.route = to
    await nextTick()
    await lifecycle.afterNavigate({ to })
  }
  const previewStyle = scope.run(() => vm.runInNewContext(`${source}\npreviewStyle`, {
    computed, nextTick, reactive, ref, shallowRef, watch,
    window: viewport,
    document: { querySelector: selector => selector === '.app.capacitorTabs' && mobile ? {} : null },
    isReducedMotionEnabled: () => true,
    defineProps: () => props,
    // The native scroll mini player lives outside the watch view's DOM tree.
    // Its component reference must remain usable without a DOM video descendant.
    useTemplateRef: name => name === 'watchRoot' ? ref(previewRoot) : name === 'previewHost' ? ref({ getBoundingClientRect: () => hostBounds, closest: () => ({ getBoundingClientRect: () => tabBounds }) }) : ref(mounted ? { $refs: { player: { hasLoaded: loaded, isPaused: () => video.paused } }, querySelector: () => null } : null),
    provide: (key, value) => provides.set(key, value),
    onBeforeUnmount: callback => unmount.push(callback),
    store: { getters, commit: (_name, payload) => { savedBrowsingScroll = payload.scroll } },
    resolveRouteComponent: () => ({}),
    getTabNavigationService: () => ({ createRouterFacade: () => ({}), setTitle: (...args) => titles.push(args), back: () => navigate(props.route.path === '/subscriptions' ? '/watch/video' : previous), forward: () => navigate('/watch/video'), push: (_id, path) => navigate(path) }),
    tabLifecycleService: { register: (_id, hooks) => { lifecycle = hooks; return () => {} } },
    tabLifecycleKey: 'lifecycle', tabPresentedKey: 'presented', watchNavigationKey: 'navigation', getPreviousBrowsingRoute,
    routeLocationKey: 'route', routerKey: 'router', console
  }))
  const updateTitle = vm.runInNewContext(`${titleSource}; useTabTitle()`, {
    inject: key => key.description === 'watch-navigation' ? provides.get('navigation') : null,
    onBeforeUnmount: callback => unmount.push(callback)
  })
  provides.get('lifecycle').register('tab', { beforeDispose: () => { disposals++ } })
  t.after(async () => {
    unmount.forEach(callback => callback())
    await nextTick()
    scope.stop()
  })
  return {
    props, getters, provides, lifecycle, previewRoot, previewStyle, hostBounds, tabBounds, viewport, listeners, titles, updateTitle,
    disposals: () => disposals,
    savedBrowsingScroll: () => savedBrowsingScroll,
    navigate
  }
}

test('retains a playing native video outside the watch DOM across navigation', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  assert.equal(mounted.disposals(), 0)
  assert.equal(mounted.provides.get('navigation').detached.value, true)
  assert.equal(mounted.provides.get('presented').value, false)
  assert.equal(mounted.provides.get('route').fullPath, '/watch/video')
  await mounted.navigate('/history')
  assert.equal(mounted.disposals(), 0)
  await mounted.navigate('/watch/video')
  assert.equal(mounted.disposals(), 0)
  assert.equal(mounted.provides.get('presented').value, true)
  assert.equal(mounted.provides.get('navigation').detached.value, false)
})

for (const options of [{ paused: true }, { hasLoaded: false, paused: true }]) {
  test(`navigation retains the mounted player ${JSON.stringify(options)}`, async t => {
    const mounted = mountWatch(t, options)
    await mounted.navigate('/subscriptions')
    assert.equal(mounted.disposals(), 0)
    assert.equal(mounted.provides.get('navigation').detached.value, true)
    await mounted.navigate('/watch/video')
    assert.equal(mounted.disposals(), 0)
    assert.equal(mounted.provides.get('navigation').detached.value, false)
  })
}

test('disabling retention disposes the hidden player only once', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  mounted.getters.getKeepPlayingOnNavigation = false
  await nextTick()
  await mounted.lifecycle.beforeDispose()
  assert.equal(mounted.disposals(), 1)
})

for (const options of [{ mounted: false }, { paused: true, enabled: false }, { hasLoaded: false, enabled: false }]) {
  test(`does not retain unavailable playback ${JSON.stringify(options)}`, async t => {
    const mounted = mountWatch(t, options)
    await mounted.navigate('/subscriptions')
    assert.equal(mounted.disposals(), 1)
    assert.equal(mounted.provides.get('navigation').detached.value, false)
  })
}

test('restores detached title options without resolving pending metadata', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  const options = { resolveHistoryEntry: false }
  mounted.updateTitle('Watch', options)
  await mounted.navigate('/watch/video')
  assert.equal(mounted.titles.at(-1)[1], 'Watch')
  assert.equal(mounted.titles.at(-1)[2], options)
})

test('return navigation waits for disabled retained playback to finish disposal', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  mounted.provides.get('lifecycle').register('tab', { beforeDispose: () => pending })
  mounted.getters.getKeepPlayingOnNavigation = false
  await nextTick()
  let returned = false
  const returning = mounted.navigate('/watch/video').then(() => { returned = true })
  await new Promise(resolve => setImmediate(resolve))
  const returnedDuringDisposal = returned
  finish()
  await returning
  assert.equal(returnedDuringDisposal, false)
  assert.equal(mounted.disposals(), 1)
  assert.equal(mounted.provides.get('navigation').detached.value, false)
})

test('retains the current history title when a later entry repeats the watch URL', async t => {
  const mounted = mountWatch(t)
  mounted.getters.getTabById = () => ({
    historyIndex: 0,
    history: [
      { route: { fullPath: '/watch/video' }, title: 'Watch', titlePending: true },
      { route: { fullPath: '/watch/video' }, title: 'Later title', titlePending: false }
    ]
  })
  await mounted.navigate('/subscriptions')
  await mounted.navigate('/watch/video')
  assert.equal(mounted.titles.at(-1)[1], 'Watch')
  assert.equal(mounted.titles.at(-1)[2].resolveHistoryEntry, false)
})

for (const paused of [true, false]) {
  test(`explicit minimization retains playback with navigation retention disabled (paused=${paused})`, async t => {
    const mounted = mountWatch(t, { paused, enabled: false })
    const navigation = mounted.provides.get('navigation')
    await navigation.minimize()
    assert.equal(mounted.props.route.path, '/history')
    assert.equal(mounted.disposals(), 0)
    assert.equal(navigation.detached.value, true)
    assert.equal(navigation.minimized.value, true)
    assert.equal(mounted.getters.getKeepPlayingOnNavigation, false)
    await navigation.returnToVideo()
    assert.equal(mounted.props.route.path, '/watch/video')
    assert.equal(navigation.minimized.value, false)
    assert.equal(navigation.detached.value, false)
  })
}

for (const previous of [null, '/watch/other']) {
  test(`minimization has a browsing fallback when history is ${previous}`, async t => {
    const mounted = mountWatch(t, { previous })
    await mounted.provides.get('navigation').minimize()
    assert.equal(mounted.props.route.path, '/subscriptions')
    assert.equal(mounted.disposals(), 0)
  })
}


for (const commit of [false, true]) {
  test(`drag keeps navigation idle until release and ${commit ? 'commits' : 'cancels'}`, async t => {
    const mounted = mountWatch(t, { paused: true, enabled: false })
    const navigation = mounted.provides.get('navigation')
    navigation.beginMinimizePreview()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(mounted.props.route.path, '/watch/video')
    assert.equal(mounted.provides.get('presented').value, true, 'The gesture keeps the player presented')
    assert.equal(mounted.disposals(), 0)
    navigation.updateMinimizePreview(0.5)
    assert.equal(mounted.previewRoot.style.opacity, '0.5')
    mounted.viewport.scrollY = 320.125
    mounted.listeners.get('scroll')()
    assert.equal(mounted.previewRoot.style.top, '300.125px')
    await navigation.finishMinimizePreview(commit)
    navigation.clearMinimizePreview(commit)
    assert.equal(mounted.props.route.path, commit ? '/history' : '/watch/video')
    assert.equal(mounted.provides.get('presented').value, !commit)
    assert.equal(mounted.previewRoot.style.opacity, undefined)
    assert.equal(mounted.listeners.has('scroll'), false)
    assert.equal(mounted.disposals(), 0)
  })
}


for (const commit of [false, true]) {
  test(`upward drag reveals retained Watch before release and ${commit ? 'restores' : 'cancels'}`, async t => {
    const mounted = mountWatch(t, { paused: true, enabled: false })
    const navigation = mounted.provides.get('navigation')
    navigation.beginMinimizePreview()
    await navigation.finishMinimizePreview(true)
    navigation.clearMinimizePreview(true)
    assert.equal(navigation.beginRestorePreview(), true)
    assert.equal(mounted.props.route.path, '/history')
    assert.equal(mounted.provides.get('presented').value, true)
    assert.equal(mounted.previewRoot.style.opacity, '0')
    navigation.updateMinimizePreview(0.75)
    assert.ok(Number(mounted.previewRoot.style.opacity) > 0)
    await navigation.finishMinimizePreview(commit)
    navigation.clearMinimizePreview(!commit)
    assert.equal(mounted.props.route.path, commit ? '/watch/video' : '/history')
    assert.equal(mounted.disposals(), 0)
    assert.equal(mounted.listeners.has('scroll'), false)
  })
}


test('upward reveal begins early and never blends the two pages', async t => {
  const mounted = mountWatch(t)
  const navigation = mounted.provides.get('navigation')
  await navigation.minimize()
  navigation.beginRestorePreview()
  for (const progress of [0, 0.04, 0.08]) {
    navigation.updateMinimizePreview(1 - progress)
    assert.equal(Number(mounted.previewRoot.style.opacity), 0)
  }
  for (const progress of [0.1, 0.2, 0.3, 0.5, 0.85, 0.95, 1]) {
    navigation.updateMinimizePreview(1 - progress)
    const background = Number(mounted.previewRoot.style.opacity)
    const content = Number(mounted.previewRoot.firstElementChild.style.opacity)
    assert.ok(content === 0 || background === 1, 'Watch content appears only over its opaque background')
  }
})


test('returning from the mini player restores Watch at the top without a second scroll', async t => {
  const mounted = mountWatch(t)
  const navigation = mounted.provides.get('navigation')
  mounted.viewport.scrollY = 120.75
  navigation.beginMinimizePreview()
  await navigation.finishMinimizePreview(true)
  navigation.clearMinimizePreview()
  mounted.viewport.scrollY = 300.125
  navigation.beginRestorePreview()
  await navigation.finishMinimizePreview(true)
  assert.equal(mounted.viewport.scrollY, 0)
  assert.equal(mounted.viewport.lastScroll.behavior, 'instant')
  assert.equal(mounted.savedBrowsingScroll().top, 300.125)
})

for (const commit of [true, false]) {
  test(`swiping a loading video keeps its component through ${commit ? 'minimization' : 'cancellation'}`, async t => {
    const mounted = mountWatch(t, { loaded: false, paused: true, enabled: false })
    const navigation = mounted.provides.get('navigation')
    navigation.beginMinimizePreview()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(mounted.disposals(), 0)
    assert.equal(navigation.detached.value, false)
    await navigation.finishMinimizePreview(commit)
    navigation.clearMinimizePreview()
    assert.equal(mounted.disposals(), 0)
    assert.equal(navigation.detached.value, commit)
    if (commit) await navigation.returnToVideo()
    assert.equal(mounted.props.route.path, '/watch/video')
  })
}

test('closing the retained mini player disposes and unmounts Watch', async t => {
  const mounted = mountWatch(t)
  const navigation = mounted.provides.get('navigation')
  await navigation.minimize()
  assert.equal(typeof navigation.dismiss, 'function')
  await navigation.dismiss()
  assert.equal(mounted.disposals(), 1)
  assert.equal(navigation.detached.value, false)
  assert.equal(navigation.minimized.value, false)
  assert.equal(mounted.props.route.path, '/history')
})

test('upward preview starts fading after a short swipe', async t => {
  const mounted = mountWatch(t)
  const navigation = mounted.provides.get('navigation')
  await navigation.minimize()
  navigation.beginRestorePreview()
  navigation.updateMinimizePreview(0.8)
  assert.ok(Number(mounted.previewRoot.style.opacity) > 0)
  assert.equal(Number(mounted.previewRoot.firstElementChild.style.opacity), 0)
})

test('restoring after resizing uses the current tab geometry', async t => {
  const mounted = mountWatch(t)
  const navigation = mounted.provides.get('navigation')
  await navigation.minimize()
  mounted.hostBounds.width = 800.5
  mounted.hostBounds.top = -139.75
  mounted.tabBounds.width = 800.5
  mounted.tabBounds.top = -139.75
  mounted.viewport.scrollY = 220
  mounted.viewport.innerHeight = 600
  navigation.beginRestorePreview()
  assert.equal(mounted.previewStyle.value.width, '800.5px')
  assert.equal(mounted.previewStyle.value.top, '220px')
  assert.equal(mounted.previewStyle.value.height, '519.75px')
})

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} restore aligns the retained Watch view with its tab`, async t => {
    const mounted = mountWatch(t, { mobile })
    const navigation = mounted.provides.get('navigation')
    await navigation.minimize()
    mounted.hostBounds.top = 2452.125
    mounted.viewport.scrollY = 0
    navigation.beginRestorePreview()
    assert.equal(mounted.previewStyle.value.top, '-2391.875px')
    assert.equal(mounted.previewStyle.value.width, '412.25px')
    assert.equal(mounted.previewStyle.value.height, '739.75px')
  })
}
