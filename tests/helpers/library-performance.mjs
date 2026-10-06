import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFunction } from 'node:vm'

import Datastore from '@seald-io/nedb'
import { createStore } from 'vuex'

import { migrateLegacyHistoryRecord } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import * as playlistCounts from '../../src/renderer/helpers/playlist-video-counts.js'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

async function readSource (root, file) {
  return readFile(path.join(root, file), 'utf8')
}

async function loadIdQuery (root) {
  try {
    return (await import(pathToFileURL(path.join(root, 'src/datastores/idQuery.js')))).createIdQuery
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
}

export async function playlistStore (root = repositoryRoot) {
  const source = (await readSource(root, 'src/renderer/store/modules/playlists.js'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default ', 'return ')
  const playlists = compileFunction(source, Object.keys(playlistCounts))(...Object.values(playlistCounts))
  return createStore({ modules: { playlists } })
}

export async function datastoreHandlers (root = repositoryRoot) {
  const db = Object.fromEntries(['history', 'playlists', 'recommendations', 'settings'].map(name => [
    name, new Datastore({ inMemoryOnly: true }),
  ]))
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const createIdQuery = await loadIdQuery(root)
  const recommendationSource = (await readSource(root, 'src/datastores/recommendations.js'))
    .replace(/^import[^\n]+\n/gm, '')
    .replace('export function ', 'function ')
  const createRecommendationStore = compileFunction(
    `${recommendationSource}\nreturn createRecommendationStore`, ['createIdQuery']
  )(createIdQuery)
  const recommendations = createRecommendationStore(db.recommendations, () => 'epoch')
  const source = await readSource(root, 'src/datastores/handlers/base.js')
  const historySource = source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass WatchStats {'))
  const playlistSource = source.slice(source.indexOf('class Playlists {'), source.indexOf('\nclass SearchHistory {'))
  const dependencies = { db, recommendations, createIdQuery, migrateLegacyHistoryRecord, ...seenVideos, HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated' }
  const { History, Playlists } = compileFunction(
    `${historySource}\n${playlistSource}\nreturn { History, Playlists }`,
    Object.keys(dependencies)
  )(...Object.values(dependencies))
  return { db, History, Playlists }
}
