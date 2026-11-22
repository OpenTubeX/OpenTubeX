package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class LibraryDatabasePluginTest {
    private static final class RecordingCall extends PluginCall {
        final CountDownLatch rejected = new CountDownLatch(1);
        final AtomicReference<String> message = new AtomicReference<>();

        RecordingCall(String method) {
            super(null, "LibraryDatabase", "callback", method, new JSObject()
                .put("name", "history").put("statements", new JSArray()).put("sql", "SELECT 1"));
        }

        @Override public void reject(String msg, String code, Exception error, JSObject data) {
            message.set(msg);
            rejected.countDown();
        }
    }

    @Test public void rejectsCallsThatArriveFromTheWebViewAfterDestruction() throws Exception {
        LibraryDatabasePlugin plugin = new LibraryDatabasePlugin();
        // Create the database's executor; without a bridge, the queued statement fails.
        RecordingCall first = new RecordingCall("execute");
        plugin.execute(first);
        assertTrue(first.rejected.await(5, TimeUnit.SECONDS));

        plugin.handleOnDestroy();
        RecordingCall execute = new RecordingCall("execute");
        RecordingCall query = new RecordingCall("query");
        RecordingCall drop = new RecordingCall("drop");
        plugin.execute(execute);
        plugin.query(query);
        plugin.drop(drop);
        for (RecordingCall call : new RecordingCall[] { execute, query, drop }) {
            assertTrue(call.getMethodName(), call.rejected.await(5, TimeUnit.SECONDS));
            assertEquals("Library database closed", call.message.get());
        }
    }
}
