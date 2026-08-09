import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTabAvatarFileName,
  createTabPreviewFileName,
  createTabPreviewTempFileName,
  isReusableTabPreviewFileName,
  isTabPreviewDataUrl,
  isTabPreviewTempFileName,
  normalizeTabPreviewFileName,
  selectOrphanedTabPreviews,
  TAB_PREVIEW_FILE_EXTENSION,
  tabPreviewBufferToDataUrl,
  tabPreviewDataUrlToBuffer
} from '../../src/main/tabs/tabPreviewCache.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('writes new previews as jpeg', () => {
  const fileName = createTabPreviewFileName()

  assert.ok(fileName.endsWith(TAB_PREVIEW_FILE_EXTENSION))
  assert.equal(normalizeTabPreviewFileName(fileName), fileName)
  assert.equal(isReusableTabPreviewFileName(fileName), true)
})

test('keeps reading caches written by older versions', () => {
  const legacy = '1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.png'

  assert.equal(normalizeTabPreviewFileName(legacy), legacy)
  // A PNG entry cannot be overwritten with jpeg bytes, so it is replaced.
  assert.equal(isReusableTabPreviewFileName(legacy), false)
})

test('rejects file names that are not previews', () => {
  for (const value of ['../escape.jpg', 'notauuid.jpg', 'x.svg', '', null, 42]) {
    assert.equal(normalizeTabPreviewFileName(value), null)
  }
})

test('tags the data URL from the buffer contents, not the current format', () => {
  assert.ok(tabPreviewBufferToDataUrl(JPEG).startsWith('data:image/jpeg;base64,'))
  assert.ok(tabPreviewBufferToDataUrl(PNG).startsWith('data:image/png;base64,'))
})

test('round trips a preview through its data URL', () => {
  assert.deepEqual(tabPreviewDataUrlToBuffer(tabPreviewBufferToDataUrl(JPEG)), JPEG)
  assert.deepEqual(tabPreviewDataUrlToBuffer(tabPreviewBufferToDataUrl(PNG)), PNG)
})

test('accepts both preview data URL types and nothing else', () => {
  assert.equal(isTabPreviewDataUrl(tabPreviewBufferToDataUrl(JPEG)), true)
  assert.equal(isTabPreviewDataUrl(tabPreviewBufferToDataUrl(PNG)), true)
  assert.equal(isTabPreviewDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), false)
  assert.equal(isTabPreviewDataUrl('https://i.ytimg.com/vi/x/mqdefault.jpg'), false)
  assert.equal(isTabPreviewDataUrl(null), false)
  assert.equal(tabPreviewDataUrlToBuffer('data:image/svg+xml;base64,PHN2Zy8+'), null)
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

test('treats everything as orphaned when no session was restored', () => {
  const files = ['1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg', '2c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f71.png']

  assert.deepEqual(selectOrphanedTabPreviews(files, []), files)
})

test('scratch names are not mistaken for finished previews', () => {
  const temp = createTabPreviewTempFileName()

  assert.ok(isTabPreviewTempFileName(temp))
  assert.equal(normalizeTabPreviewFileName(temp), null)
  assert.equal(isReusableTabPreviewFileName(temp), false)
  assert.equal(isTabPreviewTempFileName('1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg'), false)
  assert.equal(isTabPreviewTempFileName('notes.tmp'), false)
})

test('sweeps up scratch files left by an interrupted write', () => {
  const kept = '1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg'
  const temp = createTabPreviewTempFileName()

  // Pruning runs before any window exists, so a scratch file can only be
  // left over from a write that never finished - even for a referenced tab.
  assert.deepEqual(selectOrphanedTabPreviews([kept, temp], [kept]), [temp])
})

test('names an avatar after its contents so identical ones share a file', () => {
  const avatar = Buffer.from('channel avatar bytes')

  assert.equal(createTabAvatarFileName(avatar), createTabAvatarFileName(Buffer.from(avatar)))
  assert.notEqual(createTabAvatarFileName(avatar), createTabAvatarFileName(Buffer.from('other')))
  assert.ok(createTabAvatarFileName(avatar).endsWith(TAB_PREVIEW_FILE_EXTENSION))
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
