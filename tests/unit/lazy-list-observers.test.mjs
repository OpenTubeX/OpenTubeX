import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

import { vFirstVisible } from '../../src/renderer/helpers/firstVisible.js'

const observers = []
globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback
    this.observed = new Set()
    observers.push(this)
  }

  observe(element) { this.observed.add(element) }
  unobserve(element) { this.observed.delete(element) }
  disconnect() { this.observed.clear() }
}

async function compileComponent(path, bindings) {
  const { descriptor } = parse(await readFile(new URL(`../../src/renderer/components/${path}`, import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: path, inlineTemplate: true }).content
    .replace(/import \{([^}]+)\} from ["']vue["'];?/g, (_, imports) => `const {${imports.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
    .replace('export default', 'const component =')
  return runInNewContext(`${source}; component`, { Vue, vFirstVisible, process: { env: {} }, ...bindings })
}

function mountList(Component, props) {
  const renderer = Vue.createRenderer({
    createElement: tag => ({ tag, props: {}, children: [] }),
    createComment: () => ({ tag: 'comment', children: [] }),
    createText: text => ({ tag: 'text', text, children: [] }),
    setElementText() {},
    setText() {},
    patchProp: (node, key, _previous, value) => { node.props[key] = value },
    insert(node, parent, anchor) {
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1) },
    parentNode: node => node.parent,
    nextSibling: node => node.parent.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const app = renderer.createApp({
    render: () => Vue.h('div', Array.from({ length: 500 }, (_, index) => Vue.h(Component, { key: index, ...props(index) }))),
  })
  app.mount({ children: [] })
  return app
}

function videoStub(mounted) {
  return { props: ['data'], setup: props => { mounted.push(props.data.videoId); return () => Vue.h('video') } }
}

test('500 lazy video rows share one IntersectionObserver and mount on their first sighting', async () => {
  const mounted = []
  const Lazy = await compileComponent('FtListVideoLazy.vue', {
    store: { getters: { getActiveForbiddenTitles: [] } },
    isVideoHiddenByPreferences: () => false,
    FtListVideo: videoStub(mounted),
  })
  const app = mountList(Lazy, index => ({ data: { videoId: `video-${index}` }, appearance: 'result' }))

  assert.equal(observers.length, 1)
  const [observer] = observers
  assert.equal(observer.observed.size, 500)
  const rows = [...observer.observed]
  observer.callback([{ target: rows[3], isIntersecting: true }, { target: rows[4], isIntersecting: false }])
  await Vue.nextTick()
  assert.deepEqual(mounted, ['video-3'])
  assert.equal(observer.observed.size, 499)

  app.unmount()
  assert.equal(observer.observed.size, 0)
})

test('Electron list cards wait for their first sighting on the shared observer', async () => {
  const mounted = []
  const windowed = []
  const Wrapper = await compileComponent('FtListLazyWrapper/FtListLazyWrapper.vue', {
    process: { env: { IS_ELECTRON: true } },
    store: {
      getters: {
        getHideLiveStreams: false,
        getHideUpcomingPremieres: false,
        getActiveChannelsHiddenNames: new Set(),
        getAiSlopBlockedChannels: new Set(),
        getActiveForbiddenTitles: [],
      },
    },
    isVideoHiddenByPreferences: () => false,
    isOnAiSlopList: () => false,
    observeWindowedListItem: element => { windowed.push(element); return { dispose() {}, refresh() {} } },
    WINDOWED_LIST_OVERSCAN_PX: 0,
    usePlaylistDrag: () => ({
      dragVideo() {}, moveDraggedVideo() {}, afterDrag() {}, pointerDragging: Vue.ref(false), startPointerDrag() {}, moveWithKeyboard() {},
    }),
    FtListVideo: videoStub(mounted),
    FtListChannel: {},
    FtListPlaylist: {},
    FtCommunityPost: {},
    FtListHashtag: {},
  })
  // The previous list released its observer when it unmounted.
  const previousObservers = observers.length
  const app = mountList(Wrapper, index => ({ data: { type: 'video', videoId: `video-${index}` }, appearance: 'result', firstScreen: false }))

  assert.equal(observers.length, previousObservers + 1)
  const observer = observers.at(-1)
  assert.equal(observer.observed.size, 500)
  const rows = [...observer.observed]
  observer.callback([{ target: rows[7], isIntersecting: true }])
  await Vue.nextTick()
  assert.deepEqual(mounted, ['video-7'])
  assert.equal(windowed.length, 1, 'the windowing observer takes over once the card is visible')
  assert.equal(Vue.toRaw(windowed[0]), rows[7])
  assert.equal(observer.observed.size, 499)

  app.unmount()
  assert.equal(observer.observed.size, 0)
})
