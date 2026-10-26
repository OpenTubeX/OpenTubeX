import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('release note sections decode entities and keep non-promotional support headings', () => {
  assert.deepEqual(releaseNoteSections(`## Support for Android 15

- Added &#X41;&#x42;&#67; and kept &#x110000; &constructor;

## Support us

- Donate today
`), [{ heading: 'Support for Android 15', items: ['Added ABC and kept &#x110000; &constructor;'] }])
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

test('the converter rejects empty notes and invalid source dates', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'store-release-notes-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const convert = (format, markdown, env = {}) => {
    const input = join(directory, 'notes.md')

    writeFileSync(input, markdown)
    return spawnSync(process.execPath, ['_scripts/storeReleaseNotes.mjs', format, input], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
  }

  for (const format of ['appstream', 'debian', 'fdroid', 'rpm']) {
    const result = convert(format, '## Highlights\n')

    assert.equal(result.status, 1, format)
    assert.match(result.stderr, /has no release note items/)
  }

  const invalidDate = convert('rpm', notes, { SOURCE_DATE_EPOCH: 'abc' })

  assert.equal(invalidDate.status, 1)
  assert.match(invalidDate.stderr, /Invalid SOURCE_DATE_EPOCH: abc/)
  assert.match(convert('rpm', notes, { SOURCE_DATE_EPOCH: '1759651750' }).stdout, /^\* Sun Oct 05 2025 /)
})
