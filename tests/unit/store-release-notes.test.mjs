import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  appStreamDescription,
  debianChangelog,
  fdroidChangelog,
  releaseNoteSections,
  rpmChangelog,
} from '../../_scripts/storeReleaseNotes.mjs'

const notes = `## Highlights

- Sort your subscriptions into groups to filter the feed (#548, #2248)
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/dark">
    <img src="https://github.com/user-attachments/assets/dark" alt="Groups" width="1026">
  </picture>
- Use <kbd>Ctrl</kbd> & [the guide](https://example.com) for 100% of shortcuts (#2131)

## Fixed bugs

- Fixed a crash
  that happened on startup (#2400)
`

const packageDetails = JSON.parse(readFileSync('package.json', 'utf8'))
const date = new Date('2026-10-05T08:09:10Z')

test('release note sections drop images, markup, and issue references', () => {
  assert.deepEqual(releaseNoteSections(notes), [
    {
      heading: 'Highlights',
      items: [
        'Sort your subscriptions into groups to filter the feed',
        'Use Ctrl & the guide for 100% of shortcuts',
      ],
    },
    { heading: 'Fixed bugs', items: ['Fixed a crash that happened on startup'] },
  ])
})

test('F-Droid changelogs keep every item when they fit', () => {
  assert.equal(fdroidChangelog(notes), `Highlights
• Sort your subscriptions into groups to filter the feed
• Use Ctrl & the guide for 100% of shortcuts

Fixed bugs
• Fixed a crash that happened on startup`)
})

test('F-Droid changelogs keep whole items within the limit', () => {
  const long = `## Highlights\n\n- ${'Long highlight '.repeat(30)}\n- Short highlight\n\n## Fixed bugs\n\n- Fixed a crash\n`
  const changelog = fdroidChangelog(long, 100)

  assert.equal(changelog, 'Highlights\n• Short highlight\n\nFixed bugs\n• Fixed a crash\n…and more')
})

test('F-Droid changelogs shorten a single oversized item', () => {
  const changelog = fdroidChangelog(`## Highlights\n\n- ${'word '.repeat(200)}`)

  assert(changelog.length <= 500)
  assert.match(changelog, /^Highlights\n• word word .*word…$/s)
})

test('AppStream descriptions use escaped paragraphs and lists', () => {
  assert.equal(appStreamDescription(notes), `<p>Highlights</p>
<ul>
  <li>Sort your subscriptions into groups to filter the feed</li>
  <li>Use Ctrl &amp; the guide for 100% of shortcuts</li>
</ul>
<p>Fixed bugs</p>
<ul>
  <li>Fixed a crash that happened on startup</li>
</ul>`)
})

test('Debian changelogs wrap items under section headings', () => {
  const changelog = debianChangelog(`## Highlights\n\n- ${'Wrapped words '.repeat(10)}\n`, date)

  assert.equal(changelog, `${packageDetails.name} (${packageDetails.version}) stable; urgency=medium

  [ Highlights ]
  * Wrapped words Wrapped words Wrapped words Wrapped words Wrapped words
    Wrapped words Wrapped words Wrapped words Wrapped words Wrapped words

 -- OpenTubeX contributors <info@opentubex.org>  Mon, 05 Oct 2026 08:09:10 +0000
`)
})

test('RPM changelogs escape macros', () => {
  assert.equal(rpmChangelog(notes, date), `* Mon Oct 05 2026 OpenTubeX contributors <info@opentubex.org> - ${packageDetails.version}
- Sort your subscriptions into groups to filter the feed
- Use Ctrl & the guide for 100%% of shortcuts
- Fixed a crash that happened on startup
`)
})
