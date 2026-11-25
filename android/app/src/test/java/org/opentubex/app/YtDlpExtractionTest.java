package org.opentubex.app;

import org.junit.Test;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public class YtDlpExtractionTest {
    @Test public void recognizesPartialExtractionTimeoutWarnings() {
        assertTrue(YtDlpRuntime.hasTimedOutWarning("WARNING: [youtube] video: Unable to download web client API page: The read operation timed out\n"));
        assertFalse(YtDlpRuntime.hasTimedOutWarning("WARNING: [youtube] video: Some formats are missing\n"));
        assertFalse(YtDlpRuntime.hasTimedOutWarning("WARNING: [youtube] video: The read operation timed out. Retrying (1/3)...\n"));
    }

    @Test public void remembersTimeoutWarningsAfterTrimmingStderr() {
        YtDlpRuntime.ErrorOutput errors = new YtDlpRuntime.ErrorOutput();
        errors.add("WARNING: [youtube] video: The read operation timed out");
        for (int index = 0; index < 2000; index++) errors.add("Unrelated output after the timeout warning");

        assertTrue(errors.timedOut);
        assertFalse(errors.message().contains("timed out"));
    }

    @Test public void timeoutStartsAfterWaitingForAnExtractionWorker() throws Exception {
        ExecutorService callers = Executors.newFixedThreadPool(3);
        CountDownLatch busy = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        try {
            for (int i = 0; i < 2; i++) callers.submit(() -> YtDlpRuntime.extract(() -> {
                busy.countDown();
                release.await();
                return "done";
            }, 5, TimeUnit.SECONDS));
            assertTrue(busy.await(2, TimeUnit.SECONDS));
            Future<String> queued = callers.submit(() -> YtDlpRuntime.extract(() -> " version \n", 100, TimeUnit.MILLISECONDS));
            // The queued operation gets its full timeout once a worker becomes free.
            assertThrows(TimeoutException.class, () -> queued.get(300, TimeUnit.MILLISECONDS));
            release.countDown();
            assertEquals("version", queued.get(2, TimeUnit.SECONDS));
        } finally { release.countDown(); callers.shutdownNow(); }
    }

    @Test public void timeoutInterruptsAnActiveExtraction() throws Exception {
        CountDownLatch stopped = new CountDownLatch(1);
        assertThrows(TimeoutException.class, () -> YtDlpRuntime.extract(() -> {
            try { new CountDownLatch(1).await(); return "unexpected"; }
            finally { stopped.countDown(); }
        }, 100, TimeUnit.MILLISECONDS));
        assertTrue(stopped.await(2, TimeUnit.SECONDS));
    }
}
