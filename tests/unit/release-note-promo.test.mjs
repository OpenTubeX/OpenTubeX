import assert from 'node:assert/strict'
import test from 'node:test'

import { materialSymbolMotifDataUrl, renderPromoHtml } from '../../_scripts/releaseNotePromo.mjs'

const options = {
  accent: '#8b7cff',
  description: 'A real <app> screenshot.',
  fontDataUrl: 'data:font/ttf;base64,font',
  iconDataUrl: 'data:image/svg+xml;base64,icon',
  motifDataUrl: 'data:image/svg+xml;base64,motif',
  screenshotDataUrl: 'data:image/png;base64,screenshot',
  title: 'Release & notes',
}

test('renders deterministic promotional artwork with escaped copy', () => {
  const first = renderPromoHtml(options)
  const second = renderPromoHtml(options)

  assert.equal(first, second)
  assert.match(first, /Release &amp; notes/)
  assert.match(first, /A real &lt;app&gt; screenshot\./)
  assert.match(first, /data:image\/png;base64,screenshot/)
  assert.match(first, /data:image\/svg\+xml;base64,motif/)
  assert.match(first, /--accent: #8b7cff/)
})

test('renders a deterministic feature motif from a Material Symbol', () => {
  const first = materialSymbolMotifDataUrl('devices-rounded', '#8b7cff')
  const second = materialSymbolMotifDataUrl('devices-rounded', '#8b7cff')

  assert.equal(first, second)
  assert.match(first, /^data:image\/svg\+xml;base64,/)
})
