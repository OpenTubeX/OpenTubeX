import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cleanReleaseNotes,
  prepareManifest,
} from '../../_scripts/prepareWingetManifest.mjs'

const VERSION = '1.2.3'
const PRODUCT_CODE = 'a38f022d-fec2-5f80-a7fe-620ccf1a2767'

function asset (architecture, digestCharacter) {
  const name = `opentubex-${VERSION}-beta-setup-${architecture}.exe`

  return {
    browser_download_url: `https://github.com/OpenTubeX/OpenTubeX/releases/download/v${VERSION}-beta/${name}`,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    name,
  }
}

function installerManifest () {
  const installers = [
    ['x64', 'user', '/CURRENTUSER', 'a'],
    ['x64', 'machine', '/ALLUSERS', 'a'],
    ['arm64', 'user', '/CURRENTUSER', 'b'],
    ['arm64', 'machine', '/ALLUSERS', 'b'],
  ].map(([architecture, scope, installerSwitch, digestCharacter]) => `- Architecture: ${architecture}
  Scope: ${scope}
  InstallerUrl: ${asset(architecture, digestCharacter).browser_download_url}
  InstallerSha256: ${digestCharacter.repeat(64)}
  InstallerSwitches:
    Custom: ${installerSwitch}`).join('\n')

  return `PackageIdentifier: OpenTubeX.OpenTubeX
PackageVersion: ${VERSION}
InstallerType: nullsoft
Protocols:
- opentubex
ProductCode: ${PRODUCT_CODE}
ReleaseDate: 2000-01-01
AppsAndFeaturesEntries:
- DisplayName: Old name
  ProductCode: ${PRODUCT_CODE}
Installers:
${installers}
ManifestType: installer
ManifestVersion: 1.12.0
`
}

function localeManifest () {
  return `PackageIdentifier: OpenTubeX.OpenTubeX
PackageVersion: ${VERSION}
PackageLocale: en-US
PackageName: OpenTubeX
Tags:
- old-tag
ReleaseNotes: |-
  Old notes
ReleaseNotesUrl: https://example.com/old
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`
}

test('release note cleanup removes promotional and image content', () => {
  const markdown = `> [!NOTE]
> OpenTubeX is now on ProductHunt
> <a href="https://example.com"><img alt="badge" src="badge.svg"></a>

## Highlights

- Use the <kbd>Ctrl</kbd> key. ![Screenshot](screenshot.png)
  <img alt="image" src="image.webp">

## More improvements

- Read [the guide](https://example.com).
  image
`

  assert.equal(cleanReleaseNotes(markdown), `Highlights

- Use the Ctrl key.

More improvements

- Read the guide.`)
})

test('release note cleanup removes incomplete HTML markup', () => {
  assert.equal(
    cleanReleaseNotes('## Fixed bugs\n\n- Removed <script and an orphan > marker.'),
    'Fixed bugs\n\n- Removed  marker.'
  )
  assert.equal(
    cleanReleaseNotes('## Fixed bugs\n\n- Kept this.\n<!-- unfinished comment'),
    'Fixed bugs\n\n- Kept this.'
  )
})

test('release note cleanup preserves comparison operators', () => {
  assert.equal(
    cleanReleaseNotes('## Performance\n\n- Keep count < 10 and latency > 20 ms.'),
    'Performance\n\n- Keep count < 10 and latency > 20 ms.'
  )
})

test('release note cleanup removes escaped HTML markup', () => {
  assert.equal(
    cleanReleaseNotes('## Highlights\n\n- Use &lt;kbd&gt;Ctrl&lt;/kbd&gt; and reject &lt;script&gt;alert(1)&lt;/script&gt;.'),
    'Highlights\n\n- Use Ctrl and reject alert(1).'
  )
})

test('release note cleanup removes reference-style linked badges', () => {
  assert.equal(
    cleanReleaseNotes(`## Fixed bugs

[![Build badge][badge-image]][badge-link]

- Fixed a bug.

[badge-image]: https://example.com/build.svg
[badge-link]: https://example.com/build`),
    'Fixed bugs\n\n- Fixed a bug.'
  )
})

test('manifest preparation applies release metadata and validates installers', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-manifest-test-'))
  context.after(() => fs.rmSync(directory, { recursive: true }))

  fs.writeFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.installer.yaml'), installerManifest())
  fs.writeFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.locale.en-US.yaml'), localeManifest())
  fs.writeFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.yaml'), `PackageIdentifier: OpenTubeX.OpenTubeX
PackageVersion: ${VERSION}
ManifestType: version
ManifestVersion: 1.12.0
`)

  const result = prepareManifest({
    manifestDirectory: directory,
    release: {
      assets: [asset('x64', 'a'), asset('arm64', 'b')],
      body: '## Fixed bugs\n\n- Fixed a bug.\n\n<img alt="image" src="bug.png">',
      html_url: `https://github.com/OpenTubeX/OpenTubeX/releases/tag/v${VERSION}-beta`,
      published_at: '2026-08-27T10:00:00Z',
      tag_name: `v${VERSION}-beta`,
    },
    topics: {
      names: ['youtube', 'privacy', 'electron'],
    },
  })

  assert.deepEqual(result.tags, ['electron', 'privacy', 'youtube'])
  assert.equal(result.releaseNotes, 'Fixed bugs\n\n- Fixed a bug.')

  const installer = fs.readFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.installer.yaml'), 'utf8')
  const locale = fs.readFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.locale.en-US.yaml'), 'utf8')

  assert.match(installer, /^ReleaseDate: 2026-08-27$/m)
  assert.match(installer, /^- DisplayName: OpenTubeX 1\.2\.3$/m)
  assert.match(locale, /Tags:\n- electron\n- privacy\n- youtube/)
  assert.match(locale, /ReleaseNotes: \|-\n {2}Fixed bugs\n\n {2}- Fixed a bug\./)
  assert.match(locale, new RegExp(`ReleaseNotesUrl: https://github.com/OpenTubeX/OpenTubeX/releases/tag/v${VERSION}-beta`))
})

test('manifest preparation rejects missing installer scopes', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-manifest-test-'))
  context.after(() => fs.rmSync(directory, { recursive: true }))

  fs.writeFileSync(
    path.join(directory, 'OpenTubeX.OpenTubeX.installer.yaml'),
    installerManifest().replace(/- Architecture: arm64\n {2}Scope: machine[^]*?(?=\nManifestType:)/, '')
  )
  fs.writeFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.locale.en-US.yaml'), localeManifest())
  fs.writeFileSync(path.join(directory, 'OpenTubeX.OpenTubeX.yaml'), `PackageIdentifier: OpenTubeX.OpenTubeX
PackageVersion: ${VERSION}
`)

  assert.throws(() => prepareManifest({
    manifestDirectory: directory,
    release: {
      assets: [asset('x64', 'a'), asset('arm64', 'b')],
      body: '## Fixed bugs\n\n- Fixed a bug.',
      html_url: `https://github.com/OpenTubeX/OpenTubeX/releases/tag/v${VERSION}-beta`,
      published_at: '2026-08-27T10:00:00Z',
      tag_name: `v${VERSION}-beta`,
    },
    topics: { names: ['privacy'] },
  }), /Expected four installer entries/)
})
