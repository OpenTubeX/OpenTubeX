import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl } from '../../src/renderer/helpers/videoThumbnail.js'
import { getCustomIconImageSource } from '../../src/renderer/helpers/customIcons.js'

async function compileComponent(path, bindings = {}) {
  const { descriptor } = parse(await readFile(new URL(`../../src/renderer/components/${path}`, import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: path, inlineTemplate: true }).content
    .replace(/import \{([^}]+)\} from ["']vue["'];?/g, (_, imports) => `const {${imports.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import .* from .*\n/gm, '')
    .replace("import('../helpers/api/capacitor-http')", 'loadNativeHttp()')
    .replace('export default', 'const component =')
  return runInNewContext(`${source}; component`, { Vue, process: { env: { IS_CAPACITOR: true } }, URL, Date, Event, getVideoThumbnailSource, getVideoThumbnailFallbackUrl, ...bindings })
}

async function mountAvatar(t, nativeResult, componentPath = 'FtChannelAvatar/FtChannelAvatar.vue', cachedSources = new Map(), attrs = {}) {
  const requests = []
  const loads = []
  const timers = new Map()
  const observers = []
  const settings = Vue.reactive({ getThumbnailDataSaver: false })
  const RetryImage = await compileComponent('FtRetryImage.vue', {
    store: { getters: settings },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(image) { this.image = image }
      disconnect() { this.disconnected = true }
    },
    loadNativeHttp: async () => ({ fetchCapacitorAvatarDataUrl: async src => { requests.push(src); return typeof nativeResult === 'function' ? nativeResult() : nativeResult } }),
    FtIcon: { render: () => Vue.h('fallback') },
    thumbnailPlaceholder: 'placeholder.svg',
    imageSkeleton: 'skeleton.svg',
    setTimeout: (callback, delay) => {
      const id = {}
      const fire = () => { timers.delete(id); return callback() }
      fire.delay = delay
      timers.set(id, fire)
      return id
    },
    clearTimeout: id => timers.delete(id)
  })
  const Avatar = componentPath === 'FtRetryImage.vue' ? RetryImage : await compileComponent(componentPath, {
    FtRetryImage: RetryImage, FtIcon: { render: () => Vue.h('fallback') },
    Icon: { render: () => Vue.h('fallback') }, getCustomIconImageSource,
    resolveIconifyId: () => 'test:icon', normalizeFaIcon: () => null,
    currentIconPack: Vue.ref('material'), faAliasToCanon: {},
    getTabAvatarUrl: tab => tab.avatarUrl, getTabPreviewFallbackUrl: () => null,
    getTabPageIcon: () => null, formatTabTitle: title => title
  })
  const renderer = Vue.createRenderer({
    createElement: tag => ({
      tag, props: {}, children: [],
      dispatchEvent(event) {
        Object.defineProperties(event, { target: { value: this }, currentTarget: { value: this } })
        this.props[event.type === 'error' ? 'onError' : 'onLoad']?.(event)
      }
    }),
    createComment: () => ({ tag: 'comment' }),
    createText: text => ({ tag: 'text', text }),
    setElementText() {}, setText() {},
    patchProp: (node, key, previous, value) => {
      node.props[key] = value
      if (key === 'loading') node.loading = value
      if (node.tag === 'img' && key === 'src') {
        const size = cachedSources.get(value)
        node.complete = !!size
        node.naturalWidth = size?.[0] ?? 0
        node.naturalHeight = size?.[1] ?? 0
      }
    },
    insert(node, parent, anchor) {
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1) },
    parentNode: node => node.parent,
    nextSibling: node => node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  })
  const thumbnail = Vue.ref('https://yt3.ggpht.com/avatar')
  const root = { children: [] }
  const app = renderer.createApp({ render: () => Vue.h(Avatar, componentPath === 'FtRetryImage.vue'
    ? { ...attrs, src: thumbnail.value, onLoad: event => loads.push({ type: event.type, target: event.target, currentTarget: event.currentTarget }) }
    : componentPath === 'FtIcon/FtIcon.vue'
    ? { icon: { type: 'image', value: thumbnail.value } }
    : componentPath.startsWith('TabBar/')
    ? { tab: { id: 'channel-tab', avatarUrl: thumbnail.value, title: 'Channel' } }
    : { thumbnail: thumbnail.value }) })
  app.mount(root)
  t.after(() => app.unmount())
  const find = (tag, node = root) => node.tag === tag ? node : node.children?.map(child => find(tag, child)).find(Boolean)
  return { requests, loads, timers, observers, thumbnail, settings, find, unmount: () => app.unmount() }
}

