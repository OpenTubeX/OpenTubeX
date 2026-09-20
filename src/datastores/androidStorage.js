import { createAndroidRecordStorage } from './androidRecordStorage.js'

const storage = createAndroidRecordStorage()
export const { readFileAsync, appendFileAsync, unlinkAsync, crashSafeWriteFileLinesAsync, existsAsync, ensureDatafileIntegrityAsync, ensureParentDirectoryExistsAsync } = storage
