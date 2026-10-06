package org.opentubex.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.IBinder;
import android.os.PowerManager;

/** Owns the native relay's background lifetime independently of local playback. */
public final class DlnaCastService extends Service {
    private static final String ACTION_STOP = "org.opentubex.app.dlna.STOP";
    private static final int NOTIFICATION_ID = 0x444c4e41;
    private static DlnaMediaServer pendingRelay;
    private DlnaMediaServer relay;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;

    static synchronized void start(Context context, DlnaMediaServer server) {
        pendingRelay = server;
        try { context.startForegroundService(new Intent(context, DlnaCastService.class)); }
        catch (RuntimeException error) { pendingRelay = null; throw error; }
    }

    static synchronized void stop(Context context, DlnaMediaServer server) {
        if (pendingRelay == server) {
            pendingRelay = null;
            context.stopService(new Intent(context, DlnaCastService.class));
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        OpenTubeXNotificationChannels.createAll(this);
        cpu = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":dlna-cast");
        cpu.setReferenceCounted(false);
        wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, getPackageName() + ":dlna-cast");
        wifi.setReferenceCounted(false);
        cpu.acquire();
        wifi.acquire();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, DlnaCastService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        // Acknowledge every foreground start, including one stopped during startup.
        startForeground(NOTIFICATION_ID, new Notification.Builder(this, OpenTubeXNotificationChannels.MEDIA_PLAYBACK_ID)
            .setSmallIcon(R.drawable.ic_stat_opentubex).setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_channel_media_playback_name)).setContentIntent(open)
            .setCategory(Notification.CATEGORY_TRANSPORT).setOngoing(true)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, getString(R.string.media_stop), stop).build()).build());
        synchronized (DlnaCastService.class) { relay = pendingRelay; }
        if (relay == null || intent == null || ACTION_STOP.equals(intent.getAction())) stopSelf(startId);
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        synchronized (DlnaCastService.class) {
            if (pendingRelay == relay) pendingRelay = null;
        }
        if (relay != null) { relay.muxFailed = true; relay.close(); relay = null; }
        if (wifi != null && wifi.isHeld()) wifi.release();
        if (cpu != null && cpu.isHeld()) cpu.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
