import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commentActionParams,
  createCommentParams,
  createReplyParams,
  isCommentActionSuccessful,
  parseAccountProfiles,
  parseCreatedComment,
  parseHomeFeed,
  parseOwnedPlaylistIds,
  parsePlaylistLibrary,
  parsePlaylistPage,
  parseSubscribedChannels,
  parseVideoRating,
  parseWatchHistoryUrl,
  updateCommentParams
} from '../../src/renderer/helpers/api/youtube-account-parsers.js'
import { applyYouTubeUserAgent, YOUTUBE_USER_AGENTS } from '../../src/youTubeUserAgent.js'

const decodeParams = params => [...Buffer.from(decodeURIComponent(params), 'base64')]
const bytes = text => [...Buffer.from(text)]

// The TV app encodes the channel of a Subscriptions tab as {49: {1: channelId}}.
const channelTabParams = channelId => encodeURIComponent(
  Buffer.from([0x8a, 0x03, channelId.length + 2, 0x0a, channelId.length, ...bytes(channelId)]).toString('base64')
)
const channelTab = (title, channelId) => ({
  tabRenderer: {
    title,
    endpoint: { browseEndpoint: { browseId: 'FEsubscriptions', params: channelTabParams(channelId) } },
    thumbnail: {
      thumbnails: [
        { url: `//yt3.example.com/${channelId}=s48`, width: 48, height: 48 },
        { url: `//yt3.example.com/${channelId}=s176`, width: 176, height: 176 }
      ]
    }
  }
})

const tile = ({ videoId, title, lines = [], duration, style = 'DEFAULT', contentType = 'TILE_CONTENT_TYPE_VIDEO' }) => ({
  tileRenderer: {
    contentId: videoId,
    contentType,
    header: {
      tileHeaderRenderer: {
        thumbnailOverlays: duration === undefined
          ? []
          : [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: duration }, style } }]
      }
    },
    metadata: {
      tileMetadataRenderer: {
        title: { simpleText: title },
        lines: lines.map(items => ({ lineRenderer: { items: items.map(item => ({ lineItemRenderer: item })) } }))
      }
    },
    onSelectCommand: { watchEndpoint: { videoId } }
  }
})
const shelf = (...items) => ({ shelfRenderer: { content: { horizontalListRenderer: { items } } } })

test('lists the Google account channel first, then its brand accounts', () => {
  const accountItem = ({ name, handle, pageId, selected = false, disabled = false }) => ({
    accountItem: {
      accountName: { simpleText: name },
      channelHandle: { simpleText: handle },
      accountPhoto: { thumbnails: [{ url: `https://yt3.example.com/${handle}=s88`, width: 88 }, { url: `https://yt3.example.com/${handle}=s216`, width: 216 }] },
      isSelected: selected,
      isDisabled: disabled,
      serviceEndpoint: {
        selectActiveIdentityEndpoint: {
          supportedTokens: [
            { accountStateToken: { hasChannel: true } },
            ...(pageId ? [{ pageIdToken: { pageId } }] : [])
          ]
        }
      }
    }
  })
  const response = selectedPageId => ({
    contents: [{
      accountSectionListRenderer: {
        contents: [{
          accountItemSectionRenderer: {
            contents: [
              accountItem({ name: 'Brand Channel', handle: '@brandchannel', pageId: '111', selected: selectedPageId === '111' }),
              accountItem({ name: 'Disabled Channel', handle: '@disabledchannel', pageId: '222', disabled: true }),
              accountItem({ name: 'Example Viewer', handle: '@exampleviewer', pageId: null, selected: selectedPageId === null })
            ]
          }
        }]
      }
    }]
  })

  assert.deepEqual(parseAccountProfiles(response(null)), {
    profiles: [
      { name: 'Example Viewer', handle: '@exampleviewer', thumbnail: 'https://yt3.example.com/@exampleviewer=s216', pageId: null },
      { name: 'Brand Channel', handle: '@brandchannel', thumbnail: 'https://yt3.example.com/@brandchannel=s216', pageId: '111' }
    ],
    selectedPageId: null
  })
  assert.equal(parseAccountProfiles(response('111')).selectedPageId, '111')
})

