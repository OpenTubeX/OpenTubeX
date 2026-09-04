package org.opentubex.app;

final class SubscriptionRefreshNotificationProgress {
    private int progress;

    boolean advanceTo(int nextProgress) {
        if (progress == nextProgress) return false;
        progress = nextProgress;
        return true;
    }

    void reset() {
        progress = 0;
    }
}
