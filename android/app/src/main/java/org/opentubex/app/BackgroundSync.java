package org.opentubex.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Keeps the renderer running while it syncs out of view. Android freezes a
 * hidden app, which would stall a sync until the app is opened again.
 */
final class BackgroundSync {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Set<String> holds = new HashSet<>();
    // Whether a worker keeps the process alive until every hold is released.
    private static boolean keeperScheduled;

    private BackgroundSync() {}

    static synchronized String begin(Context context) {
        String id = UUID.randomUUID().toString();
        holds.add(id);
        changed(context);
        return id;
    }

    static synchronized void end(Context context, String id) {
        if (holds.remove(id)) changed(context);
    }

    /** Releases every hold, for a renderer that reloaded or was destroyed. */
    static synchronized void clear(Context context) {
        if (holds.isEmpty()) return;
        holds.clear();
        changed(context);
    }

    static synchronized boolean isActive() {
        return !holds.isEmpty();
    }

    static synchronized void onAppVisibilityChanged(Context context) {
        if (keeperScheduled || holds.isEmpty() || AppVisibility.isVisible()) return;
        keeperScheduled = true;
        BackgroundSyncWorker.keepAlive(context);
    }

    /** Claims keeping the process alive; false when another worker already does. */
    static synchronized boolean claimKeeper() {
        if (keeperScheduled) return false;
        keeperScheduled = true;
        return true;
    }

    /** Waits for every hold to be released, then gives up the keeper role. */
    static synchronized void awaitIdle(long timeoutMillis, BooleanSupplier stopped) throws InterruptedException {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        try {
            while (!holds.isEmpty() && !stopped.getAsBoolean()) {
                long remaining = deadline - SystemClock.elapsedRealtime();
                if (remaining <= 0) return;
                // Wake up periodically to notice that WorkManager stopped the worker.
                BackgroundSync.class.wait(Math.min(remaining, 1000));
            }
        } finally {
            keeperScheduled = false;
        }
    }

    private static void changed(Context context) {
        BackgroundSync.class.notifyAll();
        // Chromium otherwise throttles the hidden page's timers.
        MAIN.post(() -> SubscriptionRefreshWebView.setSyncActive(isActive()));
        onAppVisibilityChanged(context);
    }
}