test('lists each subscribed channel once from the TV Subscriptions tabs', () => {
  const channels = parseSubscribedChannels({
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSecondaryNavRenderer: {
            sections: [{
              tvSecondaryNavSectionRenderer: {
                tabs: [
                  { tabRenderer: { title: 'All', endpoint: { browseEndpoint: { browseId: 'FEsubscriptions' } } } },
                  channelTab('Second Channel', 'UCbbbbbbbbbbbbbbbbbbbbbb'),
                  channelTab('First Channel', 'UCaaaaaaaaaaaaaaaaaa-_aa'),
                  { tabRenderer: { title: 'A-Z' } },
                  channelTab('First Channel', 'UCaaaaaaaaaaaaaaaaaa-_aa'),
                  channelTab('Second Channel', 'UCbbbbbbbbbbbbbbbbbbbbbb')
                ]
              }
            }]
          }
        }
      }
    }
  })

  assert.deepEqual(channels, [
    { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Second Channel', thumbnail: 'https://yt3.example.com/UCbbbbbbbbbbbbbbbbbbbbbb=s176' },
    { id: 'UCaaaaaaaaaaaaaaaaaa-_aa', name: 'First Channel', thumbnail: 'https://yt3.example.com/UCaaaaaaaaaaaaaaaaaa-_aa=s176' }
  ])
  // Sync would unsubscribe from everything if an unreadable page counted as empty.
  assert.throws(() => parseSubscribedChannels({ contents: {} }))
  // Or from the channels on later pages if it read only the first.
  assert.throws(() => parseSubscribedChannels({
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSecondaryNavRenderer: {
            sections: [{
              tvSecondaryNavSectionRenderer: {
                tabs: [channelTab('First Channel', 'UCaaaaaaaaaaaaaaaaaa-_aa')],
                continuations: [{ nextContinuationData: { continuation: 'next' } }]
              }
            }]
          }
        }
      }
    }
  }))
})

const playlistTile = (playlistId, title, count, thumbnail) => ({
  tileRenderer: {
    contentId: playlistId,
    contentType: 'TILE_CONTENT_TYPE_PLAYLIST',
    header: {
      tileHeaderRenderer: {
        thumbnail: { thumbnails: [{ url: `${thumbnail}?sqp=signed`, width: 480 }] },
        thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { runs: count } } }]
      }
    },
    metadata: { tileMetadataRenderer: { title: { simpleText: title } } }
  }
})

test('reads the account playlists and their changes from the TV playlist list', () => {
  const firstPage = parsePlaylistLibrary({
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: {
              gridRenderer: {
                items: [
                  playlistTile('WL', 'Watch later', [{ text: 'No videos' }], 'https://i.example.com/none.jpg'),
                  playlistTile('PLexample', 'Example', [{ text: '1,234', bold: true }, { text: ' videos' }], 'https://i.example.com/first.jpg')
                ],
                continuations: [{ nextContinuationData: { continuation: 'next' } }]
              }
            }
          }
        }
      }
    }
  })
  assert.deepEqual(firstPage, {
    playlists: [
      { playlistId: 'WL', title: 'Watch later', videoCount: 0, signature: 'No videos\nhttps://i.example.com/none.jpg' },
      { playlistId: 'PLexample', title: 'Example', videoCount: 1234, signature: '1,234 videos\nhttps://i.example.com/first.jpg' }
    ],
    continuation: 'next'
  })

  const nextPage = parsePlaylistLibrary({
    continuationContents: {
      tvSurfaceContentContinuation: { content: { gridRenderer: { items: [playlistTile('LL', 'Liked videos', [{ text: '3 videos' }], 'https://i.example.com/liked.jpg')] } } }
    }
  })
  assert.deepEqual(nextPage.playlists.map(playlist => playlist.playlistId), ['LL'])
  assert.equal(nextPage.continuation, null)
  // Sync would remove every playlist if an unreadable list counted as empty.
  assert.throws(() => parsePlaylistLibrary({ contents: {} }))
})

test('only playlists in the TV add to playlist dialog belong to the account', () => {
  const option = playlistId => ({ playlistAddToOptionRenderer: { playlistId } })
  assert.deepEqual(parseOwnedPlaylistIds({ contents: [{ addToPlaylistRenderer: { playlists: [option('WL'), option('PLown')] } }] }), new Set(['WL', 'PLown']))
  assert.throws(() => parseOwnedPlaylistIds({ contents: [] }))
  // Watch later is always there, so an empty dialog is a page sync cannot read.
  assert.throws(() => parseOwnedPlaylistIds({ contents: [{ addToPlaylistRenderer: { playlists: [] } }] }))
})

