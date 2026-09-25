import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DEFAULT_CUSTOM_THEME } from '../../src/customTheme.js'
import { createCustomThemeStore } from '../../src/main/customThemeStore.js'

async function withThemeStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-themes-'))
  try {
    await run(createCustomThemeStore(directory), directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function theme(id, name) {
  return { ...DEFAULT_CUSTOM_THEME, id, name }
}

test('saves normalized themes as JSON and returns them sorted by name', async () => {
  await withThemeStore(async (store, directory) => {
    await store.save(theme('z-theme', 'Zebra'))
    const themes = await store.save(theme('a-theme', 'Apple'))

    assert.deepEqual(themes.map(({ id }) => id), ['a-theme', 'z-theme'])
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'a-theme.json'), 'utf8')), themes[0])
    assert.match(await readFile(path.join(directory, 'a-theme.json'), 'utf8'), /\n$/)
    assert.deepEqual((await readdir(directory)).sort(), ['a-theme.json', 'z-theme.json'])
  })
})

test('rejects unsafe IDs before writing a theme file', async () => {
  await withThemeStore(async (store, directory) => {
    await assert.rejects(store.save(theme('../outside', 'Unsafe')), /Invalid custom theme ID/)
    assert.deepEqual(await readdir(directory), [])
  })
})

test('loads valid JSON themes while ignoring unrelated and malformed files', async () => {
  await withThemeStore(async (store, directory) => {
    await writeFile(path.join(directory, 'invalid.json'), '{')
    await writeFile(path.join(directory, 'notes.txt'), 'ignored')
    await writeFile(path.join(directory, 'valid.json'), JSON.stringify(theme('valid', 'Valid')))

    const originalError = console.error
    console.error = () => {}
    try {
      assert.deepEqual((await store.load()).map(({ id }) => id), ['valid'])
    } finally {
      console.error = originalError
    }
  })
})

test('replaces themes and removes only obsolete JSON files', async () => {
  await withThemeStore(async (store, directory) => {
    await store.save(theme('old', 'Old'))
    await writeFile(path.join(directory, 'notes.txt'), 'keep')

    const themes = await store.replace([theme('new', 'New')])

    assert.deepEqual(themes.map(({ id }) => id), ['new'])
    assert.deepEqual((await readdir(directory)).sort(), ['new.json', 'notes.txt'])
    await assert.rejects(store.replace([theme('new', 'First'), theme('new', 'Second')]), /Duplicate custom theme ID/)
    assert.deepEqual((await readdir(directory)).sort(), ['new.json', 'notes.txt'])
  })
})

test('selects requested themes and falls back only for the legacy custom value', async () => {
  await withThemeStore(async (store) => {
    await store.replace([theme('second', 'Second'), theme('first', 'First')])

    assert.equal((await store.getSelected('custom:second'))?.id, 'second')
    assert.equal((await store.getSelected('custom'))?.id, 'first')
    assert.equal(await store.getSelected('custom:missing'), null)
    assert.deepEqual((await store.remove('first')).map(({ id }) => id), ['second'])
  })
})
