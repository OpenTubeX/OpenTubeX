import { test, expect } from '@playwright/test'
import { createShardMatrix, REPEAT_EACH, REPEAT_LIMIT } from '../../shards.mjs'
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

test('PR shards run every packed-app test but only changed network tests', () => {
  const { include } = createShardMatrix(full, report({ offline: 3, network: 2 }))
  expect(shardCounts(include)).toEqual({ offline: 16, performance: 3, browser: 1, network: 1 })
  expect(createShardMatrix(full, report({ offline: 3 })).include.some(shard => shard.project === 'network')).toBe(false)
})

test('PR shards repeat changed offline tests unless a shared change selects too many', () => {
  const repeat = changed => createShardMatrix(full, report(changed), 'all', true).include
    .filter(shard => shard.project === 'repeat')
  expect(repeat({ offline: 10, 'offline-95': 2, 'offline-125': 2, network: 2 })).toEqual([
    { project: 'repeat', projects: 'offline offline-95 offline-125', repeatEach: REPEAT_EACH, shard: 1, shardTotal: 1 }
  ])
  expect(repeat({ offline: REPEAT_LIMIT })).toHaveLength(REPEAT_EACH)
  expect(repeat({ offline: REPEAT_LIMIT + 1 })).toEqual([])
  expect(repeat({ network: 2 })).toEqual([])
  expect(createShardMatrix(full, report({ offline: 3 })).include.some(shard => shard.project === 'repeat')).toBe(false)
})

test('offline shards also run the scaled projects', () => {
  const offline = createShardMatrix(full).include.filter(shard => shard.project === 'offline')
  expect(offline).toHaveLength(16)
  expect(offline[0]).toEqual({ project: 'offline', projects: 'offline offline-95 offline-125', shard: 1, shardTotal: 16 })
})

test('offline dispatch includes performance and browser but excludes network tests', () => {
  const { include } = createShardMatrix(full, full, 'offline')
  expect([...new Set(include.map(shard => shard.project))]).toEqual(['offline', 'performance', 'browser'])
  expect(createShardMatrix(full, full, 'network')).toEqual({
    include: [
      { project: 'network', projects: 'network', shard: 1, shardTotal: 1 }
    ]
  })
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
