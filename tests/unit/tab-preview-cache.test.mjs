import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTabAvatarFileName,
  createTabPreviewTempFileName,
  isReusableTabPreviewFileName,
  isTabPreviewDataUrl,
  isTabPreviewTempFileName,
  normalizeTabPreviewFileName,
  selectOrphanedTabPreviews,
  tabPreviewBufferToDataUrl
} from '../../src/main/tabs/tabPreviewCache.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('rejects file names that are not previews', () => {
  for (const value of ['../escape.jpg', 'notauuid.jpg', 'x.svg', '', null, 42]) {
    assert.equal(normalizeTabPreviewFileName(value), null)
  }
})

test('accepts both preview data URL types and nothing else', () => {
  assert.equal(isTabPreviewDataUrl(tabPreviewBufferToDataUrl(JPEG)), true)
  assert.equal(isTabPreviewDataUrl(tabPreviewBufferToDataUrl(PNG)), true)
  assert.equal(isTabPreviewDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), false)
  assert.equal(isTabPreviewDataUrl('https://i.ytimg.com/vi/x/mqdefault.jpg'), false)
  assert.equal(isTabPreviewDataUrl(null), false)
})

test('deletes only previews no tab refers to', () => {
  const kept = '1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg'
  const legacyKept = '2c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f71.png'
  const orphan = '3c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f72.jpg'

  const orphans = selectOrphanedTabPreviews(
    [kept, legacyKept, orphan],
    [kept, legacyKept, null, undefined, 'not-a-preview.jpg']
  )

  assert.deepEqual(orphans, [orphan])
})

test('leaves unrelated files in the cache directory alone', () => {
  const orphans = selectOrphanedTabPreviews(['README.md', '.keep', 'thumbs.db'], [])

  assert.deepEqual(orphans, [])
})

test('sweeps up scratch files left by an interrupted write', () => {
  const kept = '1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg'
  const temp = createTabPreviewTempFileName()

  // Pruning runs before any window exists, so a scratch file can only be
  // left over from a write that never finished - even for a referenced tab.
  assert.deepEqual(selectOrphanedTabPreviews([kept, temp], [kept]), [temp])
})

test('accepts content addressed avatars alongside the random names', () => {
  const avatarFileName = createTabAvatarFileName(Buffer.from('channel avatar bytes'))

  assert.equal(normalizeTabPreviewFileName(avatarFileName), avatarFileName)
  assert.ok(isReusableTabPreviewFileName(avatarFileName))
  assert.equal(isTabPreviewTempFileName(avatarFileName), false)
  // Path traversal stays rejected
  assert.equal(normalizeTabPreviewFileName('avatar-../../etc/passwd.jpg'), null)
  assert.equal(normalizeTabPreviewFileName('avatar-zz.jpg'), null)
})

test('keeps an avatar that a tab still refers to and prunes the rest', () => {
  const shared = createTabAvatarFileName(Buffer.from('channel avatar bytes'))
  const stale = createTabAvatarFileName(Buffer.from('an avatar nothing points at'))

  assert.deepEqual(selectOrphanedTabPreviews([shared, stale], [shared]), [stale])
})
