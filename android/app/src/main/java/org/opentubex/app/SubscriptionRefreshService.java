package org.opentubex.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Protect a renderer refresh only while the app is out of view. */
public final class SubscriptionRefreshService extends Service {
    // A pending foreground-service start must acknowledge Android's startup
    // deadline even if the refresh finishes before onStartCommand is delivered.
    private static boolean started;
    private PowerManager.WakeLock wakeLock;

    static void stopIfStarted(android.content.Context context) {
        if (started) context.stopService(new Intent(context, SubscriptionRefreshService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        synchronized (SubscriptionRefreshWorker.class) {
            return startRefresh(intent);
        }
    }

    private int startRefresh(Intent intent) {
        SubscriptionRefreshState.Snapshot state = SubscriptionRefreshWorker.rendererSnapshot();
        if (state == null && intent == null) {
            stopSelf();
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
            stopSelf();
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
