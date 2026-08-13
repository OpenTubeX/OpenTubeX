import assert from 'node:assert/strict'
import test from 'node:test'

import { getLocalVideoAvatarUrl, parseLocalVideoCollaborators } from '../../src/renderer/helpers/video-collaborators.js'

test('uses the primary collaborator avatar without reading the attachment-backed owner thumbnail', () => {
  const author = {
    collaborators: [{
      title: { text: 'Primary collaborator' },
      renderer_context: {
        command_context: {
          on_tap: { payload: { browseId: 'UCprimary' } }
        }
      },
      leading_accessory: {
        image: [{ url: 'https://images.test/primary-avatar.jpg' }]
      }
    }],
    get best_thumbnail () {
      throw new Error('regular owner thumbnail should not be read')
    }
  }

  assert.equal(getLocalVideoAvatarUrl({
    secondary_info: { owner: { author } }
  }), 'https://images.test/primary-avatar.jpg')
})

test('uses native parsed dialog items when youtubei.js filters out collaborators', () => {
  const collaborators = [{
    title: {
      text: 'Primary collaborator',
      endpoint: { payload: { browseId: 'UCprimary' } }
    },
    subtitle: { text: '\u200e\u2068@primary\u2069 • \u206810 subscribers\u2069' },
    leading_accessory: {
      image: [{ url: 'https://images.test/primary-avatar.jpg' }]
    }
  }, {
    title: {
      text: 'Second collaborator',
      endpoint: { payload: { browseId: 'UCsecond' } }
    },
    subtitle: { text: '\u200e\u2068@second\u2069 • \u206820 subscribers\u2069' },
    leading_accessory: {
      image: [{ url: 'https://images.test/second-avatar.jpg' }]
    }
  }]

  assert.deepEqual(parseLocalVideoCollaborators({
    secondary_info: {
      owner: {
        author: {
          collaborators: [],
          endpoint: {
            command: {
              inline_content: {
                custom_content: { items: collaborators }
              }
            }
          }
        }
      }
    }
  }), [{
    id: 'UCprimary',
    name: 'Primary collaborator',
    thumbnail: 'https://images.test/primary-avatar.jpg',
    subtitle: '@primary • 10 subscribers'
  }, {
    id: 'UCsecond',
    name: 'Second collaborator',
    thumbnail: 'https://images.test/second-avatar.jpg',
    subtitle: '@second • 20 subscribers'
  }])
})

test('uses the regular owner avatar for non-collaboration videos', () => {
  assert.equal(getLocalVideoAvatarUrl({
    secondary_info: {
      owner: {
        author: {
          best_thumbnail: { url: 'https://images.test/owner-avatar.jpg' }
        }
      }
    }
  }), 'https://images.test/owner-avatar.jpg')
})

test('uses the regular owner avatar when the primary collaborator has no avatar', () => {
  assert.equal(getLocalVideoAvatarUrl({
    secondary_info: {
      owner: {
        author: {
          collaborators: [{
            title: { text: 'Primary collaborator' },
            renderer_context: {
              command_context: {
                on_tap: { payload: { browseId: 'UCprimary' } }
              }
            }
          }],
          best_thumbnail: { url: 'https://images.test/owner-avatar.jpg' }
        }
      }
    }
  }), 'https://images.test/owner-avatar.jpg')
})
