package org.opentubex.app;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidPerformanceTest {
    @Test public void slowAvailabilityLookupDoesNotBlockControlsOrReturnObsoleteState() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "availability-test-" + UUID.randomUUID());
        assertTrue(directory.mkdirs());
        JSONObject record = new JSONObject().put("id", 1).put("status", "paused").put("queuePosition", 1)
            .put("destinations", new JSONArray().put("content://test/video"))
            .put("files", new JSONArray().put(new JSONObject().put("path", "content://test/video")));
        YtDlpFiles.write(new File(directory, "yt-dlp-downloads.json"),
            new JSONObject().put("records", new JSONArray().put(record)).toString().getBytes(StandardCharsets.UTF_8));
        YtDlpDownloads queue = new YtDlpDownloads(context, directory, () -> {});
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch checking = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger queries = new java.util.concurrent.atomic.AtomicInteger();
        try {
            Future<JSONArray> listing = executor.submit(() -> queue.list(path -> {
                assertFalse("Provider calls must not hold the queue monitor", Thread.holdsLock(queue));
                queries.incrementAndGet();
                checking.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException error) { throw new AssertionError(error); }
                return true;
            }));
            assertTrue(checking.await(5, TimeUnit.SECONDS));
            Future<Boolean> resumed = executor.submit(() -> queue.control(1, "resume", 0));
            assertTrue("Controls complete while provider lookup is blocked", resumed.get(2, TimeUnit.SECONDS));
            release.countDown();
            JSONObject snapshot = listing.get(5, TimeUnit.SECONDS).getJSONObject(0);
            assertEquals("queued", snapshot.getString("status"));
            assertEquals("available", snapshot.getString("availability"));
            assertEquals(1, queries.get());
            assertEquals("queued", queue.list(path -> true).getJSONObject(0).getString("status"));
        } finally {
            release.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
            YtDlpFiles.deleteTree(directory);
        }
    }

}
