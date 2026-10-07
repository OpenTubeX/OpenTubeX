import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { babelParse } from 'vue/compiler-sfc'

const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const declaration = babelParse(source, { sourceType: 'module' }).program.body
  .find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'customActions')
const action = declaration.declarations[0].init.properties
  .find(node => node.key?.name === 'updateSyncServerActivityClearedThrough')

function fixture({ fail = false, locked = true } = {}) {
  let saved = { alice: '0003', bob: '0007' }
  let pending = Promise.resolve()
  const writes = []
  const commits = []
  const context = vm.createContext({
    navigator: locked ? { locks: { request(_name, operation) {
      pending = pending.catch(() => {}).then(operation)
      return pending
    } } } : {},
    DBSettingHandlers: {
      async find() {
        return [{ _id: 'syncServerActivityClearedThrough', value: { ...saved } }]
      },
      async upsert(_id, value) {
        if (fail) throw new Error('Disk full')
        await new Promise(resolve => setImmediate(resolve))
        saved = { ...value }
        writes.push(saved)
      },
    },
  })
  const update = vm.runInContext(`({ ${source.slice(action.start, action.end)} }).updateSyncServerActivityClearedThrough`, context)
  return {
    update: value => update({ commit: (_id, value) => commits.push(value) }, value),
    saved: () => saved,
    writes,
    commits,
  }
}

for (const locked of [true, false]) {
  test(`an older window cannot lower a saved activity cutoff (${locked ? 'locked' : 'single context'})`, async () => {
    const f = fixture({ locked })
    await f.update({ alice: '0002' })
    assert.deepEqual(f.saved(), { alice: '0003', bob: '0007' })
  })
}

test('concurrent clears preserve the newest cutoff and other accounts', async () => {
  const f = fixture()
  await Promise.all([
    f.update({ alice: '0009' }),
    f.update({ alice: '0005', carol: '0004' }),
  ])
  assert.deepEqual(f.saved(), { alice: '0009', bob: '0007', carol: '0004' })
  assert.equal(f.writes.length, 2)
  assert.deepEqual({ ...f.commits.at(-1) }, f.saved())
})

test('failed cutoff persistence rejects without committing a dismissal', async () => {
  const f = fixture({ fail: true })
  await assert.rejects(f.update({ alice: '0009' }), /Disk full/)
  assert.equal(f.commits.length, 0)
  assert.deepEqual(f.saved(), { alice: '0003', bob: '0007' })
})
