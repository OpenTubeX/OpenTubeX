package org.opentubex.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONException;
import org.json.JSONObject;

/** Essential app records live outside WebView's evictable storage buckets. */
final class AndroidRecordStore extends SQLiteOpenHelper {
    private static final int READ_CHUNK_CHARACTERS = 64 * 1024;
    AndroidRecordStore(Context context) {
        this(context, "opentubex-records.sqlite");
    }

    AndroidRecordStore(Context context, String databaseName) {
        super(context, databaseName, null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE files (filename TEXT PRIMARY KEY NOT NULL)");
        db.execSQL("CREATE TABLE records (filename TEXT NOT NULL, record_key TEXT NOT NULL, " +
            "contents TEXT NOT NULL, PRIMARY KEY (filename, record_key))");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported record store version");
    }

    synchronized boolean initialized(String filename) {
        return initialized(getReadableDatabase(), filename);
    }

    private boolean initialized(SQLiteDatabase db, String filename) {
        try (Cursor cursor = db.rawQuery("SELECT 1 FROM files WHERE filename = ?", new String[]{filename})) {
            return cursor.moveToFirst();
        }
    }

    synchronized String read(String filename) {
        SQLiteDatabase db = getReadableDatabase();
        StringBuilder contents = new StringBuilder();
        // Sync snapshots can be larger than Android's CursorWindow. Read the
        // first chunk of every record together, then finish only large records.
        try (Cursor cursor = db.rawQuery(
                "SELECT substr(contents, 1, " + READ_CHUNK_CHARACTERS + "), length(contents), record_key " +
                "FROM records WHERE filename = ? ORDER BY record_key", new String[]{filename})) {
            while (cursor.moveToNext()) {
                if (contents.length() > 0) contents.append('\n');
                contents.append(cursor.getString(0));
                long length = cursor.getLong(1);
                for (long offset = READ_CHUNK_CHARACTERS + 1L; offset <= length; offset += READ_CHUNK_CHARACTERS) {
                    try (Cursor chunk = db.rawQuery("SELECT substr(contents, ?, ?) FROM records " +
                            "WHERE filename = ? AND record_key = ?", new String[]{Long.toString(offset),
                            Integer.toString(READ_CHUNK_CHARACTERS), filename, cursor.getString(2)})) {
                        if (!chunk.moveToFirst()) throw new IllegalStateException("App record disappeared during read");
                        contents.append(chunk.getString(0));
                    }
                }
            }
        }
        return contents.toString();
    }

    synchronized void write(String filename, String contents, boolean importing) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        Exception failure = null;
        try {
            boolean initialized = initialized(db, filename);
            if (importing && initialized) return;
            if (!importing && !initialized) throw new IllegalStateException("Record store has not been imported");
            for (String line : contents.split("\n")) {
                if (line.isEmpty()) continue;
                JSONObject record = new JSONObject(line);
                String key;
                boolean deleted;
                if (record.has("_id")) {
                    key = "document:" + record.getString("_id");
                    deleted = record.optBoolean("$$deleted");
                } else if (record.has("$$indexCreated")) {
                    key = "index:" + record.getJSONObject("$$indexCreated").getString("fieldName");
                    deleted = false;
                } else if (record.has("$$indexRemoved")) {
                    key = "index:" + record.getString("$$indexRemoved");
                    deleted = true;
                } else {
                    continue;
                }
                if (deleted) {
                    db.delete("records", "filename = ? AND record_key = ?", new String[]{filename, key});
                } else {
                    db.execSQL("INSERT OR REPLACE INTO records (filename, record_key, contents) VALUES (?, ?, ?)",
                        new Object[]{filename, key, line});
                }
            }
            if (importing) {
                ContentValues values = new ContentValues();
                values.put("filename", filename);
                db.insertOrThrow("files", null, values);
            }
            db.setTransactionSuccessful();
        } catch (JSONException | RuntimeException error) {
            failure = error;
            throw error;
        } finally {
            try {
                db.endTransaction();
            } catch (RuntimeException error) {
                // SQLITE_FULL can roll back automatically before Android tries
                // to end the transaction. Preserve the original write failure.
                if (failure == null) throw error;
                failure.addSuppressed(error);
            }
        }
    }

    synchronized void clear(String filename) {
        // Retain the import marker so deletion cannot resurrect old WebView data.
        getWritableDatabase().delete("records", "filename = ?", new String[]{filename});
    }
}
