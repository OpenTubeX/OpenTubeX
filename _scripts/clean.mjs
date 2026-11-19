import { rm } from 'fs/promises'
import { join } from 'path'

const BUILD_PATH = join(import.meta.dirname, '..', 'build')
const DIST_PATH = join(import.meta.dirname, '..', 'dist')
// Development and E2E builds keep it, see persistentCache.js
const RSPACK_CACHE_PATH = join(import.meta.dirname, '..', 'node_modules', '.cache', 'rspack')

await Promise.all([
  rm(BUILD_PATH, { recursive: true, force: true }),
  rm(DIST_PATH, { recursive: true, force: true }),
  rm(RSPACK_CACHE_PATH, { recursive: true, force: true })
])
