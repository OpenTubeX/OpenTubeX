package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshResultStoreTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final File directory = new File(context.getFilesDir(), "subscription-refresh-results");
    private final String profileId = "store-test-" + UUID.randomUUID();
    private final String slotName = UUID.nameUUIDFromBytes(
        (profileId + "\nvideos\nUCchannel").getBytes(StandardCharsets.UTF_8)
    ).toString();
    private final File resultFile = new File(directory, slotName + ".json");

    @After
    public void deleteSlot() {
        resultFile.delete();
        new File(directory, slotName + ".fingerprint").delete();
    }

    private static JSONObject payload(String title, String tracking) throws Exception {
        return new JSONObject().put("backgroundFormat", "local").put("data", new JSONObject()
            .put("responseContext", new JSONObject().put("visitorData", tracking))
            .put("contents", new JSONObject().put("title", title).put("trackingParams", tracking)));
    }

    private void write(JSONObject payload, long timestamp) throws Exception {
        SubscriptionRefreshResultStore.writeChannel(context, profileId, "videos", "UCchannel", payload, timestamp);
    }

    private JSONObject saved() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(resultFile.toPath()), StandardCharsets.UTF_8));
    }

    @Test
    public void unchangedFeedsAreNotQueuedAgainForImport() throws Exception {
        write(payload("Video", "first"), 1000);
        JSONObject pending = saved();

        write(payload("Video", "second"), 2000);
        assertEquals("an unchanged pending result keeps its place in the import queue",
            pending.getString("id"), saved().getString("id"));
        assertEquals(1000, saved().getLong("timestamp"));

        assertTrue(SubscriptionRefreshResultStore.acknowledge(context, pending.getString("id")));
        write(payload("Video", "third"), 3000);
        assertFalse("an imported unchanged feed is not imported again", resultFile.exists());

        write(payload("Renamed video", "fourth"), 4000);
        assertEquals(4000, saved().getLong("timestamp"));
        assertEquals("Renamed video", saved().getJSONObject("payload").getJSONObject("data")
            .getJSONObject("contents").getString("title"));
    }

    @Test
    public void clearingAChannelsCacheQueuesItsUnchangedFeedAgain() throws Exception {
        write(payload("Video", "first"), 1000);
        assertTrue(SubscriptionRefreshResultStore.acknowledge(context, saved().getString("id")));

        SubscriptionRefreshResultStore.forgetFingerprints(context, Collections.singleton("UCother"));
        write(payload("Video", "second"), 2000);
        assertFalse("another channel's cache clear keeps this fingerprint", resultFile.exists());

        SubscriptionRefreshResultStore.forgetFingerprints(context, Collections.singleton("UCchannel"));
        write(payload("Video", "third"), 3000);
        assertEquals(3000, saved().getLong("timestamp"));

        assertTrue(SubscriptionRefreshResultStore.acknowledge(context, saved().getString("id")));
        SubscriptionRefreshResultStore.forgetFingerprints(context, null);
        write(payload("Video", "fourth"), 4000);
        assertEquals("clearing the whole cache forgets every fingerprint", 4000, saved().getLong("timestamp"));
    }

    @Test
    public void openingTheStoreDeletesInterruptedWrites() throws Exception {
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File interrupted = new File(directory, "0000000000000-" + UUID.randomUUID() + ".tmp");
        Files.write(interrupted.toPath(), "{\"partial\":".getBytes(StandardCharsets.UTF_8));
        // The index is built once per process; rebuild it as a fresh process would.
        Field index = SubscriptionRefreshResultStore.class.getDeclaredField("index");
        index.setAccessible(true);
        synchronized (SubscriptionRefreshResultStore.class) { index.set(null, null); }

        SubscriptionRefreshResultStore.readNext(context);
        assertFalse(interrupted.exists());
    }
}
