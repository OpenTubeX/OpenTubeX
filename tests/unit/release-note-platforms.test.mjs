import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterReleaseNotesForPlatforms,
  formatPlatformLabel,
  parsePlatformLabel,
} from '../../src/renderer/helpers/releaseNotePlatforms.js'
import { formatReleaseChangelog } from '../../src/renderer/helpers/releaseUpdates.js'

const notes = `## Highlights

- **Android:** Shared links open in the app. (#2)
  <img src="https://github.com/user-attachments/assets/android" alt="Share sheet">

## More improvements

- Works everywhere. (#1)
- **Desktop:** Adds a tray icon. (#4)
  <picture>
    <img src="https://github.com/user-attachments/assets/tray" alt="Tray">
  </picture>
- **Android, iOS:** Adds a mini player. (#5)
`

test('platform labels group the desktop platforms', () => {
  assert.equal(formatPlatformLabel(['android']), 'Android')
  assert.equal(formatPlatformLabel(['ios', 'linux', 'macos', 'windows']), 'iOS, Desktop')
  assert.equal(formatPlatformLabel(['linux', 'windows']), 'Linux, Windows')
})

test('platform labels are parsed from rendered and plain-text items', () => {
  assert.deepEqual(parsePlatformLabel('**iOS, Desktop:** Adds a tray icon.'), {
    platforms: ['ios', 'linux', 'macos', 'windows'],
    text: 'Adds a tray icon.',
  })
  assert.deepEqual(parsePlatformLabel('Linux: Adds MPRIS controls.'), { platforms: ['linux'], text: 'Adds MPRIS controls.' })
  assert.deepEqual(parsePlatformLabel('**Android:* Broken label.'), { platforms: null, text: '**Android:* Broken label.' })
  assert.deepEqual(parsePlatformLabel('Androids: are not a platform.'), { platforms: null, text: 'Androids: are not a platform.' })
})

test('filtering removes items for other platforms with their images and empty headings', () => {
  assert.equal(filterReleaseNotesForPlatforms(notes, ['linux']), `## More improvements

- Works everywhere. (#1)
- **Desktop:** Adds a tray icon. (#4)
  <picture>
    <img src="https://github.com/user-attachments/assets/tray" alt="Tray">
  </picture>
`)
  assert.equal(filterReleaseNotesForPlatforms(notes, ['ios']), `## More improvements

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

## More improvements

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

test('filtering recognizes every list marker and keeps skipping an item across blank lines', () => {
  assert.equal(filterReleaseNotesForPlatforms([
    '+ **iOS:** Plus item.',
    '1. **iOS:** Numbered item.',
    '2) Shared item.',
    '- **iOS:** Spaced item.',
    '',
    '  <img src="https://github.com/user-attachments/assets/ios" alt="iOS">',
    '',
    'After the list.',
  ].join('\n'), ['android']), '2) Shared item.\n\nAfter the list.')
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
