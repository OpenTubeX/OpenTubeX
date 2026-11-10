import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collapseSeparators } from '../../src/renderer/helpers/menuSeparators.js'

const SEP = { type: 'separator' }
const labels = rows => rows.map(row => row.type === 'separator' ? '-' : row.label)

test('keeps one separator between groups', () => {
  assert.deepEqual(labels(collapseSeparators([{ label: 'a' }, SEP, SEP, { label: 'b' }])), ['a', '-', 'b'])
})
