package org.opentubex.app;

import java.util.concurrent.CountDownLatch;
import java.util.function.Consumer;

final class SubscriptionRefreshState {
    static final class Snapshot {
        final String token;
        final String title;
        final String cancelLabel;
        final int progress;

        Snapshot(String token, String title, String cancelLabel, int progress) {
            this.token = token;
            this.title = title;
            this.cancelLabel = cancelLabel;
            this.progress = progress;
        }
    }

    private String token;
    private String title;
    private String cancelLabel;
    private int progress;
    private final SubscriptionRefreshNotificationProgress notificationProgress =
        new SubscriptionRefreshNotificationProgress();
    private CountDownLatch completion = new CountDownLatch(0);
    private Consumer<Boolean> activeListener;

    synchronized void observeActive(Consumer<Boolean> listener) {
        activeListener = listener;
        listener.accept(token != null);
    }

    synchronized void removeActiveListener(Consumer<Boolean> listener) {
        if (activeListener == listener) activeListener = null;
    }

    synchronized void begin(String nextToken, String nextTitle, String nextCancelLabel) {
        completion.countDown();
        token = nextToken;
        title = nextTitle;
        cancelLabel = nextCancelLabel;
        progress = 0;
        notificationProgress.reset();
        completion = new CountDownLatch(1);
        if (activeListener != null) activeListener.accept(true);
    }

    synchronized boolean update(String expectedToken, int nextProgress) {
        if (!isCurrent(expectedToken)) return false;
        progress = Math.max(0, Math.min(100, nextProgress));
        return true;
    }

    synchronized Snapshot snapshot(String expectedToken) {
        if (!isCurrent(expectedToken)) return null;
        return new Snapshot(token, title, cancelLabel, progress);
    }

    synchronized Snapshot takeNotificationSnapshot(String expectedToken) {
        if (!isCurrent(expectedToken) || !notificationProgress.advanceTo(progress)) return null;
        return new Snapshot(token, title, cancelLabel, progress);
    }

    void awaitCompletion(String expectedToken) throws InterruptedException {
        CountDownLatch activeCompletion;
        synchronized (this) {
            if (!isCurrent(expectedToken)) return;
            activeCompletion = completion;
        }
        activeCompletion.await();
    }

    synchronized boolean finish(String expectedToken) {
        if (!isCurrent(expectedToken)) return false;
        token = null;
        title = null;
        cancelLabel = null;
        progress = 0;
        notificationProgress.reset();
        completion.countDown();
        if (activeListener != null) activeListener.accept(false);
        return true;
    }

    private boolean isCurrent(String expectedToken) {
        return token != null && token.equals(expectedToken);
    }
}
