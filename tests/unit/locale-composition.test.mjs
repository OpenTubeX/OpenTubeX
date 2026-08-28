import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import { composeLocaleMessages } from '../../src/localeComposition.js'

const require = createRequire(import.meta.url)
const ProcessLocalesPlugin = require('../../_scripts/ProcessLocalesPlugin.js')
const webpack = require('webpack')

test('human base translations take priority over regional and base AI completions', () => {
  const regionalHuman = {
    Existing: 'regional human',
    Nested: { Regional: 'regional human' },
  }
  const baseHuman = {
    Existing: 'base human',
    Base: 'base human',
  }
  const regionalAI = {
    Existing: 'regional AI',
    Base: 'regional AI',
    Generated: 'regional AI',
  }
  const baseAI = {
    Generated: 'base AI',
    Last: 'base AI',
  }

  const result = composeLocaleMessages({
    locale: 'es-AR',
    humanMessages: new Map([
      ['es-AR', regionalHuman],
      ['es', baseHuman],
    ]),
    aiMessages: new Map([
      ['es-AR', regionalAI],
      ['es', baseAI],
    ]),
    includeAI: true,
  })

  assert.deepEqual(result, {
    Existing: 'regional human',
    Nested: { Regional: 'regional human' },
    Base: 'base human',
    Generated: 'regional AI',
    Last: 'base AI',
  })
  assert.deepEqual(regionalHuman, {
    Existing: 'regional human',
    Nested: { Regional: 'regional human' },
  })
})

test('AI messages are omitted when completions are disabled', () => {
  const result = composeLocaleMessages({
    locale: 'fr-FR',
    humanMessages: new Map([['fr-FR', { Human: 'translation' }]]),
    aiMessages: new Map([['fr-FR', { Generated: 'completion' }]]),
    includeAI: false,
  })

  assert.deepEqual(result, { Human: 'translation' })
})

test('AI locale processing emits separate assets without changing human percentages', async () => {
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'opentubex-locales-'))
  const humanDirectory = path.join(fixtureDirectory, 'human')
  const aiDirectory = path.join(fixtureDirectory, 'ai')
  try {
    await mkdir(humanDirectory)
    await mkdir(aiDirectory)
    await Promise.all([
      writeFile(path.join(humanDirectory, 'activeLocales.json'), '["en-US", "es"]'),
      writeFile(path.join(humanDirectory, 'en-US.yaml'), 'Locale Name: English\nOne: one\nTwo: two\n'),
      writeFile(path.join(humanDirectory, 'es.yaml'), 'Locale Name: Español\nOne: uno\n'),
      writeFile(path.join(aiDirectory, 'es.yaml'), 'Two: dos\n'),
    ])

    const humanPlugin = new ProcessLocalesPlugin({
      inputDir: humanDirectory,
      outputDir: 'static/locales',
    })
    const aiPlugin = new ProcessLocalesPlugin({
      activeLocales: humanPlugin.activeLocales,
      allowMissing: true,
      collectMetadata: false,
      inputDir: aiDirectory,
      localeSource: 'ai',
      outputDir: 'static/locales/ai',
    })

    assert.deepEqual(humanPlugin.localeTranslationPercentages, [100, 50])
    assert.deepEqual([...aiPlugin.locales.keys()], ['es'])

    const emittedAssets = new Map()
    await aiPlugin.processLocale(
      'es',
      aiPlugin.locales.get('es'),
      [],
      { watching: false, webpack },
      { emitAsset: (filename, source) => emittedAssets.set(filename, source.source()) }
    )

    assert.equal(emittedAssets.get('static/locales/ai/es.json'), '{"Two":"dos"}')
    assert.deepEqual(humanPlugin.localeTranslationPercentages, [100, 50])
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true })
  }
})
