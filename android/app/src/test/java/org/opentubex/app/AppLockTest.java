package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppLockTest {
    @Test
    public void locksANewProcessUntilUnlocked() {
        assertTrue(AppLock.shouldLock(true, true, false, -1, 1_000, 60_000));
    }

    @Test
    public void locksOnlyOnceTheTimeoutHasPassed() {
        assertFalse(AppLock.shouldLock(true, true, true, 10_000, 69_999, 60_000));
        assertTrue(AppLock.shouldLock(true, true, true, 10_000, 70_000, 60_000));
        assertTrue(AppLock.shouldLock(true, true, true, 10_000, 10_000, 0));
        assertFalse(AppLock.shouldLock(true, true, true, -1, 1_000_000, 0));
    }

    @Test
    public void staysOpenWhenDisabledOrWithoutAScreenLock() {
        assertFalse(AppLock.shouldLock(false, true, false, 0, 1_000_000, 0));
        // Nothing could unlock the app once the device has no screen lock.
        assertFalse(AppLock.shouldLock(true, false, false, 0, 1_000_000, 0));
    }
}
