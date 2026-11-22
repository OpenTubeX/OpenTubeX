import { test, expect } from '@playwright/test'
import { createShardMatrix, shardTestList } from '../../shards.mjs'

function report(counts) {
  return {
    suites: [{
      suites: [{
        specs: Object.entries(counts).map(([projectName, count]) => ({
          tests: Array.from({ length: count }, () => ({ projectName }))
        }))
      }]
    }]
  }
}

const full = report({
  offline: 3000,
  'offline-95': 400,
  'offline-125': 400,
  performance: 120,
  browser: 25,
  network: 70
})

function shardCounts(include) {
  return Object.fromEntries(include.map(shard => [shard.project, shard.shardTotal]))
}

test('nightly shards run every project, and offline shards include the scaled projects', () => {
  const { include } = createShardMatrix(full)
  expect(shardCounts(include)).toEqual({ offline: 16, performance: 3, browser: 1, network: 1 })
  expect(include[0]).toEqual({ project: 'offline', projects: 'offline offline-95 offline-125', shard: 1, shardTotal: 16 })
})

test('shards take turns picking tests, so neighboring slow files spread out', () => {
  const tests = (...projectNames) => projectNames.map(projectName => ({ projectName }))
  const listed = {
    suites: [
      {
        title: 'offline/a.spec.mjs',
        specs: [{ file: 'offline/a.spec.mjs', title: 'first', tests: tests('offline', 'offline-95') }],
        suites: [{
          title: '',
          specs: [{ file: 'offline/a.spec.mjs', title: 'untitled group', tests: tests('offline') }],
          suites: [{
            title: 'group',
            specs: [{ file: 'offline/a.spec.mjs', title: 'nested', tests: tests('offline') }]
          }]
        }]
      },
      {
        title: 'offline/b.spec.mjs',
        specs: [{ file: 'offline/b.spec.mjs', title: 'last', tests: tests('offline') }]
      }
    ]
  }

  expect(shardTestList(listed, 1, 2).split('\n')).toEqual([
    '[offline] › offline/a.spec.mjs › first',
    '[offline] › offline/a.spec.mjs › untitled group',
    '[offline] › offline/b.spec.mjs › last'
  ])
  expect(shardTestList(listed, 2, 2).split('\n')).toEqual([
    '[offline-95] › offline/a.spec.mjs › first',
    '[offline] › offline/a.spec.mjs › group › nested'
  ])

  for (const title of ['a › b', 'a\nb', ' a']) {
    listed.suites[1].specs[0].title = title
    expect(() => shardTestList(listed, 1, 2)).toThrow(`Test title cannot be used in a test list: "${title}"`)
  }
})

test('missing projects fail planning instead of silently losing test coverage', () => {
  expect(() => createShardMatrix(report({ offline: 1 }))).toThrow('No tests found for project offline-95')
})