async function fail(image) {
  for (const handler of [image.props.onError].flat()) await handler({ type: 'error' })
  await Vue.nextTick()
}

test('cached avatars are visible on mount and when switching back to a cached source before load events', async t => {
  const src = 'https://yt3.ggpht.com/avatar'
  const f = await mountAvatar(t, null, 'FtChannelAvatar/FtChannelAvatar.vue', new Map([[src, [48, 48]]]))
  await Vue.nextTick()
  assert.ok(!f.find('fallback'), 'a complete cached image needs no placeholder')
  assert.notEqual(f.find('img').props.style?.visibility, 'hidden')
  f.thumbnail.value = 'https://yt3.ggpht.com/uncached-avatar'
  await Vue.nextTick()
  assert.ok(f.find('fallback'), 'a pending source still needs its placeholder')
  f.thumbnail.value = src
  await Vue.nextTick()
  assert.ok(!f.find('fallback'))
  assert.notEqual(f.find('img').props.style?.visibility, 'hidden')
})

test('cached custom image icons are visible immediately when their source changes', async t => {
  const src = 'data:image/png;base64,AAAA'
  const f = await mountAvatar(t, null, 'FtIcon/FtIcon.vue', new Map([[src, [24, 24]]]))
  f.thumbnail.value = src
  await Vue.nextTick()
  assert.ok(!f.find('fallback'), 'cached custom images need no placeholder')
  assert.equal(f.find('img').props.style.visibility, 'visible')
})

test('cached missing-resolution thumbnails still fall back and reveal an already cached smaller image', async t => {
  const src = 'https://i.ytimg.com/vi/cached/maxresdefault.jpg'
  const fallback = getVideoThumbnailFallbackUrl(src)
  const f = await mountAvatar(t, null, 'FtRetryImage.vue', new Map([[src, [120, 90]], [fallback, [640, 480]]]))
  f.thumbnail.value = src
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, fallback)
  assert.notEqual(f.find('img').props.style?.visibility, 'hidden')
  assert.equal(f.loads.length, 1)
  assert.equal(f.loads[0].type, 'load')
  assert.ok(Vue.toRaw(f.loads[0].currentTarget) === f.find('img'), 'cached load events retain the image for consumers')
})

test('complete but undecodable cached images keep their placeholder', async t => {
  const f = await mountAvatar(t, null, 'FtChannelAvatar/FtChannelAvatar.vue', new Map([['https://yt3.ggpht.com/avatar', [0, 0]]]))
  await Vue.nextTick()
  assert.ok(f.find('fallback'))
  assert.equal(f.find('img').props.style?.visibility, 'hidden')
})

test('avatars show their default icon while loading, retrying, and after a source change', async t => {
  const f = await mountAvatar(t, null)
  assert.ok(f.find('fallback'), 'show the avatar placeholder before the first load')
  assert.equal(f.find('img').props.style?.visibility, 'hidden')
  await fail(f.find('img'))
  assert.ok(f.find('fallback'), 'keep the placeholder during native recovery and the retry delay')
  assert.equal(f.find('img').props.style?.visibility, 'hidden')
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  f.find('img').props.onLoad({ target: { naturalWidth: 48, naturalHeight: 48 } })
  await Vue.nextTick()
  assert.equal(f.find('fallback'), undefined)
  assert.notEqual(f.find('img').props.style?.visibility, 'hidden')
  f.thumbnail.value = 'https://yt3.ggpht.com/new-avatar'
  await Vue.nextTick()
  assert.ok(f.find('fallback'), 'restore the placeholder for a new URL')
  assert.equal(f.find('img').props.style?.visibility, 'hidden')
})

test('stored medium-resolution thumbnails load sharply by default and honor data saver', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  f.thumbnail.value = 'https://i.ytimg.com/vi/video/mqdefault.jpg'
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, 'https://i.ytimg.com/vi/video/maxresdefault.jpg')
  f.settings.getThumbnailDataSaver = true
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
})

test('undecodable embedded images keep their placeholder without an invalid HTTP retry', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  for (const source of ['data:image/png;base64,AAAA', 'blob:https://localhost/invalid']) {
    f.thumbnail.value = source
    await Vue.nextTick()
    await fail(f.find('img'))
    assert.equal(f.find('img').props.src, source)
    assert.equal(f.find('img').props.style?.visibility, 'hidden')
    assert.equal(f.timers.size, 0)
    assert.equal(f.requests.length, 0)
  }
})

