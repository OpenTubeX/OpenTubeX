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

test('parses player interstitials and their text and button without runtime generation', (t) => {
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
  assert.ok(node instanceof YTNodes.PlayerInterstitial)
  assert.ok(node.content instanceof YTNodes.InterstitialView)
  assert.equal(node.content.title.toString(), 'Before you continue')
  assert.equal(node.content.description.toString(), 'Please confirm')
  assert.ok(node.content.primary_button instanceof YTNodes.ButtonView)
  assert.equal(node.content.primary_button.title, 'Continue')
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
