// @ts-check
import { HISTORY_DESCRIPTION_MAX_LENGTH } from '../history.js'

const description = "json_extract(data, '$.description')"

// The SQLite options of each kind of datastore, see `SqliteDatastore`
export const DATASTORE_OPTIONS = {
  history: {
    // lastViewedPlaylistId keeps deleting a playlist from parsing the whole history
    indexes: ['videoId', 'lastViewedPlaylistId'],
    updates: [{
      // Shortens descriptions saved before history kept only their start.
      // Like capHistoryDescription, substr and length count code points.
      // Checking the whole document's length first spares short ones the parse.
      key: `historyDescriptions${HISTORY_DESCRIPTION_MAX_LENGTH}`,
      sql: `UPDATE docs SET data = json_set(data, '$.description', substr(${description}, 1, ${HISTORY_DESCRIPTION_MAX_LENGTH}))
        WHERE length(data) > ${HISTORY_DESCRIPTION_MAX_LENGTH} AND json_type(data, '$.description') = 'text'
          AND length(${description}) > ${HISTORY_DESCRIPTION_MAX_LENGTH}`,
    }],
  },
  playlists: { childField: 'videos' },
  'watch-stats': { indexes: ['date'] },
  'video-metadata-cache': { indexes: ['videoId'] },
}
