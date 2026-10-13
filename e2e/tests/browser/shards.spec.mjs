import { test, expect } from '@playwright/test'
import { createShardMatrix } from '../../shards.mjs'
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

const full = report({ offline: 3366, performance: 204, browser: 25, network: 70 })

test('PR shards use changed counts while retaining all performance and mobile storage checks', () => {
  expect(createShardMatrix(full, report({ offline: 3 }))).toEqual({
    include: [
      { project: 'offline', shard: 1, shardTotal: 1 },
      { project: 'performance', shard: 1, shardTotal: 5 },
      { project: 'performance', shard: 2, shardTotal: 5 },
      { project: 'performance', shard: 3, shardTotal: 5 },
      { project: 'performance', shard: 4, shardTotal: 5 },
      { project: 'performance', shard: 5, shardTotal: 5 },
      { project: 'browser', shard: 1, shardTotal: 1 }
    ]
  })
})

test('full runs retain every project and cap large suites at 16 shards', () => {
  const { include } = createShardMatrix(full)
  expect(include.filter(shard => shard.project === 'offline')).toHaveLength(16)
  expect(include.filter(shard => shard.project === 'performance')).toHaveLength(5)
  expect(include.filter(shard => shard.project === 'browser')).toHaveLength(1)
  expect(include.filter(shard => shard.project === 'network')).toHaveLength(1)
})

test('offline dispatch includes performance and browser but excludes network tests', () => {
  const { include } = createShardMatrix(full, full, 'offline')
  expect([...new Set(include.map(shard => shard.project))]).toEqual(['offline', 'performance', 'browser'])
  expect(createShardMatrix(full, full, 'network')).toEqual({
    include: [
      { project: 'network', shard: 1, shardTotal: 1 }
    ]
  })
})

test('missing projects fail planning instead of silently losing test coverage', () => {
  expect(() => createShardMatrix(report({ offline: 1 }))).toThrow('No tests found for project performance')
})

test('packed-app functional regressions retain always-run performance coverage', () => {
  const performance = config.projects.find(project => project.name === 'performance')
  for (const file of [
    'channel-settings-pagination', 'fullscreen-docks', 'inline-mini-player-drag',
    'scrollbar-overlay', 'utility-window-close', 'performance-indicator-layout'
  ]) {
    const title = `offline/${file}.spec.mjs > functional regression`
    expect(performance.grep.some(pattern => pattern.test(title)), file).toBe(true)
  }
})
