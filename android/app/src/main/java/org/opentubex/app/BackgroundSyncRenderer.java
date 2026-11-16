package org.opentubex.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.Bridge;
import com.getcapacitor.Plugin;

import java.net.CookieHandler;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/**
 * Loads the renderer out of view so the periodic job can sync after the app
 * was closed. The page syncs once and reports back, and the app's own
 * renderer replaces it when the app opens.
 */
final class BackgroundSyncRenderer {
    private static final String LOG_TAG = "OpenTubeXSync";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    // Only what the sync needs. Other plugins hold the app's own state, such as
    // its media session, notifications or widgets.
    private static final List<Class<? extends Plugin>> PLUGINS = List.of(
        AndroidProxyPlugin.class,
        AndroidLocalNetworkPlugin.class,
        SecretStoragePlugin.class,
        AndroidStoragePlugin.class,
        LibraryDatabasePlugin.class,
        BackgroundSyncPlugin.class,
        AndroidHttpPlugin.class
    );

    // Accessed on the main thread only.
    private static Bridge bridge;
    private static Run current;

    private BackgroundSyncRenderer() {}

    private static final class Run {
        final CountDownLatch done = new CountDownLatch(1);
        volatile boolean synced;
    }

    /**
     * Syncs in a hidden renderer, returning once the sync ended, the time ran
     * out, or the worker was stopped. Runs on the worker's thread.
     * @return whether the renderer reported the end of its sync
     */
    static boolean sync(Context context, long timeoutMillis, BooleanSupplier stopped) throws InterruptedException {
        Run run = new Run();
        MAIN.post(() -> start(context, run));
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        try {
            // Wake up periodically to notice that WorkManager stopped the worker.
            while (!run.done.await(1, TimeUnit.SECONDS)) {
                if (stopped.getAsBoolean() || SystemClock.elapsedRealtime() >= deadline) break;
            }
            return run.synced;
        } finally {
            MAIN.post(() -> stop(run));
        }
    }

    private static void start(Context context, Run run) {
        // The app's renderer syncs by itself, and a second one would write the
        // same databases.
        if (bridge != null || BackgroundSyncPlugin.hasRenderer()) {
            run.done.countDown();
            return;
        }
        try {
            bridge = new Bridge.Builder(new BackgroundSyncHost(context)).setPlugins(PLUGINS).create();
            current = run;
        } catch (RuntimeException error) {
            Log.e(LOG_TAG, "Unable to load the renderer for background sync", error);
            bridge = null;
            run.done.countDown();
            return;
        }
        // As in MainActivity: keep native requests stateless, and keep plugins
        // away from frames when the top-frame-only bridge is unavailable.
        CookieHandler.setDefault(null);
        bridge.getWebView().removeJavascriptInterface("androidBridge");
    }

    /** Called by the hidden renderer's plugin once its sync ended. */
    static void finish(Bridge from) {
        MAIN.post(() -> {
            if (from != bridge || current == null) return;
            current.synced = true;
            current.done.countDown();
        });
    }

    /** Whether the bridge belongs to the hidden renderer rather than to the app. */
    static boolean isHidden(Bridge candidate) {
        return candidate.getActivity() instanceof BackgroundSyncHost;
    }

    /**
     * Ends the hidden renderer, for example because the app is opening. Its sync
     * stops like it does when Android ends the app, and resumes in the app.
     */
    static void stop() {
        stop(current);
    }

    private static void stop(Run owner) {
        if (bridge == null || owner != current) return;
        Bridge ended = bridge;
        Run run = current;
        bridge = null;
        current = null;
        // Plugins release their holds, cancel their requests, and close the
        // databases after the writes already queued.
        ended.onDestroy();
        ended.onDetachedFromWindow();
        run.done.countDown();
    }
}
