package org.opentubex.app;

final class SubscriptionRefreshCoordinator {
    private static String token;
    private static boolean cancelled;

    private SubscriptionRefreshCoordinator() {}

    static synchronized boolean begin(String nextToken) {
        if (token != null) return false;
        token = nextToken;
        cancelled = false;
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
        return true;
    }

    static synchronized void resetForTest() {
        token = null;
        cancelled = false;
    }
}
