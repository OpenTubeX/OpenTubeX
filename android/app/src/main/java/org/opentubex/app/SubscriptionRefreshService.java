package org.opentubex.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.content.ContextCompat;

/** Protect a renderer refresh only while the app is out of view. */
public final class SubscriptionRefreshService extends Service {
    // A pending foreground-service start must acknowledge Android's startup
    // deadline even if the refresh finishes before onStartCommand is delivered.
    // Both fields are guarded by the SubscriptionRefreshWorker class lock.
    private static boolean started;
    private static int pendingStarts;
    private PowerManager.WakeLock wakeLock;

    static void start(android.content.Context context, Intent service) {
        pendingStarts++;
        try {
            ContextCompat.startForegroundService(context, service);
        } catch (RuntimeException error) {
            pendingStarts--;
            throw error;
        }
    }

    static void stopIfStarted(android.content.Context context) {
        // Android crashes the app if a start that has not reached startForeground
        // is stopped. The pending onStartCommand stops a finished refresh itself.
        if (started && pendingStarts == 0) context.stopService(new Intent(context, SubscriptionRefreshService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        synchronized (SubscriptionRefreshWorker.class) {
            if (intent != null && pendingStarts > 0) pendingStarts--;
            return startRefresh(intent, startId);
        }
    }

    private int startRefresh(Intent intent, int startId) {
        SubscriptionRefreshState.Snapshot state = SubscriptionRefreshWorker.rendererSnapshot();
        if (state == null && intent == null) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        android.app.Notification notification = SubscriptionRefreshNotification.build(
            this,
            state == null ? intent.getStringExtra("token") : state.token,
            state == null ? intent.getStringExtra("title") : state.title,
            state == null ? intent.getStringExtra("cancelLabel") : state.cancelLabel,
            state == null ? 0 : state.progress);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(SubscriptionRefreshNotification.NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(SubscriptionRefreshNotification.NOTIFICATION_ID, notification);
        }
        started = true;
        if (state == null || AppVisibility.isVisible()) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            // A newer start may already be queued; it keeps the service.
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager.class).newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK, "OpenTubeX:subscription-refresh");
            wakeLock.acquire(6 * 60 * 60 * 1000L);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId, int foregroundServiceType) {
        SubscriptionRefreshState.Snapshot state = SubscriptionRefreshWorker.rendererSnapshot();
        if (state != null) {
            new SubscriptionRefreshCancelReceiver().onReceive(this,
                new Intent(SubscriptionRefreshCancelReceiver.ACTION_CANCEL)
                    .putExtra(SubscriptionRefreshCancelReceiver.TOKEN_EXTRA, state.token));
            SubscriptionRefreshWorker.finish(this, state.token);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        synchronized (SubscriptionRefreshWorker.class) {
            started = false;
            stopForeground(STOP_FOREGROUND_REMOVE);
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
