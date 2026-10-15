package org.opentubex.app;

import android.content.Context;
import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One library datastore, stored with the bundled SQLite build. Its JSON
 * functions are needed by the shared schema, and its statements have no
 * CursorWindow limit for large rows such as sync snapshots.
 */
final class LibraryDatabase implements AutoCloseable {
    private static final Pattern NAME = Pattern.compile("[a-z0-9-]+");
    private static final int TYPE_INTEGER = 1;
    private static final int TYPE_FLOAT = 2;
    private static final int TYPE_TEXT = 3;
    private static final int TYPE_NULL = 5;

    private final File file;
    private final Map<String, SQLiteStatement> statements = new HashMap<>();
    private SQLiteConnection connection;

    LibraryDatabase(File directory, String name) {
        if (name == null || !NAME.matcher(name).matches()) throw new IllegalArgumentException("Invalid library name");
        file = new File(directory, "library-" + name + ".sqlite");
    }

    static File directory(Context context) {
        return context.getDatabasePath("library").getParentFile();
    }

    private SQLiteConnection open() {
        if (connection == null) {
            File directory = file.getParentFile();
            if (directory != null && !directory.isDirectory() && !directory.mkdirs()) {
                throw new IllegalStateException("Unable to create the library directory");
            }
            connection = new BundledSQLiteDriver().open(file.getPath());
            exec("PRAGMA busy_timeout = 5000");
            // Takes effect only before the first table exists.
            exec("PRAGMA auto_vacuum = INCREMENTAL");
            exec("PRAGMA journal_mode = WAL");
            // Every committed write survives power loss.
            exec("PRAGMA synchronous = FULL");
        }
        return connection;
    }

    private void exec(String sql) {
        try (SQLiteStatement statement = connection.prepare(sql)) {
            while (statement.step()) {
                // Consume rows returned by pragmas.
            }
        }
    }

    /** Runs statements in order; with {@code transaction}, all of them commit or none does. */
    synchronized JSONArray execute(JSONArray list, boolean transaction) throws JSONException {
        open();
        if (transaction) exec("BEGIN IMMEDIATE");
        try {
            JSONArray results = new JSONArray();
            for (int index = 0; index < list.length(); index++) {
                JSONArray entry = list.getJSONArray(index);
                results.put(run(entry.getString(0), entry.optJSONArray(1)));
            }
            if (transaction) exec("COMMIT");
            return results;
        } catch (RuntimeException | JSONException error) {
            if (transaction && connection.inTransaction()) exec("ROLLBACK");
            throw error;
        }
    }

    private JSONArray run(String sql, JSONArray params) throws JSONException {
        SQLiteStatement statement = statements.get(sql);
        if (statement == null) {
            statement = connection.prepare(sql);
            statements.put(sql, statement);
        }
        try {
            for (int index = 0; params != null && index < params.length(); index++) {
                bind(statement, index + 1, params.get(index));
            }
            JSONArray rows = new JSONArray();
            int columns = statement.getColumnCount();
            while (statement.step()) {
                JSONArray row = new JSONArray();
                for (int column = 0; column < columns; column++) {
                    switch (statement.getColumnType(column)) {
                        case TYPE_INTEGER: row.put(statement.getLong(column)); break;
                        case TYPE_FLOAT: row.put(statement.getDouble(column)); break;
                        case TYPE_TEXT: row.put(statement.getText(column)); break;
                        case TYPE_NULL: row.put(JSONObject.NULL); break;
                        default: throw new IllegalStateException("Unsupported library value");
                    }
                }
                rows.put(row);
            }
            return rows;
        } finally {
            statement.reset();
            statement.clearBindings();
        }
    }

    private static void bind(SQLiteStatement statement, int index, Object value) {
        if (value == null || value == JSONObject.NULL) {
            statement.bindNull(index);
        } else if (value instanceof String) {
            statement.bindText(index, (String) value);
        } else if (value instanceof Integer || value instanceof Long) {
            statement.bindLong(index, ((Number) value).longValue());
        } else if (value instanceof Number) {
            statement.bindDouble(index, ((Number) value).doubleValue());
        } else if (value instanceof Boolean) {
            statement.bindLong(index, (Boolean) value ? 1 : 0);
        } else {
            throw new IllegalArgumentException("Unsupported library parameter");
        }
    }

    /** Deletes the database files. */
    synchronized void drop() {
        close();
        for (String suffix : new String[]{"", "-wal", "-shm", "-journal"}) {
            File entry = new File(file.getPath() + suffix);
            if (entry.exists() && !entry.delete()) throw new IllegalStateException("Unable to delete the library");
        }
    }

    @Override
    public synchronized void close() {
        for (SQLiteStatement statement : statements.values()) statement.close();
        statements.clear();
        if (connection != null) connection.close();
        connection = null;
    }
}
