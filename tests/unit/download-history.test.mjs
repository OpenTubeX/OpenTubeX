import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const userData = await mkdtemp(join(tmpdir(), 'opentubex-download-history-'))
test.after(() => rm(userData, { recursive: true, force: true }))

const lockedFile = join(userData, 'locked.mp4')
const trashableFile = join(userData, 'trashable.mp4')
await writeFile(lockedFile, '')
await writeFile(trashableFile, '')

const oldCompletedRecords = Array.from({ length: 200 }, (_, index) => ({
  id: index + 1, title: `Completed ${index + 1}`, status: 'completed', destination: join(userData, `${index + 1}.mp4`),
}))
const failedRecords = Array.from({ length: 202 }, (_, index) => ({
  id: index + 201, title: `Failed ${index + 201}`, status: 'failed',
}))
const multiFileRecord = {
  id: 403, title: 'Two files', status: 'completed', destinations: [trashableFile, lockedFile],
}
await writeFile(join(userData, 'downloads.json'), JSON.stringify([...oldCompletedRecords, ...failedRecords, multiFileRecord]))

const broadcasts = []
// Each test checks only the broadcasts its own changes send.
test.beforeEach(() => { broadcasts.length = 0 })
const [downloads] = await importWithStubs([sourceUrl('src/main/ytDlpDownloads.js')], {
  electron: {
    app: { getPath: () => userData },
    powerMonitor: {},
    shell: {
      trashItem: async (path) => {
        if (path === lockedFile) throw new Error('EBUSY: resource busy or locked')
        await unlink(path)
      },
    },
  },
  [sourceUrl('src/datastores/handlers/base.js')]: { settings: { _findOne: async () => null } },
  [sourceUrl('src/main/utils.js')]: { isOpenTubeXUrl: () => true },
  [sourceUrl('src/main/trashPlatform.js')]: { shouldUseGioTrash: () => false },
  [sourceUrl('src/main/ytDlpBinaries.js')]: { broadcastToRenderers: (...args) => broadcasts.push(args) },
  [sourceUrl('src/main/ytDlpPlayback.js')]: {},
  [sourceUrl('src/main/ytDlpAutomaticDownloads.js')]: {},
}, {
  [sourceUrl('src/main/ytDlpBinaries.js')]: [
    'downloadManagedFfmpeg', 'downloadManagedYtDlp', 'prependJsRuntimeArgument', 'pushProxyArgument',
    'resolveExecutable', 'resolveFfprobeExecutable', 'ytDlpEnvironment',
  ],
  [sourceUrl('src/main/ytDlpPlayback.js')]: ['pushYtDlpPlaybackAuthenticationArguments'],
  [sourceUrl('src/main/ytDlpAutomaticDownloads.js')]: ['authorizeAutomaticDownload', 'showAutomaticDownloadNotification'],
})

const event = { senderFrame: { url: 'app://bundle/index.html' }, sender: { isFocused: () => true } }

test('keeps a download whose files could not all be moved to the trash', async () => {
  assert.equal(await downloads.handleYtDlpRemoveDownload(event, 403), false)

  assert.equal(existsSync(trashableFile), false)
  assert.equal(existsSync(lockedFile), true)
  const record = (await downloads.handleYtDlpListDownloads(event)).find(record => record.id === 403)
  assert.equal(record?.availability, 'partial')
  assert.deepEqual(broadcasts, [])
})

test('trims only the oldest failed, canceled, and skipped records from the saved history', async () => {
  await downloads.handleYtDlpClearDownloads(event, [402])
  await downloads.flushYtDlpDownloadRecords()

  const saved = JSON.parse(await readFile(join(userData, 'downloads.json'), 'utf8'))
  assert.deepEqual(
    saved.filter(record => record.status === 'completed').map(record => record.id),
    [...oldCompletedRecords.map(record => record.id), 403]
  )
  // Recent failures stay retryable however many downloads completed
  assert.deepEqual(
    saved.filter(record => record.status === 'failed').map(record => record.id),
    failedRecords.slice(1, -1).map(record => record.id)
  )
})
