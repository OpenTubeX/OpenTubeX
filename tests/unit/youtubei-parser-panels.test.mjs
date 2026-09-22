import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser, YTNodes } from 'youtubei.js'

// These shapes reproduce the missing nodes and rejected children in the console log.
test('retains video title headers and shelves in structured descriptions', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const panel = Parser.parseItem({
    engagementPanelSectionListRenderer: {
      content: {
        structuredDescriptionContentRenderer: {
          items: [
            { videoTitleHeaderViewModel: { videoTitle: { content: 'Video title' } } },
            { shelfRenderer: { title: { simpleText: 'Related videos' } } }
          ]
        }
      }
    }
  })
  assert.equal(warn.mock.callCount(), 0)
  assert.equal(panel.content.items.length, 2)
  assert.ok(panel.content.items[0] instanceof YTNodes.VideoTitleHeaderView)
  assert.ok(panel.content.items[1] instanceof YTNodes.Shelf)
})

test('parses loading panel content without runtime parser generation or type mismatches', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const panel = Parser.parseItem({
    engagementPanelSectionListRenderer: {
      content: { contentLoadingRenderer: { useSpinner: true } }
    }
  })
  assert.equal(warn.mock.callCount(), 0)
  assert.ok(panel.content instanceof YTNodes.ContentLoading)
  assert.equal(panel.content.use_spinner, true)
})

test('ignores unused player interstitials without runtime parser generation', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const node = Parser.parseItem({
    playerInterstitialRenderer: {
      content: {
        interstitialViewModel: {
          title: { content: 'Before you continue' },
          description: { content: 'Please confirm' },
          primaryButton: { buttonViewModel: { title: 'Continue' } },
          loggingDirectives: { trackingParams: 'fixture', visibility: { types: '1' } }
        }
      }
    }
  })
  assert.equal(warn.mock.callCount(), 0)
  assert.equal(node, null)
})

test('retains comment filter context in a reloaded comment response without runtime generation', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const response = Parser.parseResponse({
    onResponseReceivedEndpoints: [{
      reloadContinuationItemsCommand: {
        targetId: 'comments-section',
        continuationItems: [{
          commentFilterContextViewModel: { text: { content: 'Top comments' } }
        }]
      }
    }]
  })
  assert.equal(warn.mock.callCount(), 0)
  const command = response.on_response_received_endpoints[0]
  assert.equal(command.target_id, 'comments-section')
  assert.equal(command.contents.length, 1)
  const node = command.contents[0]
  assert.ok(node instanceof YTNodes.CommentFilterContextView)
  assert.equal(node.text.toString(), 'Top comments')
})

test('parses timely shopping shelves without runtime parser generation', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const shelf = Parser.parseItem({
    shoppingTimelyShelfViewModel: {
      offerIdToVariants: [{
        key: 'offer-id',
        value: {
          shelf: {
            shoppingTimelyShelfContentViewModel: {
              image: {
                image: {
                  sources: [{ url: 'https://example.com/product.jpg', width: 83, height: 128 }],
                  contentMode: 'CONTENT_MODE_SCALE_ASPECT_FIT'
                },
                height: 36,
                width: 36,
                backgroundColor: 4294967295,
                cornerRadius: 4
              },
              line1: {
                shoppingContentLineViewModel: {
                  items: [{
                    shoppingContentLineItemViewModel: {
                      text: {
                        attributedString: { content: 'Product title' },
                        fontAttributes: {
                          fontRole: 'SHOPPING_FONT_ROLE_BODY',
                          fontSize: 'SHOPPING_FONT_SIZE_M'
                        }
                      },
                      canShrink: true
                    }
                  }],
                  lineHeight: 18,
                  itemGap: 6
                }
              },
              button: [{ buttonViewModel: { title: 'View' } }],
              padding: {
                start: { value: 8, unit: 'SHOPPING_DIMENSION_UNIT_POINT' }
              },
              backgroundColor: 218103808,
              rendererContext: {}
            }
          }
        }
      }],
      cueRanges: [{
        id: 'cue-id',
        startTime: { seconds: '10' },
        endTime: { seconds: '20', nanos: 500000000 },
        onEnter: {
          clickTrackingParams: 'tracking-params',
          shoppingTimelyShelfUpdateCommand: {}
        }
      }]
    }
  })

  assert.equal(warn.mock.callCount(), 0)
  assert.ok(shelf instanceof YTNodes.ShoppingTimelyShelfView)
  const content = shelf.offer_id_to_variants[0].value.shelf
  assert.ok(content instanceof YTNodes.ShoppingTimelyShelfContentView)
  assert.ok(content.line_1 instanceof YTNodes.ShoppingContentLineView)
  assert.ok(content.line_1.items[0] instanceof YTNodes.ShoppingContentLineItemView)
  assert.equal(content.line_1.items[0].text.toString(), 'Product title')
  assert.ok(content.buttons[0] instanceof YTNodes.ButtonView)
  assert.equal(shelf.cue_ranges[0].start_time.seconds, '10')
  assert.equal(shelf.cue_ranges[0].end_time.nanos, 500000000)
  assert.ok(shelf.cue_ranges[0].on_enter.shopping_timely_shelf_update_command instanceof YTNodes.NavigationEndpoint)
})

test('parses recognition shelves without avatars', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const shelf = Parser.parseItem({
    recognitionShelfRenderer: {
      title: { simpleText: 'Supporters' },
      subtitle: { simpleText: 'Thank you' },
      surface: 'LIVE_CHAT'
    }
  })

  assert.equal(warn.mock.callCount(), 0)
  assert.ok(shelf instanceof YTNodes.RecognitionShelf)
  assert.deepEqual(shelf.avatars, [])
})