test('reads playlist entries with the IDs that edits need from TV playlist pages', () => {
  const entry = (videoId, setVideoId) => {
    const { tileRenderer } = tile({
      videoId,
      title: `Video ${videoId}`,
      lines: [
        [{ text: { runs: [{ text: 'Example Channel', navigationEndpoint: { browseEndpoint: { browseId: 'UCcccccccccccccccccccccc' } } }] } }],
        [{ text: { simpleText: '12 views' } }]
      ],
      duration: '1:05'
    })
    tileRenderer.onLongPressCommand = {
      showMenuCommand: {
        menu: {
          menuRenderer: {
            items: [
              { menuServiceItemRenderer: { serviceEndpoint: { playlistEditEndpoint: { actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] } } } },
              { menuServiceItemRenderer: { serviceEndpoint: { playlistEditEndpoint: { actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId }] } } } }
            ]
          }
        }
      }
    }
    return { tileRenderer }
  }

  const firstPage = parsePlaylistPage({
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: {
              twoColumnRenderer: {
                leftColumn: { entityMetadataRenderer: { title: { simpleText: 'Example ' } } },
                rightColumn: {
                  playlistVideoListRenderer: {
                    contents: [entry('video000001', 'SET1')],
                    continuations: [{ nextContinuationData: { continuation: 'more' } }]
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  assert.equal(firstPage.title, 'Example')
  assert.equal(firstPage.continuation, 'more')
  assert.deepEqual(firstPage.videos, [{
    videoId: 'video000001',
    setVideoId: 'SET1',
    title: 'Video video000001',
    author: 'Example Channel',
    authorId: 'UCcccccccccccccccccccccc',
    lengthSeconds: 65,
    published: null,
    viewCount: 12
  }])

  const nextPage = parsePlaylistPage({ continuationContents: { playlistVideoListContinuation: { contents: [entry('video000002', 'SET2')] } } })
  assert.deepEqual(nextPage.videos.map(video => video.setVideoId), ['SET2'])
  assert.equal(nextPage.title, null)

  // An empty playlist has no list at all, which is different from an unreadable page.
  const empty = parsePlaylistPage({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { twoColumnRenderer: { leftColumn: {} } } } } } } })
  assert.deepEqual(empty.videos, [])
  assert.throws(() => parsePlaylistPage({ contents: {} }))
})

test('reads videos and the next page from TV Home shelves', () => {
  const firstPage = parseHomeFeed({
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  shelf(
                    tile({
                      videoId: 'video000001',
                      title: 'Example video',
                      duration: '1:02:03',
                      lines: [
                        [{ text: { runs: [{ text: 'Example Channel' }] } }],
                        [
                          { badge: { metadataBadgeRenderer: { label: '4K' } } },
                          { text: { simpleText: '1.5K views' } },
                          { text: { simpleText: '•' } },
                          { text: { simpleText: '3 days ago' } }
                        ]
                      ]
                    }),
                    tile({ videoId: 'video000002', title: 'Live video', duration: 'LIVE', style: 'LIVE', lines: [[{ text: { simpleText: 'Live Channel' } }], [{ text: { simpleText: '20 watching' } }]] }),
                    { adSlotRenderer: {} },
                    tile({ videoId: 'playlist001', title: 'Not a video', contentType: 'TILE_CONTENT_TYPE_PLAYLIST' })
                  ),
                  { feedNudgeRenderer: {} },
                  shelf(tile({ videoId: 'short000001', title: 'Example short', contentType: 'TILE_CONTENT_TYPE_SHORTS' }))
                ],
                continuations: [{ nextContinuationData: { continuation: 'next-page' } }]
              }
            }
          }
        }
      }
    }
  })

  assert.equal(firstPage.continuation, 'next-page')
  assert.deepEqual(firstPage.videos.map(video => video.videoId), ['video000001', 'video000002', 'short000001'])

  const [video, live, short] = firstPage.videos
  assert.equal(video.title, 'Example video')
  assert.equal(video.author, 'Example Channel')
  assert.equal(video.viewCount, 1500)
  assert.equal(video.lengthSeconds, 3723)
  assert.equal(video.is4k, true)
  assert.ok(Math.abs(video.published - (Date.now() - 3 * 86400000)) < 60000)
  assert.equal(live.liveNow, true)
  assert.equal(live.lengthSeconds, '')
  assert.equal(live.viewCount, 20)
  assert.equal(short.isShort, true)

  const nextPage = parseHomeFeed({
    continuationContents: {
      sectionListContinuation: {
        contents: [shelf(tile({ videoId: 'video000003', title: 'Next page video' }))]
      }
    }
  })
  assert.deepEqual(nextPage.videos.map(video => video.videoId), ['video000003'])
  assert.equal(nextPage.continuation, null)
})

test('reads the account rating of a video from the TV watch page', () => {
  const button = likeStatus => ({ button: { likeButtonRenderer: { likeStatus } } })
  const toggle = { button: { toggleButtonRenderer: { isToggled: false } } }

  assert.equal(parseVideoRating({ transportControls: { transportControlsRenderer: { buttons: [toggle, button('DISLIKE')] } } }), 'DISLIKE')
  assert.equal(parseVideoRating({
    frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: {} }, { payload: { likeStatusEntity: { likeStatus: 'LIKE' } } }] } }
  }), 'LIKE')
  assert.equal(parseVideoRating({}), null)
})

