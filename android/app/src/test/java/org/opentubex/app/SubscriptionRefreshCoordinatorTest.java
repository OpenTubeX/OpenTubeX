package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

public class SubscriptionRefreshCoordinatorTest {
    @After
    public void resetCoordinator() {
        SubscriptionRefreshCoordinator.resetForTest();
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
