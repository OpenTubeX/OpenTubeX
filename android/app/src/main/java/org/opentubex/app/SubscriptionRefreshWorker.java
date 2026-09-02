package org.opentubex.app;

import android.app.NotificationManager;
import android.content.Context;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class SubscriptionRefreshWorker extends Worker {
    private static final String UNIQUE_WORK_NAME = "subscription-refresh";
    private static final String TOKEN_INPUT = "token";
    private static final SubscriptionRefreshState STATE = new SubscriptionRefreshState();

    public SubscriptionRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void start(Context context, String token, String title) {
        STATE.begin(token, title);
        Data input = new Data.Builder().putString(TOKEN_INPUT, token).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SubscriptionRefreshWorker.class)
            .setInputData(input)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request
        );
    }

    static boolean update(Context context, String token, int progress) {
        if (!STATE.update(token, progress)) return false;
        SubscriptionRefreshState.Snapshot snapshot = STATE.snapshot(token);
        if (snapshot == null) return false;
        context.getSystemService(NotificationManager.class).notify(
            SubscriptionRefreshNotification.NOTIFICATION_ID,
            SubscriptionRefreshNotification.build(context, snapshot.title, snapshot.progress)
        );
        return true;
    }

    static boolean finish(Context context, String token) {
        boolean finished = STATE.finish(token);
        if (finished) {
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            notifications.cancel(SubscriptionRefreshNotification.NOTIFICATION_ID);
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME).getResult().addListener(
                () -> notifications.cancel(SubscriptionRefreshNotification.NOTIFICATION_ID),
                ContextCompat.getMainExecutor(context)
            );
        }
        return finished;
    }

    @NonNull
    @Override
    public Result doWork() {
        String token = getInputData().getString(TOKEN_INPUT);
        SubscriptionRefreshState.Snapshot snapshot = STATE.snapshot(token);
        if (snapshot == null) return Result.success();

        try {
            setForegroundAsync(SubscriptionRefreshNotification.foregroundInfo(
                getApplicationContext(),
                snapshot.title,
                snapshot.progress
            )).get();
            STATE.awaitCompletion(token);
            return Result.success();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return Result.failure();
        } catch (Exception error) {
            return Result.failure();
        }
    }
}
