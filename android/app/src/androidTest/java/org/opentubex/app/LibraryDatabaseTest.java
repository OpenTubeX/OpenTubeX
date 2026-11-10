package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class LibraryDatabaseTest {
    private static JSONArray statement(String sql, Object... params) throws Exception {
        JSONArray values = new JSONArray();
        for (Object param : params) values.put(param == null ? JSONObject.NULL : param);
        return new JSONArray().put(sql).put(values);
    }

    private static JSONArray list(JSONArray... statements) {
        JSONArray list = new JSONArray();
        for (JSONArray statement : statements) list.put(statement);
        return list;
    }

    @Test
    public void storesTypedValuesLargeRowsAndRollsBackFailedTransactions() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "library-test");
        try (LibraryDatabase database = new LibraryDatabase(directory, "test")) {
            database.drop();
            database.execute(list(statement("CREATE TABLE docs (id PRIMARY KEY NOT NULL, data TEXT NOT NULL) WITHOUT ROWID")), true);
            // Larger than Android's default 2 MB CursorWindow.
            String large = "{\"v\":\"" + "x".repeat(5 * 1024 * 1024) + "\"}";
            database.execute(list(
                statement("INSERT INTO docs VALUES (?, ?)", "text", large),
                statement("INSERT INTO docs VALUES (?, ?)", 5, "{\"n\":1.5}"),
                statement("INSERT INTO docs VALUES (?, ?)", 1700000000000L, "{}")
            ), true);

            try {
                database.execute(list(
                    statement("INSERT INTO docs VALUES (?, ?)", "added", "{}"),
                    statement("INSERT INTO docs VALUES (?, ?)", 5, "duplicate")
                ), true);
                fail("A duplicate key must fail the transaction");
            } catch (RuntimeException expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("UNIQUE constraint failed"));
            }

            JSONArray rows = database.execute(list(
                statement("SELECT id, length(data), json_extract(data, '$.n') FROM docs ORDER BY typeof(id), id"),
                statement("SELECT data FROM docs WHERE id = ?", "text")
            ), false);
            JSONArray summary = rows.getJSONArray(0);
            assertEquals(3, summary.length());
            assertEquals(5L, summary.getJSONArray(0).getLong(0));
            assertEquals(1.5, summary.getJSONArray(0).getDouble(2), 0);
            assertEquals(1700000000000L, summary.getJSONArray(1).getLong(0));
            assertEquals("text", summary.getJSONArray(2).getString(0));
            assertTrue(summary.getJSONArray(2).isNull(2));
            assertEquals(large, rows.getJSONArray(1).getJSONArray(0).getString(0));
        }

        try (LibraryDatabase reopened = new LibraryDatabase(directory, "test")) {
            JSONArray rows = reopened.execute(list(statement("SELECT count(*) FROM docs")), false);
            assertEquals(3, rows.getJSONArray(0).getJSONArray(0).getInt(0));
            reopened.drop();
            assertFalse(new File(directory, "library-test.sqlite").exists());
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNamesOutsideTheLibraryDirectory() {
        new LibraryDatabase(new File("/tmp"), "../settings");
    }
}
