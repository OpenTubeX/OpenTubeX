package org.opentubex.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.IBinder;
import android.os.PowerManager;

/** Keeps the native sender and relay alive after local playback pauses. */
public final class CastService extends Service {
    private static final String ACTION_STOP = "org.opentubex.app.cast.STOP";
    private static Runnable pendingStop;
    private static String pendingId;
    private String sessionId;
    private Runnable stopSession;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;

    static synchronized void start(Context context, String id, Runnable stop) {
        pendingStop = stop;
        pendingId = id;
        try { context.startForegroundService(new Intent(context, CastService.class)); }
        catch (RuntimeException error) { pendingStop = null; throw error; }
    }

    static synchronized void stop(Context context, String id) {
        if (id == null || !id.equals(pendingId)) return;
        pendingStop = null;
        pendingId = null;
        context.stopService(new Intent(context, CastService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        OpenTubeXNotificationChannels.createAll(this);
        cpu = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":google-cast");
        cpu.setReferenceCounted(false);
        wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, getPackageName() + ":google-cast");
        wifi.setReferenceCounted(false);
        cpu.acquire();
        wifi.acquire();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, CastService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(0x43415354, new Notification.Builder(this, OpenTubeXNotificationChannels.MEDIA_PLAYBACK_ID)
            .setSmallIcon(R.drawable.ic_stat_opentubex).setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_channel_media_playback_name)).setContentIntent(open)
            .setCategory(Notification.CATEGORY_TRANSPORT).setOngoing(true)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, getString(R.string.media_stop), stop).build()).build());
        synchronized (CastService.class) {
            sessionId = pendingId;
            stopSession = pendingStop;
            if (pendingStop == null || intent == null || ACTION_STOP.equals(intent.getAction())) stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        Runnable stop;
        synchronized (CastService.class) {
            stop = stopSession;
            if (sessionId != null && sessionId.equals(pendingId)) { pendingStop = null; pendingId = null; }
        }
        if (stop != null) stop.run();
        if (wifi != null && wifi.isHeld()) wifi.release();
        if (cpu != null && cpu.isHeld()) cpu.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
