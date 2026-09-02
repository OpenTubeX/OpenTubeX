import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAndroidSubscriptionRefreshConfiguration,
  createSubscriptionRefreshStartController,
  createSubscriptionRefreshStartGuard,
} from '../../src/renderer/helpers/androidSubscriptionRefreshData.js'

test('a completed refresh cannot become active after its start await resumes', async () => {
  const guard = createSubscriptionRefreshStartGuard()
  let releaseStart
  const nativeStart = new Promise(resolve => { releaseStart = resolve })
  let inProgress

  const start = (async () => {
    const isCurrentStart = guard.begin()
    await nativeStart
    if (isCurrentStart()) inProgress = true
  })()

  guard.finish()
  inProgress = false
  releaseStart()
  await start

  assert.equal(inProgress, false)
})

test('a pending native refresh start keeps ownership until it finishes', async () => {
  const controller = createSubscriptionRefreshStartController()
  let nativeStarts = 0
  let releaseFirstStart
  const firstNativeStart = new Promise(resolve => { releaseFirstStart = resolve })

  const firstStart = controller.begin(() => {
    nativeStarts++
    return firstNativeStart
  })
  const overlappingStart = controller.begin(() => {
    nativeStarts++
    return Promise.resolve('second-token')
  })

  assert.equal(overlappingStart, null)
  assert.equal(nativeStarts, 1)
  assert.equal(controller.finish(), firstStart)

  releaseFirstStart('first-token')
  assert.equal(await firstStart, 'first-token')
  assert.equal(controller.current(), null)
})

test('creates one closed-app schedule input per profile and enabled feed', () => {
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [
      {
        _id: 'all',
        subscriptions: [
          { id: 'UC-video' },
          { id: 'UC-short', feedTypes: ['shorts'] },
          { id: 'UC-video' }
        ]
      },
      {
        _id: 'quiet',
        subscriptions: [{ id: 'UC-post', feedTypes: ['posts'] }]
      }
    ],
    intervals: {
      videos: '1800000',
      shorts: '3600000',
      live: '0',
      posts: '7200000'
    },
    hiddenFeedTypes: ['posts'],
    instanceUrl: 'https://example.invalid',
    authorization: 'Basic secret',
    titles: { videos: 'Videos', shorts: 'Shorts', live: 'Live', posts: 'Posts' },
    cancelLabel: 'Cancel refresh'
  })

  assert.deepEqual(configuration.intervals, {
    videos: 1800000,
    shorts: 3600000,
    live: 0,
    posts: 0
  })
  assert.deepEqual(configuration.profiles, [
    {
      id: 'all',
      channels: {
        videos: ['UC-video'],
        shorts: ['UC-video', 'UC-short'],
        live: ['UC-video'],
        posts: ['UC-video']
      }
    },
    {
      id: 'quiet',
      channels: {
        videos: [],
        shorts: [],
        live: [],
        posts: ['UC-post']
      }
    }
  ])
})

test('invalid and disabled intervals do not opt in to closed-app refreshes', () => {
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [],
    intervals: { videos: 'nope', shorts: -1, live: 0, posts: '' },
    hiddenFeedTypes: [],
    instanceUrl: '',
    authorization: null,
    titles: {},
    cancelLabel: 'Cancel'
  })

  assert.deepEqual(configuration.intervals, { videos: 0, shorts: 0, live: 0, posts: 0 })
})
