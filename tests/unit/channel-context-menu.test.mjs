import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/channel-context-menu.js', import.meta.url), 'utf8')

test('channel context menus tolerate non-string imported subscription thumbnails', () => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const prefix = 'app://index.html#'
  const link = {
    href: `${prefix}/channel/${id}`,
    dataset: {},
    getAttribute: () => null,
    closest: () => null,
    querySelector: () => null,
    textContent: 'Imported channel'
  }

  for (const thumbnail of [{ url: 'invalid' }, true, 123]) {
    const getDetails = vm.runInNewContext(
      source.slice(source.indexOf('export function')).replaceAll('export ', '') + '\ngetChannelLinkDetails',
      {
        window: { location: { href: `${prefix}/history` } },
        store: {
          getters: {
            getSubscribedChannelsById: new Map([[id, { thumbnail }]]),
            getChannelThumbnail: () => null
          }
        }
      }
    )
    const details = getDetails(link)
    assert.equal(details.id, id)
    assert.equal(details.name, 'Imported channel')
    assert.equal(details.thumbnail, null)
  }
})
