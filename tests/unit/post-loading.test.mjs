import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/views/Post.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0]
  .replace(/^import .*\n/gm, '')

function mountPost(t, backend, fallback = true) {
  const route = reactive({ params: { id: 'post-a' }, query: { authorId: 'author-a' } })
  const requests = { local: [], invidious: [] }
  const titles = []
  const errors = []
  const toasts = []
  const replacements = []
  const scope = effectScope()
  const request = api => (id, authorId) => {
    const pending = { ...Promise.withResolvers(), id, authorId }
    requests[api].push(pending)
    return pending.promise
  }
  const state = scope.run(() => vm.runInNewContext(`${source}; ({ post, authorId, isLoading, unsupported })`, {
    computed, ref, shallowRef, watch,
    useRoute: () => route,
    useRouter: () => ({ replace: value => replacements.push(value) }),
    useI18n: () => ({ t: value => value }),
    useTabTitle: () => title => titles.push(title),
    store: { getters: {
      getBackendPreference: backend, getBackendFallback: fallback,
      getHideComments: true, getSubscriptionCacheReady: false
    } },
    usesInvidiousApi: value => value !== 'local',
    getLocalCommunityPost: request('local'),
    getInvidiousCommunityPost: request('invidious'),
    YatteeUnsupportedError: class extends Error {},
    getInvidiousApiErrorMessage: value => value,
    showApiErrorToast: (...args) => errors.push(args),
    showToast: value => toasts.push(value),
    showInvidiousFallbackToast: value => toasts.push(value),
    console: { error() {} },
    process: { env: { SUPPORTS_LOCAL_API: true } }
  }))
  t.after(() => scope.stop())
  return {
    ...state, requests, titles, errors, toasts, replacements,
    async navigate() {
      route.params.id = 'post-b'
      route.query.authorId = 'author-b'
      await nextTick()
    }
  }
}

const postA = { postId: 'post-a', author: 'Author A', authorId: 'author-a' }
const postB = { postId: 'post-b', author: 'Author B', authorId: 'author-b' }
const settle = () => new Promise(resolve => setImmediate(resolve))

for (const backend of ['local', 'invidious']) {
  const other = backend === 'local' ? 'invidious' : 'local'

  test(`${backend}: an older post response cannot replace the current post or title`, async t => {
    const view = mountPost(t, backend)
    const old = view.requests[backend][0]
    await view.navigate()
    view.requests[backend][1].resolve(postB)
    await settle()
    old.resolve(postA)
    await settle()
    assert.equal(view.post.value.postId, 'post-b')
    assert.equal(view.authorId.value, 'author-b')
    assert.deepEqual(view.titles, ['Community Post | Author B'])
    assert.equal(view.replacements.length, 0)
  })

  test(`${backend}: an older response cannot complete a newer post's loading state`, async t => {
    const view = mountPost(t, backend)
    const old = view.requests[backend][0]
    await view.navigate()
    old.resolve(postA)
    await settle()
    assert.equal(view.post.value, null)
    assert.equal(view.isLoading.value, true)
    assert.deepEqual(view.titles, [])
    assert.equal(view.replacements.length, 0)
    view.requests[backend][1].resolve(postB)
    await settle()
    assert.equal(view.post.value.postId, 'post-b')
  })

  test(`${backend}: an older error cannot show a toast or start a fallback for the new post`, async t => {
    const view = mountPost(t, backend)
    const old = view.requests[backend][0]
    await view.navigate()
    old.reject(new Error('Old post failed'))
    await settle()
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.toasts, [])
    assert.equal(view.requests[other].length, 0)
    assert.equal(view.isLoading.value, true)
    view.requests[backend][1].resolve(postB)
    await settle()
  })

  test(`${backend}: fallback responses keep the original post's generation`, async t => {
    const view = mountPost(t, backend)
    view.requests[backend][0].reject(new Error('Try the other backend'))
    await settle()
    assert.equal(view.requests[other].length, 1)
    assert.equal(view.requests[other][0].id, 'post-a')
    await view.navigate()
    view.requests[backend][1].resolve(postB)
    await settle()
    view.requests[other][0].resolve(postA)
    await settle()
    assert.equal(view.post.value.postId, 'post-b')
    assert.deepEqual(view.titles, ['Community Post | Author B'])
    assert.equal(view.replacements.length, 0)
  })

  test(`${backend}: the current post can still load through the fallback backend`, async t => {
    const view = mountPost(t, backend)
    view.requests[backend][0].reject(new Error('Try the other backend'))
    await settle()
    assert.equal(view.requests[other].length, 1)
    assert.equal(view.isLoading.value, true)
    view.requests[other][0].resolve(postA)
    await settle()
    assert.equal(view.post.value.postId, 'post-a')
    assert.equal(view.isLoading.value, false)
    assert.deepEqual(view.titles, ['Community Post | Author A'])
  })
}
