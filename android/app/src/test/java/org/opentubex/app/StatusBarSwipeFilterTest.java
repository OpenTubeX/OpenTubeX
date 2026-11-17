package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import android.view.MotionEvent;

import org.junit.Test;

import org.opentubex.app.StatusBarSwipeFilter.Decision;

public class StatusBarSwipeFilterTest {
    private final StatusBarSwipeFilter filter = new StatusBarSwipeFilter(10);

    @Test
    public void cancelsADownwardSwipeFromTheStatusBar() {
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_DOWN, 100, 1, true));
        assertEquals(Decision.DROP, filter.onTouch(MotionEvent.ACTION_MOVE, 102, 8, false));
        assertEquals(Decision.CANCEL, filter.onTouch(MotionEvent.ACTION_MOVE, 104, 60, false));
        assertEquals(Decision.DROP, filter.onTouch(MotionEvent.ACTION_MOVE, 104, 300, false));
        assertEquals(Decision.DROP, filter.onTouch(MotionEvent.ACTION_UP, 104, 300, false));
        // The next touch starts over.
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_DOWN, 100, 500, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_MOVE, 100, 800, false));
    }

    @Test
    public void passesTapsAndSidewaysDragsFromTheStatusBar() {
        filter.onTouch(MotionEvent.ACTION_DOWN, 100, 1, true);
        assertEquals(Decision.DROP, filter.onTouch(MotionEvent.ACTION_MOVE, 103, 4, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_UP, 103, 4, false));

        filter.onTouch(MotionEvent.ACTION_DOWN, 100, 1, true);
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_MOVE, 160, 20, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_MOVE, 160, 200, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_UP, 160, 200, false));
    }

    @Test
    public void leavesTouchesElsewhereAlone() {
        filter.onTouch(MotionEvent.ACTION_DOWN, 100, 400, false);
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_MOVE, 100, 402, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_MOVE, 100, 900, false));
        assertEquals(Decision.FORWARD, filter.onTouch(MotionEvent.ACTION_UP, 100, 900, false));
    }
}
