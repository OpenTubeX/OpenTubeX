package org.opentubex.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Runs while a hidden app syncs, and periodically runs the renderer's
 * background tasks, such as the sync, while the app is hidden or closed.
 */
public final class BackgroundSyncWorker extends Worker {
    private static final String PERIODIC_WORK = "background-sync";
    private static final String KEEP_ALIVE_WORK = "background-sync-keep-alive";
    private static final String REQUEST_SYNC_INPUT = "requestSync";
    private static final String PREFERENCES = "background-tasks";
    private static final String TASKS_KEY = "tasks";
    // WorkManager stops workers after ten minutes.
    private static final long MAXIMUM_WAIT_MILLIS = TimeUnit.MINUTES.toMillis(9);

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    /**
     * Turns a task of the periodic job on or off, such as the sync or the checks
     * for comment replies. The job runs while any of them is on, and the renderer
     * runs the ones that are on.
     */
    static synchronized void schedule(Context context, String task, boolean enabled) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        Set<String> tasks = new HashSet<>(preferences.getStringSet(TASKS_KEY, Collections.emptySet()));
        if (enabled) tasks.add(task);
        else tasks.remove(task);
        preferences.edit().putStringSet(TASKS_KEY, tasks).apply();
        WorkManager workManager = WorkManager.getInstance(context);
        if (tasks.isEmpty()) {
            workManager.cancelUniqueWork(PERIODIC_WORK);
            return;
        }
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            BackgroundSyncWorker.class, 15, TimeUnit.MINUTES
        )
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(new Data.Builder().putBoolean(REQUEST_SYNC_INPUT, true).build())
            .build();
        workManager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void keepAlive(Context context) {
        OneTimeWorkRequest.Builder request = new OneTimeWorkRequest.Builder(BackgroundSyncWorker.class);
        // Older versions run expedited work as a foreground service with a
        // notification, but they do not freeze cached apps either.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            request.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        }
        WorkManager.getInstance(context)
            .enqueueUniqueWork(KEEP_ALIVE_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request.build());
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String hold = null;
        boolean keeper = true;
        if (getInputData().getBoolean(REQUEST_SYNC_INPUT, false)) {
            // The visible renderer runs its tasks by itself.
            if (AppVisibility.isVisible()) return Result.success();
            // The tasks' requests go through the app's proxy relay, whose kept-alive
            // tunnels the server may have closed while the app was frozen.
            AndroidProxy.closeStaleTunnels(AndroidProxyRelay.clock.getAsLong());
            // After the app was closed, a hidden renderer runs them in its place.
            if (!BackgroundSyncPlugin.hasRenderer()) {
                try {
                    BackgroundSyncRenderer.sync(context, MAXIMUM_WAIT_MILLIS, this::isStopped);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
                return Result.success();
            }
            keeper = BackgroundSync.claimKeeper();
            hold = BackgroundSyncPlugin.requestSync(context);
        }
        try {
            if (keeper) BackgroundSync.awaitIdle(MAXIMUM_WAIT_MILLIS, this::isStopped);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } finally {
            // The renderer releases this hold when its sync finishes.
            if (hold != null && keeper) BackgroundSync.end(context, hold);
        }
        // A sync still running at the deadline needs another keeper.
        BackgroundSync.onAppVisibilityChanged(context);
        return Result.success();
    }
}
