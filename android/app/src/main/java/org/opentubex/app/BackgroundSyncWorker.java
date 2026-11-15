package org.opentubex.app;

import android.content.Context;
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

import java.util.concurrent.TimeUnit;

/** Runs while a hidden renderer syncs, and periodically asks it to sync. */
public final class BackgroundSyncWorker extends Worker {
    private static final String PERIODIC_WORK = "background-sync";
    private static final String KEEP_ALIVE_WORK = "background-sync-keep-alive";
    private static final String REQUEST_SYNC_INPUT = "requestSync";
    private static final String PREFERENCES = "background-sync";
    private static final String ENABLED_KEY = "periodic";
    // WorkManager stops workers after ten minutes.
    private static final long MAXIMUM_WAIT_MILLIS = TimeUnit.MINUTES.toMillis(9);

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void schedule(Context context, boolean enabled) {
        // Remembered for processes whose job was paused because no renderer ran.
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit().putBoolean(ENABLED_KEY, enabled).apply();
        WorkManager workManager = WorkManager.getInstance(context);
        if (!enabled) {
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

    /** Restores a periodic job that a process without a renderer paused. */
    static void resume(Context context) {
        if (context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(ENABLED_KEY, false)) {
            schedule(context, true);
        }
    }

    /** WorkManager runs operations in call order, so callers hold the plugin's lock. */
    static void pause(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK);
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
            // The visible renderer schedules its own syncs.
            if (AppVisibility.isVisible()) return Result.success();
            // Without a renderer, this process was started for the job and cannot sync.
            // The next renderer resumes the job when its plugin loads.
            if (BackgroundSyncPlugin.pauseWithoutRenderer(context)) return Result.success();
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
