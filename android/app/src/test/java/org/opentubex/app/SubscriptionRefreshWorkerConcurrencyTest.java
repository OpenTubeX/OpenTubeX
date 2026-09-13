package org.opentubex.app;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class SubscriptionRefreshWorkerConcurrencyTest {
    @Test
    public void nextFeedAndCancellationShareTheNotificationMonitor() throws Exception {
        assertUsesNotificationMonitor(() ->
            SubscriptionRefreshWorker.startNextFeed(null, "inactive", "Refresh", "Cancel"));
        assertUsesNotificationMonitor(() -> SubscriptionRefreshWorker.cancel(null, "inactive"));
    }

    private static void assertUsesNotificationMonitor(Runnable action) throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        CountDownLatch started = new CountDownLatch(1);
        Future<?> operation;
        try {
            synchronized (SubscriptionRefreshWorker.class) {
                operation = executor.submit(() -> {
                    started.countDown();
                    action.run();
                });
                assertTrue(started.await(5, TimeUnit.SECONDS));
                try {
                    operation.get(250, TimeUnit.MILLISECONDS);
                    fail("Operation bypassed the notification monitor");
                } catch (TimeoutException expected) {
                    // Publication and cancellation must wait for the same monitor.
                }
            }
            operation.get(5, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }
    }
}
