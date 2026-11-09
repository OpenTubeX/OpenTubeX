import assert from 'node:assert/strict'
import test from 'node:test'

import { filterReleaseNotesForPlatforms } from '../../src/renderer/helpers/releaseNotePlatforms.js'
import { formatReleaseChangelog } from '../../src/renderer/helpers/releaseUpdates.js'

const notes = `## Highlights

- **Android:** Shared links open in the app. (#2)
  <img src="https://github.com/user-attachments/assets/android" alt="Share sheet">

## Improvements

- Works everywhere. (#1)
- **Desktop:** Adds a tray icon. (#4)
  <picture>
    <img src="https://github.com/user-attachments/assets/tray" alt="Tray">
  </picture>
- **Android, iOS:** Adds a mini player. (#5)
`

test('filtering removes items for other platforms with their images and empty headings', () => {
  assert.equal(filterReleaseNotesForPlatforms(notes, ['linux']), `## Improvements

- Works everywhere. (#1)
- **Desktop:** Adds a tray icon. (#4)
  <picture>
    <img src="https://github.com/user-attachments/assets/tray" alt="Tray">
  </picture>
`)
  assert.equal(filterReleaseNotesForPlatforms(notes, ['ios']), `## Improvements

- Works everywhere. (#1)
- **Android, iOS:** Adds a mini player. (#5)
`)
  assert.equal(filterReleaseNotesForPlatforms(notes, null), notes)
})

test('filtering keeps nightly wrappers and removes headings emptied inside them', () => {
  const nightly = `> [!WARNING]
> Nightly.

<details>
<summary>Changelog since the latest release</summary>

## Highlights

- Works everywhere. (#1)

## Improvements

- **Windows:** Adds jump lists. (#3)

</details>
`

  assert.equal(filterReleaseNotesForPlatforms(nightly, ['android']), `> [!WARNING]
> Nightly.

<details>
<summary>Changelog since the latest release</summary>

## Highlights

- Works everywhere. (#1)

</details>
`)
})

test('update changelogs show only the running platform\'s notes and skip releases without any', () => {
  const releases = [
    { body: '- **Windows:** Adds jump lists.\n- Works everywhere.', name: 'v2', tag_name: 'v2' },
    { body: '- **Android:** Adds widgets.', name: 'v1', tag_name: 'v1' },
  ]

  assert.equal(formatReleaseChangelog(releases, 'android'), '## v2\n\n- Works everywhere.\n\n## v1\n\n- **Android:** Adds widgets.')
  assert.equal(formatReleaseChangelog(releases, 'linux'), '## v2\n\n- Works everywhere.')
  assert.equal(formatReleaseChangelog(releases.slice(1), 'linux'), '- **Android:** Adds widgets.')
  // With nothing for the running platform, every note stays with its label.
  assert.equal(
    formatReleaseChangelog([{ body: '- **iOS:** Adds SharePlay.', name: 'v2' }, releases[1]], 'linux'),
    '## v2\n\n- **iOS:** Adds SharePlay.\n\n## v1\n\n- **Android:** Adds widgets.'
  )
  assert.equal(formatReleaseChangelog(releases.slice(1)), '- **Android:** Adds widgets.')

  const nightly = { body: 'Automated development build.\n\n<details>\n\n- **Windows:** Adds jump lists.\n\n</details>', tag_name: 'v3' }
  assert.equal(formatReleaseChangelog([nightly], 'android'), nightly.body)
  assert.equal(formatReleaseChangelog([releases[0], nightly], 'android'), '## v2\n\n- Works everywhere.')
  assert.equal(
    formatReleaseChangelog([releases[0], { body: 'No noteworthy changes.', name: 'v1' }], 'android'),
    '## v2\n\n- Works everywhere.\n\n## v1\n\nNo noteworthy changes.'
  )
})
