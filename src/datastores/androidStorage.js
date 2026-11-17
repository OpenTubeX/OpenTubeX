import { createAndroidRecordStorage } from './androidRecordStorage.js'
import { registerPlugin } from '@capacitor/core'

const storage = createAndroidRecordStorage(indexedDB, process.env.IS_IOS ? null : registerPlugin('AndroidStorage'))
export const { readFileAsync, appendFileAsync, unlinkAsync, removeDocumentsAsync, readRetainedAsync, crashSafeWriteFileLinesAsync, existsAsync, ensureDatafileIntegrityAsync, ensureParentDirectoryExistsAsync } = storage
