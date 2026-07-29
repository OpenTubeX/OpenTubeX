import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findIconDefinition, library } from '@fortawesome/fontawesome-svg-core'
import * as brandIcons from '@fortawesome/free-brands-svg-icons'
import * as regularIcons from '@fortawesome/free-regular-svg-icons'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rendererRoot = path.join(repoRoot, 'src/renderer')

function parseImportedIcons(source, packageName) {
  const importEnd = source.indexOf(`} from '${packageName}'`)
  const importStart = source.lastIndexOf('import {', importEnd)
  const importBlock = source.slice(importStart + 'import {'.length, importEnd)

  return new Map(importBlock.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [exportName, localName = exportName] = entry.split(/\s+as\s+/)
      return [localName, exportName]
    }))
}

test('registers every literal Font Awesome icon used by the renderer', async () => {
  const mainSource = await readFile(path.join(rendererRoot, 'main.js'), 'utf8')
  const registeredNames = new Set(
    mainSource.match(/library\.add\(([\s\S]*?)\n\)\n\nregisterSwiper/)?.[1]
      .match(/\b(?:fa|far)[A-Z]\w*/g) ?? []
  )
  const iconImports = [
    [solidIcons, parseImportedIcons(mainSource, '@fortawesome/free-solid-svg-icons')],
    [regularIcons, parseImportedIcons(mainSource, '@fortawesome/free-regular-svg-icons')],
    [brandIcons, parseImportedIcons(mainSource, '@fortawesome/free-brands-svg-icons')],
  ]

  for (const [iconModule, importedNames] of iconImports) {
    for (const registeredName of registeredNames) {
      const exportName = importedNames.get(registeredName)
      if (exportName) {
        library.add(iconModule[exportName])
      }
    }
  }

  const rendererFiles = (await readdir(rendererRoot, { recursive: true }))
    .filter(file => /\.(?:js|vue)$/.test(file))
  const missingIcons = new Set()

  for (const file of rendererFiles) {
    const source = await readFile(path.join(rendererRoot, file), 'utf8')
    for (const match of source.matchAll(/\[['"](fas|far|fab)['"],\s*['"]([^'"]+)['"]\]/g)) {
      const [, prefix, iconName] = match
      if (!findIconDefinition({ prefix, iconName })) {
        missingIcons.add(`${prefix}:${iconName}`)
      }
    }
  }

  assert.deepEqual([...missingIcons].sort(), [])
})
