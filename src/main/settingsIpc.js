import { DBActions, IpcChannels, SyncEvents } from '../constants.js'
import { requireDatastoreIpcRequest, requireSettingRecord } from './datastoreIpc.js'

/**
 * @typedef {{ _id: string, value?: unknown }} SettingRecord
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   settings: typeof import('../datastores/handlers/base').settings,
 *   isTrustedUrl: (url: string) => boolean,
 *   syncOtherWindows: (channel: string, event: import('electron').IpcMainInvokeEvent, payload: unknown) => void,
 *   onSettingUpsert: (data: SettingRecord) => Promise<void>
 * }} SettingsIpcDependencies
 */

/** @param {SettingsIpcDependencies} dependencies */
export function registerSettingsIpc({ ipcMain, settings, isTrustedUrl, syncOtherWindows, onSettingUpsert }) {
  ipcMain.handle(IpcChannels.DB_SETTINGS, async (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    const { action, data } = requireDatastoreIpcRequest(payload)

    try {
      switch (action) {
        case DBActions.SETTINGS.MERGE_SEEN_VIDEOS: {
          const value = await settings.mergeSeenVideos(data)
          syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
            event: SyncEvents.GENERAL.UPSERT,
            data: { _id: 'subscriptionSeenVideos', value }
          })
          return value
        }

        case DBActions.SETTINGS.MERGE_SEEN_POSTS: {
          const value = await settings.mergeSeenPosts(data)
          syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
            event: SyncEvents.GENERAL.UPSERT,
            data: { _id: 'subscriptionSeenPosts', value }
          })
          return value
        }

        case DBActions.GENERAL.FIND:
          return await settings.find()

        case DBActions.GENERAL.UPSERT:
          requireSettingRecord(data)
          // Only CHOOSE_DEFAULT_FOLDER may set this path. Otherwise file IPC
          // could be directed to an arbitrary location.
          if (data._id === 'screenshotFolderPath') return null

          await settings.upsert(data._id, data.value)
          syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
            event: SyncEvents.GENERAL.UPSERT, data
          })
          await onSettingUpsert(data)
          return null

        case DBActions.GENERAL.DELETE:
          await settings.delete(data)
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid settings db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })
}