test('encodes comment parameters in the layouts YouTube accepts', () => {
  const videoId = 'abcdefghijk'
  assert.deepEqual(decodeParams(createCommentParams(videoId)), [0x12, 11, ...bytes(videoId), 0x2a, 0x00, 0x50, 0x07])
  assert.deepEqual(decodeParams(createReplyParams(videoId, 'Ugparent')), [
    0x12, 11, ...bytes(videoId), 0x22, 8, ...bytes('Ugparent'), 0x2a, 0x02, 0x08, 0x00, 0x50, 0x07
  ])

  const action = (type, undo = []) => [0x08, type, 0x10, 0x02, 0x1a, 16, ...bytes('Ugparent.Ugreply'), 0x2a, 11, ...bytes(videoId), ...undo]
  assert.deepEqual(decodeParams(commentActionParams('like', 'Ugparent.Ugreply', videoId)), action(5))
  assert.deepEqual(decodeParams(commentActionParams('unlike', 'Ugparent.Ugreply', videoId)), action(5, [0x38, 0x01]))
  assert.deepEqual(decodeParams(commentActionParams('dislike', 'Ugparent.Ugreply', videoId)), action(4))
  assert.deepEqual(decodeParams(commentActionParams('undislike', 'Ugparent.Ugreply', videoId)), action(4, [0x38, 0x01]))
  assert.deepEqual(decodeParams(commentActionParams('delete', 'Ugparent.Ugreply', videoId)), action(6))

  // Replies take the same layout with their full ID.
  assert.deepEqual(decodeParams(updateCommentParams(videoId, 'Ugparent.Ugreply')), [
    0x0a, 16, ...bytes('Ugparent.Ugreply'), 0x22, 11, ...bytes(videoId), 0x2a, 0x02, 0x08, 0x00, 0x40, 0x0c, 0x92, 0x01, 0x00
  ])
})

test('reads posted comments and refusals from comment write responses', () => {
  const posted = parseCreatedComment({
    actionResult: { status: 'STATUS_SUCCEEDED' },
    actions: [
      { changeEngagementPanelVisibilityAction: {} },
      {
        listMutationCommand: {
          operations: {
            operations: [{
              insertItemSectionContent: {
                contents: [{
                  commentThreadRenderer: {
                    comment: {
                      commentRenderer: {
                        commentId: 'Ugnewcomment',
                        authorText: { simpleText: '@exampleviewer' },
                        authorThumbnail: { thumbnails: [{ url: 'https://yt3.example.com/avatar=s88', width: 88 }] },
                        contentText: { runs: [{ text: 'Example comment' }] }
                      }
                    }
                  }
                }]
              }
            }]
          }
        }
      }
    ]
  })
  assert.deepEqual(posted, {
    id: 'Ugnewcomment',
    author: '@exampleviewer',
    authorThumb: 'https://yt3.example.com/avatar=s88',
    text: 'Example comment'
  })

  assert.throws(() => parseCreatedComment({
    actionResult: { status: 'STATUS_FAILED', feedbackText: { runs: [{ text: 'Comments are limited' }] } }
  }), { message: 'Comments are limited' })

  assert.equal(isCommentActionSuccessful({ actionResults: [{ status: 'STATUS_SUCCEEDED' }] }, 'like', 'Ugcomment'), true)
  assert.equal(isCommentActionSuccessful({
    actions: [{ removeCommentAction: { commentId: 'Ugother', actionResult: { status: 'STATUS_SUCCEEDED' } } }]
  }, 'delete', 'Ugcomment'), false)
})

test('only uses the watch history URL of a playable TV player response', () => {
  const tracking = { videostatsPlaybackUrl: { baseUrl: 'https://s.youtube.com/api/stats/playback?docid=video000001' } }
  assert.equal(parseWatchHistoryUrl({ playabilityStatus: { status: 'OK' }, playbackTracking: tracking }), tracking.videostatsPlaybackUrl.baseUrl)
  assert.equal(parseWatchHistoryUrl({ playabilityStatus: { status: 'UNPLAYABLE' }, playbackTracking: tracking }), null)
})

test('only YouTube requests get the TV user agent, and the marker never leaves the app', () => {
  const youTubeHeaders = { 'OpenTubeX-YouTube-User-Agent': 'tizen', 'User-Agent': 'Electron' }
  assert.deepEqual(applyYouTubeUserAgent('https://www.youtube.com/youtubei/v1/player', youTubeHeaders), {
    'User-Agent': YOUTUBE_USER_AGENTS.tizen
  })

  for (const [url, client] of [['https://tracker.example/youtube.com/', 'tv'], ['https://www.youtube.com/tv', 'unknown']]) {
    assert.deepEqual(applyYouTubeUserAgent(url, { 'opentubex-youtube-user-agent': client, 'User-Agent': 'Electron' }), {
      'User-Agent': 'Electron'
    })
  }
})
