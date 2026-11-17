package org.opentubex.app;

import android.view.MotionEvent;

/**
 * Android consumes the edge swipe that reveals hidden system bars by default,
 * but also passes it to the app when the bars are transient. Decides which
 * touches of such a swipe the page may see: a drag from where the status bar
 * appears is canceled, while taps and sideways drags there still reach it.
 */
final class StatusBarSwipeFilter {
    enum Decision { FORWARD, DROP, CANCEL }

    private final float touchSlop;
    private boolean tracking;
    private boolean consumed;
    private float startX;
    private float startY;

    StatusBarSwipeFilter(float touchSlop) {
        this.touchSlop = touchSlop;
    }

    /** @param fromStatusBar whether a down event starts where Android reveals the status bar */
    Decision onTouch(int action, float x, float y, boolean fromStatusBar) {
        if (action == MotionEvent.ACTION_DOWN) {
            consumed = false;
            tracking = fromStatusBar;
            startX = x;
            startY = y;
            return Decision.FORWARD;
        }
        boolean ended = action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL;
        if (consumed) {
            if (ended) consumed = false;
            return Decision.DROP;
        }
        if (!tracking || action != MotionEvent.ACTION_MOVE) {
            if (ended) tracking = false;
            return Decision.FORWARD;
        }
        float deltaX = Math.abs(x - startX);
        float deltaY = y - startY;
        if (deltaY > touchSlop && deltaY >= deltaX) {
            tracking = false;
            consumed = true;
            return Decision.CANCEL;
        }
        if (deltaX > touchSlop) {
            tracking = false;
            return Decision.FORWARD;
        }
        // Small moves would reveal the player controls before the swipe is recognized.
        return Decision.DROP;
    }
}
