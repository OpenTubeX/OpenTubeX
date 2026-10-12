import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { YTNodes } from 'youtubei.js'

const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('export function extractLocalContentDisclosures(')
const end = source.indexOf('\n/**', start)
const extract = compileFunction(`${source.slice(start, end).replace('export ', '')}\nreturn extractLocalContentDisclosures`, ['YTNodes'])(YTNodes)

function videoInfo(items) {
  return { page: [{}, { engagement_panels: [{
    target_id: 'engagement-panel-structured-description',
    content: new YTNodes.StructuredDescriptionContent({ items })
  }] }] }
}

test('extracts disclosure text and attribution using the installed YouTube parser', () => {
  assert.deepEqual(extract(videoInfo([{ howThisWasMadeSectionView: {
    bodyHeader: { content: 'Altered or synthetic content' },
    bodyText: { content: 'Sound or visuals were significantly edited. Learn more.' },
    attributionText: { content: 'Disclosure added by the creator' }
  } }])), [{
    label: 'Altered or synthetic content',
    description: 'Sound or visuals were significantly edited.',
    attribution: 'Disclosure added by the creator'
  }])
})

test('handles absent panels, empty sections, and missing optional text', () => {
  for (const info of [undefined, {}, { page: [] }, videoInfo([])]) {
    assert.equal(extract(info), null)
  }
  assert.deepEqual(extract(videoInfo([{ howThisWasMadeSectionView: {} }])), [{
    label: '', description: '', attribution: ''
  }])
})
