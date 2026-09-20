package org.opentubex.app;

import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class ArtworkRequestQueueTest {
    @Test public void replacementCancelsActiveWorkAndSkipsSupersededPendingWork() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch cancelled = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch newest = new CountDownLatch(1);
        AtomicBoolean obsoleteRan = new AtomicBoolean();
        try (ArtworkRequestQueue queue = new ArtworkRequestQueue()) {
            queue.replace(request -> {
                request.onCancel(cancelled::countDown);
                started.countDown();
                try { release.await(5, TimeUnit.SECONDS); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            });
            assertTrue(started.await(5, TimeUnit.SECONDS));
            queue.replace(request -> obsoleteRan.set(true));
            assertTrue(cancelled.await(1, TimeUnit.SECONDS));
            queue.replace(request -> newest.countDown());
            release.countDown();
            assertTrue(newest.await(5, TimeUnit.SECONDS));
            assertFalse(obsoleteRan.get());
        } finally { release.countDown(); }
    }

    @Test public void connectionsRegisteredAfterCancellationAreCancelledImmediately() {
        ArtworkRequestQueue.Request request = new ArtworkRequestQueue.Request();
        request.cancel();
        AtomicBoolean cancelled = new AtomicBoolean();
        request.onCancel(() -> cancelled.set(true));
        assertTrue(cancelled.get());
        assertTrue(request.isCancelled());
    }

    @Test public void completedButUndeliveredResultsBecomeStaleOnClose() throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        ArtworkRequestQueue.Request[] delivered = new ArtworkRequestQueue.Request[1];
        ArtworkRequestQueue queue = new ArtworkRequestQueue();
        try {
            queue.replace(request -> { delivered[0] = request; completed.countDown(); });
            assertTrue(completed.await(5, TimeUnit.SECONDS));
        } finally { queue.close(); }
        assertTrue(delivered[0].isCancelled());
    }
}