test('data saver changes loaded thumbnail sources and resets resolution fallbacks', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  f.thumbnail.value = 'https://invidious.test/vi/video/maxresdefault.jpg?cache=1'
  await Vue.nextTick()
  f.settings.getThumbnailDataSaver = true
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/mqdefault.jpg?cache=1')
  f.settings.getThumbnailDataSaver = false
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
  await fail(f.find('img'))
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/sddefault.jpg?cache=1')
  f.settings.getThumbnailDataSaver = true
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/mqdefault.jpg?cache=1')
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers.values()][0].delay, 10_000)
})

test('channel avatars keep their placeholder until the native HTTP image loads', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==')
  await fail(f.find('img'))
  assert.deepEqual(f.requests, ['https://yt3.ggpht.com/avatar'])
  assert.equal(f.find('img')?.props.src, 'data:image/png;base64,AA==')
  assert.ok(f.find('fallback'), 'keep the placeholder until the recovered image decodes')
  f.find('img').props.onLoad({ target: { naturalWidth: 48, naturalHeight: 48 } })
  await Vue.nextTick()
  assert.equal(f.find('fallback'), undefined)
})

test('video thumbnails fall back in resolution order on errors and loaded placeholders', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  f.thumbnail.value = 'https://invidious.test/vi/video/maxresdefault.jpg?cache=1'
  await Vue.nextTick()
  await fail(f.find('img'))
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/sddefault.jpg?cache=1')
  f.find('img').props.onLoad({ target: { naturalWidth: 120, naturalHeight: 90 } })
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/hqdefault.jpg?cache=1')
  f.find('img').props.onLoad({ target: { naturalWidth: 480, naturalHeight: 360 } })
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/hqdefault.jpg?cache=1')
  await fail(f.find('img'))
  assert.equal(f.find('img').props.src, 'https://invidious.test/vi/video/mqdefault.jpg?cache=1')
  assert.equal(f.requests.length, 0)
  assert.equal(f.timers.size, 0)
  f.thumbnail.value = 'https://i.ytimg.com/vi/other/maxresdefault.jpg'
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
  f.find('img').props.onLoad({ target: { naturalWidth: 1280, naturalHeight: 720 } })
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
})

test('channel avatars remove the failed image after the delayed retry and reset for a new URL', async t => {
  const f = await mountAvatar(t, null)
  await fail(f.find('img'))
  assert.ok(f.find('img'), 'keep the image mounted while retrying')
  assert.equal(f.timers.size, 1)
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  assert.match(f.find('img').props.src, /opentubex_retry=/)
  await fail(f.find('img'))
  assert.ok(f.find('fallback'))
  f.thumbnail.value = 'https://yt3.ggpht.com/other-avatar'
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
})

test('duplicate errors during the retry delay do not remove the avatar or start another request', async t => {
  const f = await mountAvatar(t, null)
  await fail(f.find('img'))
  await fail(f.find('img'))
  assert.ok(f.find('img'))
  assert.equal(f.requests.length, 1)
  assert.equal(f.timers.size, 1)
})

test('an undecodable native image falls back without retrying indefinitely', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==')
  await fail(f.find('img'))
  await fail(f.find('img'))
  assert.ok(f.find('fallback'))
  assert.equal(f.requests.length, 1)
  assert.equal(f.timers.size, 0)
})

test('tab preview channel avatars recover before hiding the failed URL', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==', 'TabBar/TabTooltipPreview.vue')
  assert.match(f.find('fallback').props.class, /ft-shimmer/)
  await fail(f.find('img'))
  assert.deepEqual(f.requests, ['https://yt3.ggpht.com/avatar'])
  assert.equal(f.find('img')?.props.src, 'data:image/png;base64,AA==')
})

test('unexpected native recovery errors still allow the delayed retry and terminal fallback', async t => {
  const f = await mountAvatar(t, () => { throw new TypeError('Invalid response headers') })
  await fail(f.find('img'))
  assert.ok(f.find('img'))
  assert.equal(f.timers.size, 1)
  await fail(f.find('img'))
  assert.ok(f.find('img'), 'ignore duplicate errors while the retry is pending')
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  assert.match(f.find('img').props.src, /opentubex_retry=/)
  await fail(f.find('img'))
  assert.ok(f.find('fallback'))
})


