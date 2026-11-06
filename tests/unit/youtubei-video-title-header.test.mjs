import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser, YTNodes } from 'youtubei.js'

test('parses video title header view models without generating a runtime parser', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})

  const header = Parser.parseItem({
    videoTitleHeaderViewModel: {
      videoTitle: { content: 'Fixture title' },
      headerButton: {
        buttonViewModel: { title: 'Open' }
      },
      rendererContext: {}
    }
  })

  assert.equal(warn.mock.callCount(), 0)
  assert.ok(header instanceof YTNodes.VideoTitleHeaderView)
  assert.equal(header.video_title.toString(), 'Fixture title')
  assert.ok(header.header_button instanceof YTNodes.ButtonView)
  assert.equal(header.header_button.title, 'Open')
  assert.ok(header.renderer_context)
})
