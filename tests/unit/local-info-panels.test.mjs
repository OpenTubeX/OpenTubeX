import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { Parser, YTNodes } from 'youtubei.js'

const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('// Topic panels start their first paragraph')
const end = source.indexOf('\n/**', source.indexOf('export function extractLocalInfoPanels('))
const extract = compileFunction(`${source.slice(start, end).replace('export ', '')}\nreturn extractLocalInfoPanels`, ['YTNodes'])(YTNodes)

const urlEndpoint = url => ({
  commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_UNKNOWN', rootVe: 83769 } },
  urlEndpoint: { url, target: 'TARGET_NEW_WINDOW' }
})

// Shapes returned by signed-out /next requests.
const topicPanel = {
  infoPanelContainerRenderer: {
    icon: { iconType: 'CLARIFY' },
    title: { runs: [{ text: 'Climate change' }] },
    content: {
      infoPanelContentRenderer: {
        sourceEndpoint: urlEndpoint('https://www.un.org/en/climatechange/what-is-climate-change'),
        truncateParagraphs: true,
        attributedParagraphs: [{
          content: 'United Nations • Climate change refers to long-term shifts in temperatures and weather patterns.',
          styleRuns: [{ startIndex: 0, length: 17, weightLabel: 'FONT_WEIGHT_MEDIUM' }]
        }]
      }
    },
    headerEndpoint: urlEndpoint('https://www.un.org/en/climatechange/what-is-climate-change')
  }
}

const broadcasterPanel = {
  infoPanelContentRenderer: {
    paragraphs: [{ runs: [{ text: 'DW is a German public broadcast service.' }] }],
    sourceEndpoint: urlEndpoint('https://en.wikipedia.org/wiki/Deutsche_Welle?wprov=yicw1'),
    inlineSource: { runs: [{ text: 'Wikipedia', navigationEndpoint: urlEndpoint('https://en.wikipedia.org/wiki/Deutsche_Welle?wprov=yicw1') }] }
  }
}

const healthPanel = {
  infoPanelContentRenderer: {
    paragraphs: [{ runs: [{ text: 'From a doctor licensed in the US' }] }],
    sourceEndpoint: urlEndpoint('https://support.google.com/youtube/answer/9795167'),
    disclaimer: { runs: [{ text: 'Learn more about how experts define health sources' }] },
    icon: { iconType: 'HEALTH_AND_SAFETY' }
  }
}

function videoInfo(...sections) {
  const next = Parser.parseResponse({
    contents: {
      twoColumnWatchNextResults: {
        results: { results: { contents: sections.map(contents => ({ itemSectionRenderer: { contents } })) } }
      }
    }
  })
  return { page: [{}, next] }
}

test('extracts topic, broadcaster, and health source panels using the installed YouTube parser', () => {
  assert.deepEqual(extract(videoInfo([topicPanel], [broadcasterPanel], [healthPanel])), [{
    title: 'Climate change',
    paragraphs: ['Climate change refers to long-term shifts in temperatures and weather patterns.'],
    source: 'United Nations',
    disclaimer: '',
    url: 'https://www.un.org/en/climatechange/what-is-climate-change'
  }, {
    title: '',
    paragraphs: ['DW is a German public broadcast service.'],
    source: 'Wikipedia',
    disclaimer: '',
    url: 'https://en.wikipedia.org/wiki/Deutsche_Welle?wprov=yicw1'
  }, {
    title: '',
    paragraphs: ['From a doctor licensed in the US'],
    source: '',
    disclaimer: 'Learn more about how experts define health sources',
    url: 'https://support.google.com/youtube/answer/9795167'
  }])
})

test('falls back to the link host and drops links that cannot open externally', () => {
  const panel = url => ({
    infoPanelContentRenderer: {
      paragraphs: [{ runs: [{ text: 'A notice.' }] }],
      ...(url !== undefined && { sourceEndpoint: urlEndpoint(url) })
    }
  })
  assert.deepEqual(extract(videoInfo([panel('//example.org/about')])), [{
    title: '', paragraphs: ['A notice.'], source: 'example.org', disclaimer: '', url: 'https://example.org/about'
  }])
  for (const url of [undefined, 'javascript:alert(1)', '/watch?v=abc']) {
    assert.deepEqual(extract(videoInfo([panel(url)])), [{
      title: '', paragraphs: ['A notice.'], source: '', disclaimer: '', url: ''
    }])
  }
})

test('handles absent responses and empty panels', () => {
  for (const info of [undefined, {}, { page: [] }, videoInfo(), videoInfo([{ infoPanelContentRenderer: {} }])]) {
    assert.equal(extract(info), null)
  }
})