test('thumbnail skeletons stop on the first failure while retries continue and restart for a new source', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  const placeholder = () => f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
  assert.equal(placeholder().props.src, 'skeleton.svg')
  assert.match(placeholder().props.class, /ft-shimmer/)
  await fail(f.find('img'))
  assert.equal(placeholder().props.src, 'placeholder.svg')
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  await fail(f.find('img'))
  assert.equal(placeholder().props.src, 'placeholder.svg')
  assert.doesNotMatch(placeholder().props.class, /ft-shimmer/)
  f.thumbnail.value = 'https://images.test/new-thumbnail'
  await Vue.nextTick()
  assert.equal(placeholder().props.src, 'skeleton.svg')
  f.find('img').props.onLoad({ target: { naturalWidth: 640, naturalHeight: 360 } })
  await Vue.nextTick()
  assert.equal(placeholder(), undefined)
})

test('missing and intentionally hidden thumbnails keep their permanent fallback', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  for (const source of ['', 'placeholder.svg']) {
    f.thumbnail.value = source
    await Vue.nextTick()
    const placeholder = f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
    assert.equal(placeholder.props.src, 'placeholder.svg')
    assert.doesNotMatch(placeholder.props.class, /ft-shimmer/)
  }
})

test('custom image icons shimmer until decoded and keep a static fallback after failure', async t => {
  const f = await mountAvatar(t, null, 'FtIcon/FtIcon.vue')
  f.thumbnail.value = 'data:image/png;base64,AAAA'
  await Vue.nextTick()
  const skeleton = () => f.find('img').parent.children.find(node => node.props?.class?.includes('ft-shimmer'))
  assert.ok(skeleton())
  await fail(f.find('img'))
  assert.equal(skeleton(), undefined)
  assert.ok(f.find('fallback'))
  f.thumbnail.value = 'data:image/png;base64,BBBB'
  await Vue.nextTick()
  assert.ok(skeleton())
  f.find('img').props.onLoad()
  await Vue.nextTick()
  assert.equal(skeleton(), undefined)
  assert.equal(f.find('fallback'), undefined)
})

test('completed failed images leave the skeleton even when their error event was missed', async t => {
  const src = 'https://yt3.ggpht.com/avatar'
  const f = await mountAvatar(t, null, 'FtRetryImage.vue', new Map([[src, [0, 0]]]))
  await Vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests.length, 1, 'an already-failed source must enter recovery')
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  await fail(f.find('img'))
  const placeholder = f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
  assert.doesNotMatch(placeholder.props.class, /ft-shimmer/)
})

test('stalled requests stop shimmering without blocking a late load', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  const placeholder = () => f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
  assert.match(placeholder().props.class, /ft-shimmer/)
  const deadline = [...f.timers.values()].find(callback => callback.delay === 10_000)
  assert.ok(deadline, 'loading must have a bounded skeleton duration')
  deadline()
  await Vue.nextTick()
  assert.doesNotMatch(placeholder().props.class, /ft-shimmer/)
  f.find('img').props.onLoad({ target: { naturalWidth: 640, naturalHeight: 360 } })
  await Vue.nextTick()
  assert.equal(placeholder(), undefined)
  assert.equal(f.loads.length, 1)
  assert.equal(f.timers.size, 0, 'a slow success cancels the pending request retry')
})

test('stalled remote avatars retry once after the loading deadline and a short grace period', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue', new Map(), { fallbackIcon: ['fas', 'circle-user'] })
  const image = f.find('img')
  const skeletonDeadline = [...f.timers.values()].find(callback => callback.delay === 10_000)
  skeletonDeadline()
  await Vue.nextTick()
  assert.equal(image.props.src, 'https://yt3.ggpht.com/avatar', 'keep a slow request alive after its shimmer stops')
  const requestDeadline = [...f.timers.values()].find(callback => callback.delay === 3000)
  assert.ok(requestDeadline, 'a stalled request must recover without reloading the video')
  requestDeadline()
  await Vue.nextTick()
  assert.match(image.props.src, /^https:\/\/yt3\.ggpht\.com\/avatar\?opentubex_retry=\d+$/)
  assert.equal(f.requests.length, 0, 'a timeout should retry the browser request')
  await fail(image)
  assert.equal(f.timers.size, 0, 'the retry must remain bounded')
  image.props.onLoad({ target: { naturalWidth: 48, naturalHeight: 48 } })
  await Vue.nextTick()
  assert.equal(f.find('fallback'), undefined)
})

