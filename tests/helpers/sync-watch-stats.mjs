import { readFileSync } from 'node:fs'
import { compileFunction } from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/sync-watch-stats.js', import.meta.url), 'utf8')
export const createWatchStatsHelpers = compileFunction(
  source.replace(/^import .*\n/gm, '').replaceAll('export ', '') +
    '\nreturn { createWatchStatsReset, containsWatchStatsDevice, mergeWatchStats, replaceWatchStatsDevice, syncWatchStats, watchStatsDeviceDays, watchSecondsForDevice }',
  ['DBWatchStatsHandlers', 'getCurrentSyncServerDeviceInfo']
)
