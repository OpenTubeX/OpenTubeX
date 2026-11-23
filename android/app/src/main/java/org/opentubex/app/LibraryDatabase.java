package org.opentubex.app;

import android.content.Context;
import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
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
            try {
                exec("PRAGMA busy_timeout = 5000");
                // Persistent settings apply only to a database this version is
                // creating, so a newer version's database stays untouched.
                if (userVersion() == 0) {
                    // Takes effect only before the first table exists. Switching to the
                    // write-ahead log rewrites and syncs this header, so skip its own sync.
                    exec("PRAGMA synchronous = OFF");
                    exec("PRAGMA auto_vacuum = INCREMENTAL");
                    exec("PRAGMA synchronous = FULL");
                    exec("PRAGMA journal_mode = WAL");
                }
                // Every committed write survives power loss.
                exec("PRAGMA synchronous = FULL");
            } catch (RuntimeException error) {
                // Never keep a connection without its durability settings.
                close();
                throw error;
            }
        }
        return connection;
    }

    private long userVersion() {
        try (SQLiteStatement statement = connection.prepare("PRAGMA user_version")) {
            return statement.step() ? statement.getLong(0) : 0;
        }
    }

    private void exec(String sql) {
        try (SQLiteStatement statement = connection.prepare(sql)) {
            while (statement.step()) {
                // Consume rows returned by pragmas.
            }
        }
    }

    synchronized void warm() {
        open();
    }

    /** Runs statements in order; with {@code transaction}, all of them commit or none does. */
    synchronized JSONArray execute(JSONArray list, boolean transaction) throws JSONException {
        open();
        if (transaction) exec("BEGIN IMMEDIATE");
        try {
            JSONArray results = new JSONArray();
            for (int index = 0; index < list.length(); index++) {
                JSONArray entry = list.getJSONArray(index);
                // A missing parameter list is allowed; any other value is a malformed call.
                JSONArray params = entry.length() > 1 ? entry.getJSONArray(1) : null;
                results.put(run(entry.getString(0), params));
            }
            if (transaction) exec("COMMIT");
            return results;
        } catch (RuntimeException | JSONException error) {
            if (transaction && connection.inTransaction()) exec("ROLLBACK");
            throw error;
        }
    }

    private static final String DATE_KEY = "\"$$date\"";
    private static final byte[] NULL = "null".getBytes(StandardCharsets.UTF_8);

    /**
     * Streams one statement's rows as a JSON array of row arrays. Text in
     * {@code documentColumn} is a stored document's JSON and is copied as that
     * JSON rather than as a string, so neither side escapes or parses it twice.
     * Documents with NeDB dates stay strings, because only parsing their text
     * restores the dates.
     */
    synchronized void query(String sql, JSONArray params, int documentColumn, OutputStream output) throws JSONException, IOException {
        open();
        SQLiteStatement statement = prepare(sql, params);
        try {
            output.write('[');
            int columns = statement.getColumnCount();
            boolean firstRow = true;
            while (statement.step()) {
                if (!firstRow) output.write(',');
                firstRow = false;
                output.write('[');
                for (int column = 0; column < columns; column++) {
                    if (column > 0) output.write(',');
                    switch (statement.getColumnType(column)) {
                        case TYPE_INTEGER: writeAscii(output, Long.toString(statement.getLong(column))); break;
                        case TYPE_FLOAT: writeDouble(output, statement.getDouble(column)); break;
                        case TYPE_TEXT: {
                            // The stored UTF-8 bytes, without decoding them into a Java string.
                            byte[] text = statement.getBlob(column);
                            if (column == documentColumn && !hasDate(text)) {
                                output.write(text);
                            } else {
                                writeString(output, new String(text, StandardCharsets.UTF_8));
                            }
                            break;
                        }
                        case TYPE_NULL: output.write(NULL); break;
                        default: throw new IllegalStateException("Unsupported library value");
                    }
                }
                output.write(']');
            }
            output.write(']');
        } finally {
            statement.reset();
            statement.clearBindings();
        }
    }

    /**
     * Whether the document has a NeDB date. Reading the UTF-8 bytes as Latin-1
     * keeps the search in the runtime's native string code; the key is ASCII.
     */
    private static boolean hasDate(byte[] text) {
        return new String(text, StandardCharsets.ISO_8859_1).contains(DATE_KEY);
    }

    private static void writeAscii(OutputStream output, String text) throws IOException {
        output.write(text.getBytes(StandardCharsets.US_ASCII));
    }

    private static void writeDouble(OutputStream output, double value) throws IOException {
        if (Double.isNaN(value) || Double.isInfinite(value)) throw new IllegalStateException("Unsupported library value");
        writeAscii(output, Double.toString(value));
    }

    /** Writes text as a JSON string. */
    static void writeString(OutputStream output, String text) throws IOException {
        StringBuilder json = new StringBuilder(text.length() + 16).append('"');
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            switch (character) {
                case '"': json.append("\\\""); break;
                case '\\': json.append("\\\\"); break;
                case '\n': json.append("\\n"); break;
                case '\r': json.append("\\r"); break;
                case '\t': json.append("\\t"); break;
                default:
                    if (character < 0x20 || character == '\u2028' || character == '\u2029') {
                        json.append(String.format(Locale.ROOT, "\\u%04x", (int) character));
                    } else {
                        json.append(character);
                    }
            }
        }
        output.write(json.append('"').toString().getBytes(StandardCharsets.UTF_8));
    }

    private SQLiteStatement prepare(String sql, JSONArray params) throws JSONException {
        SQLiteStatement statement = statements.get(sql);
        if (statement == null) {
            statement = connection.prepare(sql);
            statements.put(sql, statement);
        }
        try {
            for (int index = 0; params != null && index < params.length(); index++) {
                bind(statement, index + 1, params.get(index));
            }
        } catch (RuntimeException | JSONException error) {
            statement.clearBindings();
            throw error;
        }
        return statement;
    }

    private JSONArray run(String sql, JSONArray params) throws JSONException {
        SQLiteStatement statement = prepare(sql, params);
        try {
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
