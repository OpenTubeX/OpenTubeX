import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { YT } from 'youtubei.js'

const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('function handleSearchResponse(')
const context = vm.createContext({ parseListItem: item => item })
vm.runInContext(`${source.slice(start, source.indexOf('/**', start))}\nglobalThis.normalize = handleSearchResponse`, context)

function searchResponse(items) {
  return new YT.Search({}, { data: {
    contents: { twoColumnSearchResultsRenderer: {
      primaryContents: { sectionListRenderer: { contents: [
        { itemSectionRenderer: { contents: items } }
      ] } }
    } }
  } })
}

test('preserves YouTube age-confirmation search notices through the real parser', () => {
  const response = searchResponse([{ backgroundPromoRenderer: {
    title: { runs: [{ text: 'Confirm your age' }] },
    bodyText: { runs: [{ text: 'These results may be inappropriate for some users.' }] },
    icon: { iconType: 'EMPTY_SEARCH' },
    ctaButton: { buttonRenderer: {
      text: { runs: [{ text: 'Sign in' }] },
      navigationEndpoint: { signInEndpoint: { hack: true } }
    } }
  } }])
  const result = context.normalize(response)
  assert.equal(result.results.length, 0)
  assert.equal(result.continuationData, null)
  assert.equal(result.searchNotice?.title, 'Confirm your age')
  assert.equal(result.searchNotice?.body, 'These results may be inappropriate for some users.')
  assert.equal(result.searchNotice?.requiresAuthentication, true)
})

test('identifies a localized sign-in notice without matching English text', () => {
  const result = context.normalize(searchResponse([{ backgroundPromoRenderer: {
    title: { simpleText: 'Bestätige dein Alter' },
    bodyText: { simpleText: 'Diese Ergebnisse sind möglicherweise unangemessen.' },
    ctaButton: { buttonRenderer: { navigationEndpoint: { signInEndpoint: {} } } }
  } }]))
  assert.equal(result.searchNotice.title, 'Bestätige dein Alter')
  assert.equal(result.searchNotice.requiresAuthentication, true)
})

test('keeps genuine empty searches separate from authentication notices', () => {
  const result = context.normalize(searchResponse([]))
  assert.equal(result.results.length, 0)
  assert.equal(result.searchNotice, null)
})

test('does not offer authentication for unrelated YouTube search notices', () => {
  const result = context.normalize(searchResponse([{ backgroundPromoRenderer: {
    title: { simpleText: 'No results found' }, bodyText: { simpleText: 'Try a different search.' }
  } }]))
  assert.equal(result.searchNotice.requiresAuthentication, false)
})
