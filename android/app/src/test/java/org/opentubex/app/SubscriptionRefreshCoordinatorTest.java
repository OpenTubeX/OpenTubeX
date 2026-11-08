package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Test;

public class SubscriptionRefreshCoordinatorTest {
    @After
    public void resetCoordinator() {
        SubscriptionRefreshCoordinator.resetForTest();
    }

    @Test
    public void reopenedRenderersCanReadCurrentFeedAndProgress() {
        assertTrue(SubscriptionRefreshCoordinator.begin("scheduled"));
        SubscriptionRefreshCoordinator.update("scheduled", "shorts", 42);
        SubscriptionRefreshCoordinator.update("stale", "videos", 99);
        assertEquals("shorts", SubscriptionRefreshCoordinator.snapshot().tab());
        assertEquals(42, SubscriptionRefreshCoordinator.snapshot().percentage());
        SubscriptionRefreshCoordinator.setProgress("scheduled", 73);
        assertEquals(73, SubscriptionRefreshCoordinator.snapshot().percentage());
        assertTrue(SubscriptionRefreshCoordinator.finish("scheduled"));
        assertNull(SubscriptionRefreshCoordinator.snapshot().token());
        assertNull(SubscriptionRefreshCoordinator.snapshot().tab());
        assertEquals(0, SubscriptionRefreshCoordinator.snapshot().percentage());
    }

    @Test
    public void preventsManualAndScheduledRefreshesFromOverlapping() {
        assertTrue(SubscriptionRefreshCoordinator.begin("scheduled"));
        assertFalse(SubscriptionRefreshCoordinator.begin("manual"));
        assertTrue(SubscriptionRefreshCoordinator.isActive());

        assertTrue(SubscriptionRefreshCoordinator.finish("scheduled"));
        assertTrue(SubscriptionRefreshCoordinator.begin("manual"));
    }

    @Test
    public void cancellationOnlyAffectsTheCurrentToken() {
        assertTrue(SubscriptionRefreshCoordinator.begin("current"));
        assertFalse(SubscriptionRefreshCoordinator.cancel("stale"));
        assertFalse(SubscriptionRefreshCoordinator.isCancelled("current"));

        assertTrue(SubscriptionRefreshCoordinator.cancel("current"));
        assertTrue(SubscriptionRefreshCoordinator.isCancelled("current"));
        assertFalse(SubscriptionRefreshCoordinator.finish("stale"));
        assertTrue(SubscriptionRefreshCoordinator.finish("current"));
    }
}
