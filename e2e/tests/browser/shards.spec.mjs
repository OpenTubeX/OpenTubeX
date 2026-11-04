import { test, expect } from '@playwright/test'
import { createShardMatrix, REPEAT_EACH, REPEAT_LIMIT, shardTestList } from '../../shards.mjs'
import config from '../../playwright.config.mjs'

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

test('PR shards run browser checks and only changed network tests', () => {
  const pr = changed => shardCounts(createShardMatrix(full, report(changed), { event: 'pull_request' }).include)
  expect(pr({ network: 2 })).toEqual({ browser: 1, network: 1 })
  expect(pr({})).toEqual({ browser: 1 })
})

test('PR shards repeat changed offline tests unless a shared change selects too many', () => {
  const repeat = changed => createShardMatrix(full, report(changed), { event: 'pull_request' }).include
    .filter(shard => shard.project === 'repeat')
  expect(repeat({ offline: 10, 'offline-95': 2, 'offline-125': 2, network: 2 })).toEqual([
    { project: 'repeat', projects: 'offline offline-95 offline-125', repeatEach: REPEAT_EACH, shard: 1, shardTotal: 1 }
  ])
  expect(repeat({ offline: REPEAT_LIMIT })).toHaveLength(REPEAT_EACH)
  expect(repeat({ offline: REPEAT_LIMIT + 1 })).toEqual([])
  expect(repeat({ network: 2 })).toEqual([])
  expect(createShardMatrix(full, report({ offline: 3 })).include.some(shard => shard.project === 'repeat')).toBe(false)
})

test('development push shards run the offline suite at 100% UI scale and browser checks', () => {
  const { include } = createShardMatrix(full, full, { event: 'push' })
  expect(shardCounts(include)).toEqual({ offline: 16, browser: 1 })
  expect(include[0]).toEqual({ project: 'offline', projects: 'offline', shard: 1, shardTotal: 16 })
})

test('nightly shards run every project, and offline shards include the scaled projects', () => {
  const { include } = createShardMatrix(full)
  expect(shardCounts(include)).toEqual({ offline: 16, performance: 3, browser: 1, network: 1 })
  expect(include[0]).toEqual({ project: 'offline', projects: 'offline offline-95 offline-125', shard: 1, shardTotal: 16 })
})

test('offline dispatch includes performance and browser but excludes network tests', () => {
  const { include } = createShardMatrix(full, full, { event: 'workflow_dispatch', selectedProject: 'offline' })
  expect([...new Set(include.map(shard => shard.project))]).toEqual(['offline', 'performance', 'browser'])
  expect(createShardMatrix(full, full, { event: 'workflow_dispatch', selectedProject: 'network' })).toEqual({
    include: [
      { project: 'network', projects: 'network', shard: 1, shardTotal: 1 }
    ]
  })
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

  listed.suites[1].specs[0].title = 'a › b'
  expect(() => shardTestList(listed, 1, 2)).toThrow('Test title cannot be used in a test list: "a › b"')
})

test('missing projects fail planning instead of silently losing test coverage', () => {
  expect(() => createShardMatrix(report({ offline: 1 }))).toThrow('No tests found for project offline-95')
})

test('performance runs only tagged checks and *-performance files', () => {
  const performance = config.projects.find(project => project.name === 'performance')
  const offline = config.projects.find(project => project.name === 'offline')
  const selected = title => performance.grep.some(pattern => pattern.test(title))
  for (const title of [
    'offline/home-performance.spec.mjs > Home paints',
    'offline/tabs.spec.mjs > batches tab drag rendering @performance'
  ]) {
    expect(selected(title), title).toBe(true)
    expect(offline.grepInvert.some(pattern => pattern.test(title)), title).toBe(true)
  }
  for (const title of [
    'offline/performance-indicator-layout.spec.mjs > wraps badges',
    'offline/inline-mini-player-drag.spec.mjs > tablet swipe docks toward the bottom bar'
  ]) {
    expect(selected(title), title).toBe(false)
  }
})