test('source replacements and unmounting cancel pending timeout retries', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  const [deadline] = f.timers.values()
  deadline()
  await Vue.nextTick()
  const oldTimers = [...f.timers.values()]
  assert.equal(oldTimers[0].delay, 3000)
  f.thumbnail.value = 'https://yt3.ggpht.com/replacement-avatar'
  await Vue.nextTick()
  assert.equal(f.timers.size, 1)
  assert.ok([...f.timers.values()].every(timer => !oldTimers.includes(timer)), 'the old source must not keep any deadline')
  const [newDeadline] = f.timers.values()
  newDeadline()
  await Vue.nextTick()
  assert.equal([...f.timers.values()][0].delay, 3000)
  f.unmount()
  assert.equal(f.timers.size, 0)
})

test('an error during the timeout grace period does not queue a second retry', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  const [deadline] = f.timers.values()
  deadline()
  await Vue.nextTick()
  const [retry] = f.timers.values()
  await fail(f.find('img'))
  assert.equal(f.requests.length, 0)
  assert.deepEqual([...f.timers.values()], [retry])
  retry()
  await Vue.nextTick()
  assert.match(f.find('img').props.src, /opentubex_retry=/)
  await fail(f.find('img'))
  assert.equal(f.timers.size, 0)
})

test('pending embedded images never receive an HTTP timeout retry', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  for (const src of ['data:image/png;base64,AAAA', 'blob:https://localhost/pending']) {
    f.thumbnail.value = src
    await Vue.nextTick()
    assert.equal(f.timers.size, 1)
    const [deadline] = f.timers.values()
    assert.equal(deadline.delay, 10_000)
    deadline()
    await Vue.nextTick()
    assert.equal(f.timers.size, 0)
    assert.equal(f.find('img').props.src, src)
    assert.equal(f.requests.length, 0)
  }
})

test('null, undefined and blank image sources keep a static fallback', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue')
  for (const source of [null, undefined, '   ']) {
    f.thumbnail.value = source
    await Vue.nextTick()
    const placeholder = f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
    assert.doesNotMatch(placeholder.props.class, /ft-shimmer/)
    assert.equal(f.find('img').props.src, undefined)
    assert.equal(f.timers.size, 0)
  }
})

test('already-failed custom image icons use a static fallback immediately', async t => {
  const src = 'data:image/png;base64,AAAA'
  const f = await mountAvatar(t, null, 'FtIcon/FtIcon.vue', new Map([[src, [0, 0]]]))
  f.thumbnail.value = src
  await Vue.nextTick()
  assert.ok(f.find('fallback'))
  assert.ok(!f.find('img').parent.children.some(node => node.props?.class?.includes('ft-shimmer')))
})

test('lazy images retain their skeleton until visible and get a bounded loading deadline', async t => {
  const f = await mountAvatar(t, null, 'FtRetryImage.vue', new Map(), { loading: 'lazy' })
  const placeholder = () => f.find('img').parent.children.find(node => node.props?.class?.includes('retryImagePlaceholder'))
  assert.equal(f.timers.size, 0, 'offscreen lazy images must not start their deadline on mount')
  assert.match(placeholder().props.class, /ft-shimmer/)
  assert.equal(f.observers.length, 1)
  f.observers[0].callback([{ isIntersecting: true }])
  const deadline = [...f.timers.values()][0]
  assert.equal(deadline.delay, 10_000)
  f.observers[0].callback([{ isIntersecting: false }])
  f.observers[0].callback([{ isIntersecting: true }])
  assert.equal([...f.timers.values()][0], deadline, 'visibility changes must not restart the deadline')
  deadline()
  await Vue.nextTick()
  assert.doesNotMatch(placeholder().props.class, /ft-shimmer/)
  f.observers[0].callback([{ isIntersecting: false }])
  f.thumbnail.value = 'https://images.test/replaced-lazy-thumbnail'
  await Vue.nextTick()
  assert.equal(f.timers.size, 0)
  assert.match(placeholder().props.class, /ft-shimmer/)
  f.observers[0].callback([{ isIntersecting: true }])
  assert.equal(f.timers.size, 1)
  f.find('img').props.onLoad({ target: { naturalWidth: 640, naturalHeight: 360 } })
  await Vue.nextTick()
  assert.equal(placeholder(), undefined)
  assert.equal(f.timers.size, 0)
  f.unmount()
  assert.equal(f.observers[0].disconnected, true)
})
