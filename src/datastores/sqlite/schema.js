export const LIBRARY_SCHEMA_VERSION = 1
export const LIBRARY_FILE_NAME = 'library.sqlite'

export const COLLECTIONS = {
  settings: 'settings',
  profiles: 'profiles',
  playlists: 'playlists',
  history: 'history',
  watchStats: 'watch-stats',
  recommendations: 'recommendations',
  searchHistory: 'search-history',
  subscriptionCache: 'subscription-cache',
  tabSession: 'tab-session',
  liveReminders: 'live-reminders',
  videoMetadataCache: 'video-metadata-cache',
}

export const ARRAY_FIELDS = {
  playlists: ['videos'],
  subscriptionCache: ['videos', 'liveStreams', 'shorts', 'communityPosts'],
}

// Keep unknown document fields and NeDB's date encoding. Membership is stored
// separately so a metadata edit never reads or rewrites a playlist's members.
export const SCHEMA_SQL = `
  CREATE TABLE records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)),
    video_id TEXT,
    sort_time REAL NOT NULL DEFAULT 0,
    continue_candidate INTEGER NOT NULL DEFAULT 0,
    unwatched_candidate INTEGER NOT NULL DEFAULT 0,
    watchable_after REAL,
    repair_candidate INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(collection, id)
  ) WITHOUT ROWID;
  CREATE INDEX records_video ON records(collection, video_id);
  CREATE INDEX records_video_time ON records(collection, video_id, sort_time DESC, id DESC);
  CREATE INDEX records_time ON records(collection, sort_time DESC, id DESC);
  CREATE INDEX records_continue ON records(collection, continue_candidate, sort_time DESC, id DESC);
  CREATE INDEX records_unwatched ON records(collection, unwatched_candidate, watchable_after);
  CREATE INDEX records_repair ON records(collection, repair_candidate, id);
  CREATE INDEX records_date ON records(collection, json_extract(data, '$."date"')) WHERE json_type(data, '$."date"') IS NOT NULL;
  CREATE INDEX records_date_type ON records(collection, json_type(data, '$."date"')) WHERE json_type(data, '$."date"') IS NOT NULL;
  CREATE TABLE metadata_order (
    sequence INTEGER PRIMARY KEY,
    collection TEXT NOT NULL CHECK(collection = 'videoMetadataCache'),
    record_id TEXT NOT NULL,
    video_id TEXT,
    sort_time REAL NOT NULL,
    UNIQUE(collection, record_id),
    FOREIGN KEY(collection, record_id) REFERENCES records(collection, id) ON DELETE CASCADE
  );
  CREATE INDEX metadata_order_video_time ON metadata_order(video_id, sort_time DESC, sequence DESC);
  CREATE TRIGGER metadata_order_insert AFTER INSERT ON records
    WHEN NEW.collection = 'videoMetadataCache' BEGIN
      INSERT INTO metadata_order(collection, record_id, video_id, sort_time) VALUES (NEW.collection, NEW.id, NEW.video_id, NEW.sort_time);
  END;
  CREATE TRIGGER metadata_order_update AFTER UPDATE OF video_id, sort_time ON records
    WHEN NEW.collection = 'videoMetadataCache' AND (NEW.video_id IS NOT OLD.video_id OR NEW.sort_time IS NOT OLD.sort_time) BEGIN
      UPDATE metadata_order SET video_id = NEW.video_id, sort_time = NEW.sort_time
        WHERE collection = NEW.collection AND record_id = NEW.id;
  END;
  CREATE TABLE collection_counts (collection TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
  CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN
    INSERT INTO collection_counts(collection, count, bytes) VALUES (NEW.collection, 1, length(CAST(NEW.data AS BLOB)))
      ON CONFLICT(collection) DO UPDATE SET count = count + 1, bytes = bytes + excluded.bytes;
  END;
  CREATE TRIGGER records_delete AFTER DELETE ON records BEGIN
    UPDATE collection_counts SET count = count - 1, bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE collection = OLD.collection;
  END;
  CREATE TRIGGER records_update AFTER UPDATE OF data ON records BEGIN
    UPDATE collection_counts SET bytes = bytes + length(CAST(NEW.data AS BLOB)) - length(CAST(OLD.data AS BLOB)) WHERE collection = NEW.collection;
  END;
  CREATE TABLE record_arrays (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    field TEXT NOT NULL,
    length INTEGER NOT NULL DEFAULT 0 CHECK(length >= 0),
    next_position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(collection, record_id, field),
    FOREIGN KEY(collection, record_id) REFERENCES records(collection, id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE TABLE members (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    field TEXT NOT NULL,
    position INTEGER NOT NULL,
    membership_id TEXT NOT NULL,
    item_id TEXT,
    video_id TEXT,
    data TEXT NOT NULL CHECK(json_valid(data)),
    created_at REAL NOT NULL DEFAULT 0,
    PRIMARY KEY(collection, record_id, field, position),
    UNIQUE(collection, membership_id),
    FOREIGN KEY(collection, record_id, field) REFERENCES record_arrays(collection, record_id, field) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE INDEX members_video ON members(collection, video_id, record_id, field);
  CREATE INDEX members_item ON members(collection, record_id, field, item_id);
  CREATE TRIGGER members_insert AFTER INSERT ON members BEGIN
    UPDATE collection_counts SET bytes = bytes + length(CAST(NEW.data AS BLOB)) WHERE collection = NEW.collection;
    UPDATE record_arrays SET length = length + 1,
      next_position = max(next_position, NEW.position + 1)
      WHERE collection = NEW.collection AND record_id = NEW.record_id AND field = NEW.field;
  END;
  CREATE TRIGGER members_delete AFTER DELETE ON members BEGIN
    UPDATE collection_counts SET bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE collection = OLD.collection;
    UPDATE record_arrays SET length = length - 1
      WHERE collection = OLD.collection AND record_id = OLD.record_id AND field = OLD.field;
  END;
  CREATE TRIGGER members_update AFTER UPDATE OF data ON members BEGIN
    UPDATE collection_counts SET bytes = bytes + length(CAST(NEW.data AS BLOB)) - length(CAST(OLD.data AS BLOB)) WHERE collection = NEW.collection;
  END;
  CREATE TABLE record_blobs (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    field TEXT NOT NULL,
    data TEXT NOT NULL,
    digest TEXT NOT NULL,
    PRIMARY KEY(collection, record_id, field),
    FOREIGN KEY(collection, record_id) REFERENCES records(collection, id) ON DELETE CASCADE
  );
  CREATE TRIGGER blobs_insert AFTER INSERT ON record_blobs BEGIN
    UPDATE collection_counts SET bytes = bytes + length(CAST(NEW.data AS BLOB)) WHERE collection = NEW.collection;
  END;
  CREATE TRIGGER blobs_delete AFTER DELETE ON record_blobs BEGIN
    UPDATE collection_counts SET bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE collection = OLD.collection;
  END;
  CREATE TRIGGER blobs_update AFTER UPDATE OF data ON record_blobs BEGIN
    UPDATE collection_counts SET bytes = bytes + length(CAST(NEW.data AS BLOB)) - length(CAST(OLD.data AS BLOB)) WHERE collection = NEW.collection;
  END;
  CREATE TABLE revisions (
    collection TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;
  CREATE TABLE search_characters (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    character TEXT NOT NULL,
    PRIMARY KEY(collection, character, record_id),
    FOREIGN KEY(collection, record_id) REFERENCES records(collection, id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE INDEX search_characters_record ON search_characters(collection, record_id);
  CREATE TABLE migration_sources (
    collection TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    offset INTEGER NOT NULL DEFAULT 0,
    lines INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION};
`
