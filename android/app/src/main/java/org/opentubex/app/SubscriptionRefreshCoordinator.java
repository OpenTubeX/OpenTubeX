package org.opentubex.app;

final class SubscriptionRefreshCoordinator {
    private static String token;
    private static boolean cancelled;
    private static String tab;
    private static int percentage;

    record Snapshot(String token, String tab, int percentage) {}

    static synchronized Snapshot snapshot() {
        return new Snapshot(token, tab, percentage);
    }

    static synchronized void update(String expectedToken, String nextTab, int progress) {
        if (!isCurrent(expectedToken)) return;
        tab = nextTab;
        percentage = Math.max(0, Math.min(100, progress));
    }

    static synchronized void setProgress(String expectedToken, int progress) {
        update(expectedToken, tab, progress);
    }

    private SubscriptionRefreshCoordinator() {}

    static synchronized boolean begin(String nextToken) {
        if (token != null) return false;
        token = nextToken;
        cancelled = false;
        tab = null;
        percentage = 0;
        return true;
    }

    static synchronized boolean isCurrent(String expectedToken) {
        return token != null && token.equals(expectedToken);
    }

    static synchronized boolean isActive() {
        return token != null;
    }

    static synchronized boolean cancel(String expectedToken) {
        if (!isCurrent(expectedToken)) return false;
        cancelled = true;
        return true;
    }

    static synchronized boolean isCancelled(String expectedToken) {
        return isCurrent(expectedToken) && cancelled;
    }

    static synchronized boolean finish(String expectedToken) {
        if (!isCurrent(expectedToken)) return false;
        token = null;
        cancelled = false;
        tab = null;
        percentage = 0;
        return true;
    }

    static synchronized void resetForTest() {
        token = null;
        cancelled = false;
        tab = null;
        percentage = 0;
    }
}
