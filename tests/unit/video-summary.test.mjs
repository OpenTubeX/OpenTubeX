import assert from 'node:assert/strict'
import test from 'node:test'
import { Parser } from 'youtubei.js'
import { parseLocalVideoSummary } from '../../src/renderer/helpers/video-summary.js'

function videoInfo(results, secondaryResults = []) {
  return { page: [{}, Parser.parseResponse({
    contents: { twoColumnWatchNextResults: {
      results: { results: { contents: results } },
      secondaryResults: { secondaryResults: { results: secondaryResults } }
    } }
  })] }
}

function summary(paragraphs) {
  return { expandableMetadataRenderer: {
    expandedContent: { videoSummaryContentViewModel: {
      paragraphs: paragraphs.map(content => ({ videoSummaryParagraphViewModel: { text: { content } } }))
    } }
  } }
}

test('extracts YouTube summary paragraphs using the real parser', () => {
  assert.deepEqual(parseLocalVideoSummary(videoInfo([summary([' First paragraph. ', '', 'Second paragraph.'])])),
    ['First paragraph.', 'Second paragraph.'])
})

test('does not use summaries from recommended videos', () => {
  assert.deepEqual(parseLocalVideoSummary(videoInfo([], [summary(['Other video'])])), [])
})

test('handles missing summaries and missing watch responses', () => {
  assert.deepEqual(parseLocalVideoSummary({}), [])
  assert.deepEqual(parseLocalVideoSummary(videoInfo([])), [])
  assert.deepEqual(parseLocalVideoSummary(videoInfo([summary([' ', ''])])), [])
})

test('ignores non-watch response contents', () => {
  assert.deepEqual(parseLocalVideoSummary({ page: [{}, Parser.parseResponse({
    contents: { messageRenderer: { text: { simpleText: 'Unavailable' } } }
  })] }), [])
})

test('extracts the summary from the structured description panel used by _PEq2T_iAs4', () => {
  const parsed = Parser.parseResponse({
    engagementPanels: [{ engagementPanelSectionListRenderer: {
      panelIdentifier: 'engagement-panel-structured-description',
      content: { structuredDescriptionContentRenderer: {
        items: [summary(['Cas and Chary XR explores the technical capabilities of this modular, Linux-based headset.'])]
      } }
    } }]
  })
  assert.deepEqual(parseLocalVideoSummary({ page: [{}, parsed] }), [
    'Cas and Chary XR explores the technical capabilities of this modular, Linux-based headset.'
  ])
})
