import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const utilsSource = readFileSync(new URL('../../src/renderer/helpers/player/utils.js', import.meta.url), 'utf8')
const start = utilsSource.indexOf('export function repairInvidiousManifest(')
const repairSource = utilsSource.slice(start, utilsSource.indexOf('\n}\n', start) + 2).replace(/^export /, '')

const context = vm.createContext({ Intl, URL })
vm.runInContext(repairSource, context)

test('labels audio tracks from proxied Invidious manifests with relative stream URLs', () => {
  // Invidious proxies Invidious companion streams on its own origin
  const baseUrl = '/companion/videoplayback?id=abc&amp;itag=140&amp;xtags=acont%3Doriginal%3Alang%3Den'
  const adaptationSet = {
    tagName: 'AdaptationSet',
    attributes: { mimeType: 'audio/mp4', label: '128k' },
    children: [
      { tagName: 'Role', attributes: { value: 'main' }, children: [] },
      {
        tagName: 'Representation',
        attributes: {},
        children: [{ tagName: 'BaseURL', attributes: {}, children: [baseUrl] }]
      }
    ]
  }

  context.repairInvidiousManifest([{ tagName: 'Period', attributes: {}, children: [adaptationSet] }])

  assert.equal(adaptationSet.attributes.lang, 'en')
  assert.equal(adaptationSet.attributes.label, 'English original')
  assert.equal(adaptationSet.children.find(child => child.tagName === 'Role').attributes.value, 'main')
})
