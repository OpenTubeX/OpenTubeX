package org.opentubex.app;

import static org.junit.Assert.*;

import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class SearchMetadataDeadlineTest {
    @Test public void deadlineInterruptsRunningExtraction() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        try {
            YtDlpRuntime.extractBeforeDeadline(() -> {
                started.countDown();
                try { new CountDownLatch(1).await(); }
                finally { interrupted.countDown(); }
                return "unreachable";
            }, SystemClock.elapsedRealtime() + 500);
            fail("Expected metadata deadline");
        } catch (TimeoutException expected) {
            assertEquals("Extraction started", 0, started.getCount());
            assertTrue("Native extraction was interrupted", interrupted.await(3, TimeUnit.SECONDS));
        }
    }

    @Test public void expiredRuntimeQueueEntryNeverRuns() throws Exception {
        var field = YtDlpRuntime.class.getDeclaredField("EXTRACTORS");
        field.setAccessible(true);
        ExecutorService executor = (ExecutorService) field.get(null);
        CountDownLatch release = new CountDownLatch(1);
        List<Future<?>> blockers = occupy(executor, 2, release);
        AtomicBoolean ran = new AtomicBoolean();
        try {
            try {
                YtDlpRuntime.extractBeforeDeadline(() -> { ran.set(true); return "obsolete"; },
                    SystemClock.elapsedRealtime() + 50);
                fail("Expected queued metadata deadline");
            } catch (TimeoutException expected) { /* Includes time queued in the native runtime. */ }
            release.countDown();
            for (Future<?> blocker : blockers) blocker.get(3, TimeUnit.SECONDS);
            executor.submit(() -> {}).get(3, TimeUnit.SECONDS);
            assertFalse("Expired queued extraction was cancelled", ran.get());
        } finally {
            release.countDown();
            for (Future<?> blocker : blockers) blocker.cancel(true);
        }
    }

    @Test public void expiredPluginQueueEntryIsRejectedBeforeExtraction() throws Exception {
        YtDlpPlugin plugin = new YtDlpPlugin();
        var field = YtDlpPlugin.class.getDeclaredField("executor");
        field.setAccessible(true);
        ExecutorService executor = (ExecutorService) field.get(plugin);
        CountDownLatch release = new CountDownLatch(1);
        List<Future<?>> blockers = occupy(executor, 3, release);
        CompletableFuture<String> result = new CompletableFuture<>();
        PluginCall call = new PluginCall(null, "YtDlp", "test", "extract",
            new JSObject().put("timeoutMs", 50).put("args", new JSArray())) {
            @Override public void resolve(JSObject value) { result.complete("unexpected success"); }
            @Override public void reject(String message) { result.complete(message); }
        };
        try {
            plugin.extract(call);
            SystemClock.sleep(100);
            release.countDown();
            assertEquals("Extraction deadline expired", result.get(3, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            for (Future<?> blocker : blockers) blocker.cancel(true);
            executor.shutdownNow();
        }
    }

    private static List<Future<?>> occupy(ExecutorService executor, int count, CountDownLatch release) throws Exception {
        CountDownLatch started = new CountDownLatch(count);
        List<Future<?>> blockers = new ArrayList<>();
        for (int index = 0; index < count; index++) blockers.add(executor.submit(() -> {
            started.countDown();
            release.await();
            return null;
        }));
        assertTrue("Native worker queue occupied", started.await(3, TimeUnit.SECONDS));
        return blockers;
    }
}
