import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { getProfileWithUpdatedSubscriptionDetails } from '../../src/renderer/helpers/subscription-profile-details.js'

const source = await readFile(new URL('../../src/renderer/views/SearchPage/SearchPage.vue', import.meta.url), 'utf8')
const start = source.indexOf('function updateSubscriptionDetails(')
const createUpdater = compileFunction(`${source.slice(start, source.indexOf('</script>', start))}\nreturn updateSubscriptionDetails`, ['store'])

const game = { type: 'channel', dataSource: 'local', isGame: true, id: 'game-category', name: 'Example Game', thumbnail: 'https://example.com/game.png' }
const channel = { type: 'channel', dataSource: 'local', id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Localized Channel', thumbnail: 'https://example.com/channel.png' }

function refreshSubscriptions(results, preference) {
  let profile = { subscriptions: results.map(result => ({ id: result.id, name: 'Saved Name', thumbnail: '' })) }
  const store = {
    getters: {
      getAvoidTranslation: preference,
      getSubscribedChannelIdSet: new Set(profile.subscriptions.map(subscription => subscription.id))
    },
    dispatch(action, payload) {
      const updates = action === 'batchUpdateSubscriptionDetails' ? payload : [payload]
      profile = getProfileWithUpdatedSubscriptionDetails(profile, updates) ?? profile
    }
  }
  createUpdater(store)(results)
  return profile.subscriptions
}

for (const preference of ['entire_app', 'disabled', 'watch_only']) {
  test(`refreshes saved game names with untranslated text ${preference}`, () => {
    const [subscription] = refreshSubscriptions([game], preference)
    assert.equal(subscription.name, 'Example Game')
    assert.equal(subscription.thumbnail, game.thumbnail)
  })
}

test('preserves ordinary channel names while their original-name lookup is pending', () => {
  const [subscription] = refreshSubscriptions([channel], 'entire_app')
  assert.equal(subscription.name, 'Saved Name')
  assert.equal(subscription.thumbnail, channel.thumbnail)
})

test('refreshes game names and preserves ordinary names in a mixed search batch', () => {
  const subscriptions = refreshSubscriptions([game, channel], 'entire_app')
  assert.deepEqual(subscriptions.map(({ name }) => name), ['Example Game', 'Saved Name'])
})

test('refreshes channel names from results without avatars', () => {
  // Yattee servers can return channels without avatars
  const result = { type: 'channel', id: 'UCbbbbbbbbbbbbbbbbbbbbbb', authorId: 'UCbbbbbbbbbbbbbbbbbbbbbb', author: 'Yattee Channel', authorThumbnails: [] }
  const [subscription] = refreshSubscriptions([result], 'disabled')
  assert.equal(subscription.name, 'Yattee Channel')
  assert.equal(subscription.thumbnail, '')
})
