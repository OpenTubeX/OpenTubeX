package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.sqlite.SQLiteFullException;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONException;
import org.junit.Test;

public class AndroidRecordStoreTest {
    @Test
    public void diskFullDoesNotCommitAnImportMarkerOrOverwriteExistingRecords() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String databaseName = "opentubex-disk-full-test.sqlite";
        context.deleteDatabase(databaseName);
        String small = "{\"_id\":\"retained\",\"value\":42}";
        String large = "{\"_id\":\"retained\",\"value\":\"" + "x".repeat(128000) + "\"}";
        try (AndroidRecordStore store = new AndroidRecordStore(context, databaseName)) {
            store.getWritableDatabase().setMaximumSize(10L * store.getWritableDatabase().getPageSize());
            try {
                store.write("history.db", large, true);
                fail("Import must reject SQLITE_FULL");
            } catch (SQLiteFullException expected) { }
            assertFalse(store.initialized("history.db"));
            assertEquals("", store.read("history.db"));

            store.getWritableDatabase().setMaximumSize(1000L * store.getWritableDatabase().getPageSize());
            store.write("history.db", small, true);
            store.getWritableDatabase().setMaximumSize(10L * store.getWritableDatabase().getPageSize());
            try {
                store.write("history.db", large, false);
                fail("Append must reject SQLITE_FULL");
            } catch (SQLiteFullException expected) { }
            assertEquals(small, store.read("history.db"));
            store.getWritableDatabase().setMaximumSize(1000L * store.getWritableDatabase().getPageSize());
            store.write("history.db", large, false);
            assertEquals(large, store.read("history.db"));
        } finally { context.deleteDatabase(databaseName); }
    }

    @Test
    public void readsUnicodeSyncSnapshotsLargerThanTheCursorWindow() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String databaseName = "opentubex-large-record-test.sqlite";
        context.deleteDatabase(databaseName);
        String record = "{\"_id\":\"syncServerSnapshot\",\"value\":\"" + "🦉漢".repeat(400000) + "\"}";
        try {
            try (AndroidRecordStore store = new AndroidRecordStore(context, databaseName)) {
                store.write("settings.db", record, true);
                assertEquals(record, store.read("settings.db"));
            }
            try (AndroidRecordStore store = new AndroidRecordStore(context, databaseName)) {
                assertEquals(record, store.read("settings.db"));
            }
        } finally { context.deleteDatabase(databaseName); }
    }

    @Test
    public void importsAtomicallyRollsBackFailedBatchesAndKeepsDeletionAcrossRestart() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String databaseName = "opentubex-records-test.sqlite";
        context.deleteDatabase(databaseName);
        try {
            try (AndroidRecordStore store = new AndroidRecordStore(context, databaseName)) {
                assertFalse(store.initialized("history.db"));
                try {
                    store.write("history.db", "{\"_id\":\"old\",\"value\":1}\nmalformed", true);
                    fail("Invalid import must fail");
                } catch (JSONException expected) { }
                assertFalse(store.initialized("history.db"));
                assertEquals("", store.read("history.db"));
                store.write("history.db", "{\"_id\":\"old\",\"value\":1}\n" +
                    "{\"_id\":\"old\",\"value\":2}\n{\"_id\":\"deleted\"}\n" +
                    "{\"_id\":\"deleted\",\"$$deleted\":true}\n" +
                    "{\"$$indexCreated\":{\"fieldName\":\"videoId\",\"unique\":true}}", true);
                assertTrue(store.initialized("history.db"));
                assertTrue(store.read("history.db").contains("\"value\":2"));
                assertFalse(store.read("history.db").contains("deleted"));
                try {
                    store.write("history.db", "{\"_id\":\"old\",\"value\":99}\nmalformed", false);
                    fail("Invalid append must fail");
                } catch (JSONException expected) { }
                assertTrue(store.read("history.db").contains("\"value\":2"));
                store.write("history.db", "{\"_id\":\"old\",\"value\":0}", true);
                assertTrue(store.read("history.db").contains("\"value\":2"));
                store.clear("history.db");
            }
            try (AndroidRecordStore reopened = new AndroidRecordStore(context, databaseName)) {
                assertTrue(reopened.initialized("history.db"));
                reopened.write("history.db", "{\"_id\":\"old\"}", true);
                assertEquals("", reopened.read("history.db"));
                reopened.write("history.db", "{\"_id\":\"new\",\"date\":{\"$$date\":1234}}", false);
                assertEquals("{\"_id\":\"new\",\"date\":{\"$$date\":1234}}", reopened.read("history.db"));
                reopened.write("history.db", "{\"_id\":\"new\",\"$$deleted\":true}", false);
                assertEquals("", reopened.read("history.db"));
            }
        } finally { context.deleteDatabase(databaseName); }
    }
}
