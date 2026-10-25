import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const webpack = require('webpack')
const RelativeImportMetaUrlPlugin = require('../../_scripts/RelativeImportMetaUrlPlugin.js')

test('bundles import.meta.url without the checkout path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'import-meta-url-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'entry.mjs'), 'const scriptName = import.meta.url\nexport const base = new URL(".", scriptName).href\n')
  const compiler = webpack({
    mode: 'production',
    context: directory,
    entry: './entry.mjs',
    output: { path: join(directory, 'dist'), library: { type: 'commonjs2' } },
    plugins: [new RelativeImportMetaUrlPlugin()]
  })
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => compiler.close(() => (error ? reject(error) : resolve(result))))
  })
  assert.ok(!stats.hasErrors(), stats.toString('errors-only'))

  const output = await readFile(join(directory, 'dist/main.js'), 'utf8')
  assert.ok(!output.includes(directory), 'the bundle must not depend on the build directory')
  assert.match(output, /"file:\/\/\/entry\.mjs"/)
})
