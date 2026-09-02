package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SubscriptionRefreshStateTest {
    @Test
    public void onlyCurrentRefreshCanUpdateOrFinish() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("current", "Refreshing subscriptions", "Cancel");

        assertFalse(state.update("stale", 50));
        assertFalse(state.finish("stale"));
        assertEquals(0, state.snapshot("current").progress);

        assertTrue(state.update("current", 42));
        assertEquals(42, state.snapshot("current").progress);
        assertTrue(state.finish("current"));
        assertNull(state.snapshot("current"));
    }

    @Test
    public void progressIsClamped() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("refresh", "Refreshing subscriptions", "Cancel");

        assertTrue(state.update("refresh", -5));
        assertEquals(0, state.snapshot("refresh").progress);
        assertTrue(state.update("refresh", 130));
        assertEquals(100, state.snapshot("refresh").progress);
    }

    @Test
    public void startingAnotherRefreshInvalidatesThePreviousToken() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("first", "Refreshing videos", "Cancel");
        state.begin("second", "Refreshing shorts", "Cancel");

        assertNull(state.snapshot("first"));
        assertEquals("Refreshing shorts", state.snapshot("second").title);
        assertEquals("Cancel", state.snapshot("second").cancelLabel);
    }
}
