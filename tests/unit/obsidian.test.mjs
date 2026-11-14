import assert from 'node:assert/strict'
import test from 'node:test'

import { getObsidianAppendUri } from '../../src/main/obsidian.js'

test('only builds an Obsidian URI that appends to a note by name', () => {
  assert.equal(
    getObsidianAppendUri({ vault: 'My Vault', name: 'A & B?', content: '- [1:02](https://youtu.be/x?t=62) a+b\n' }),
    'obsidian://new?vault=My%20Vault&name=A%20%26%20B%3F&content=-%20%5B1%3A02%5D(https%3A%2F%2Fyoutu.be%2Fx%3Ft%3D62)%20a%2Bb%0A&append=true&silent=true'
  )
  // Extra parameters, such as overwrite, are ignored
  assert.doesNotMatch(getObsidianAppendUri({ vault: 'v', name: 'n', content: 'c', overwrite: 'true' }), /overwrite/)

  for (const note of [
    null,
    'obsidian://new?vault=v&name=n&overwrite=true',
    { vault: '', name: 'n', content: 'c' },
    { vault: 'v', name: 'n', content: 1 },
    { vault: 'v', name: '../n', content: 'c' },
    { vault: 'v', name: 'folder\\n', content: 'c' },
  ]) {
    assert.equal(getObsidianAppendUri(note), null)
  }
})
