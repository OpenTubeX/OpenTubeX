import assert from 'node:assert/strict'
import test from 'node:test'

import { getLocalVideoAvatarUrl } from '../../src/renderer/helpers/video-collaborators.js'

test('uses the primary collaborator avatar without reading the attachment-backed owner thumbnail', () => {
  const author = {
    endpoint: {
      payload: {
        panelLoadingStrategy: {
          inlineContent: {
            dialogViewModel: {
              customContent: {
                listViewModel: {
                  listItems: [{
                    listItemViewModel: {
                      title: {
                        content: 'Primary collaborator',
                        commandRuns: [{
                          onTap: {
                            innertubeCommand: {
                              browseEndpoint: { browseId: 'UCprimary' }
                            }
                          }
                        }]
                      },
                      leadingAccessory: {
                        avatarViewModel: {
                          image: {
                            sources: [{ url: 'https://images.test/primary-avatar.jpg' }]
                          }
                        }
                      }
                    }
                  }]
                }
              }
            }
          }
        }
      }
    },
    get best_thumbnail () {
      throw new Error('regular owner thumbnail should not be read')
    }
  }

  assert.equal(getLocalVideoAvatarUrl({
    secondary_info: { owner: { author } }
  }), 'https://images.test/primary-avatar.jpg')
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
