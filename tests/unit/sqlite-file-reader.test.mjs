import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { openSqliteDatabase, parseColumnNames } from '../../src/renderer/helpers/sqlite-file-reader.js'

/**
 * @param {string[]} statements
 * @param {(database: DatabaseSync) => void} [fill]
 */
async function createDatabase(statements, fill) {
  const directory = await mkdtemp(join(tmpdir(), 'sqlite-reader-'))
  try {
    const path = join(directory, 'test.db')
    const database = new DatabaseSync(path)
    for (const statement of statements) database.exec(statement)
    fill?.(database)
    database.close()
    return new Uint8Array(await readFile(path))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('reads rows across several levels of pages, overflow pages and later added columns', async () => {
  const longText = 'ä'.repeat(5000)
  const bytes = await createDatabase([
    'PRAGMA page_size = 1024',
    'CREATE TABLE `streams` (`uid` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `url` TEXT NOT NULL, `duration` INTEGER, `rating` REAL, `data` BLOB)',
    'CREATE INDEX `index_streams_url` ON `streams` (`url`)',
  ], database => {
    database.exec('BEGIN')
    const insert = database.prepare('INSERT INTO streams (url, duration, rating, data) VALUES (?, ?, ?, ?)')
    for (let i = 0; i < 20_000; i++) {
      insert.run(`url ${i}`, i === 1 ? -5 : i * 1_000_003, i / 4, i === 2 ? new Uint8Array([1, 2, 3]) : null)
    }
    database.exec('COMMIT')
    database.prepare('UPDATE streams SET url = ? WHERE uid = 3').run(longText)
    database.exec('ALTER TABLE streams ADD COLUMN `note` TEXT')
    database.prepare('INSERT INTO streams (url, duration, note) VALUES (?, ?, ?)').run('last', 2 ** 40, 'added')
  })

  const database = openSqliteDatabase(bytes)
  assert.equal(database.hasTable('streams'), true)
  assert.equal(database.hasTable('index_streams_url'), false)
  const rows = database.rows('streams')
  assert.equal(rows.length, 20_001)
  assert.deepEqual(rows.map(row => row.uid), Array.from({ length: 20_001 }, (_, index) => index + 1))
  assert.deepEqual(rows[0], { uid: 1, url: 'url 0', duration: 0, rating: 0, data: null, note: null })
  assert.equal(rows[1].duration, -5)
  assert.deepEqual(rows[2].data, new Uint8Array([1, 2, 3]))
  assert.equal(rows[2].url, longText)
  assert.equal(rows[19_999].duration, 19_999 * 1_000_003)
  assert.equal(rows[19_999].rating, 19_999 / 4)
  assert.deepEqual(rows[20_000], { uid: 20_001, url: 'last', duration: 2 ** 40, rating: null, data: null, note: 'added' })
})

test('reads UTF-16 databases', async () => {
  const bytes = await createDatabase([
    'PRAGMA encoding = "UTF-16le"',
    'CREATE TABLE search_history (id INTEGER PRIMARY KEY, search TEXT)',
    'INSERT INTO search_history (search) VALUES (\'日本語 query\')',
  ])
  assert.deepEqual(openSqliteDatabase(bytes).rows('search_history'), [{ id: 1, search: '日本語 query' }])
})

test('column names skip table constraints and know row ID columns', () => {
  assert.deepEqual(
    parseColumnNames('CREATE TABLE `stream_history` (`stream_id` INTEGER NOT NULL, "access date" INTEGER NOT NULL DEFAULT (1, 2), [count] INTEGER, PRIMARY KEY(`stream_id`, `access date`), FOREIGN KEY(`stream_id`) REFERENCES `streams`(`uid`))'),
    [{ name: 'stream_id', rowId: false }, { name: 'access date', rowId: false }, { name: 'count', rowId: false }]
  )
  // A single INTEGER primary key column stores the row ID, also when a table constraint names it
  assert.deepEqual(
    parseColumnNames('CREATE TABLE `stream_state` (`stream_id` INTEGER NOT NULL, `progress_time` INTEGER NOT NULL, PRIMARY KEY(`stream_id`))'),
    [{ name: 'stream_id', rowId: true }, { name: 'progress_time', rowId: false }]
  )
  assert.deepEqual(
    parseColumnNames('CREATE TABLE t (id INTEGER NOT NULL PRIMARY KEY, name TEXT PRIMARY KEY, reversed INTEGER PRIMARY KEY DESC)'),
    [{ name: 'id', rowId: true }, { name: 'name', rowId: false }, { name: 'reversed', rowId: false }]
  )
})

test('rejects files that are not SQLite databases', () => {
  assert.throws(() => openSqliteDatabase(new TextEncoder().encode('{"subscriptions":[]}'.padEnd(200))), /Not an SQLite database/)
})
