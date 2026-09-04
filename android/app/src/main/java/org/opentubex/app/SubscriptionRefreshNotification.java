package org.opentubex.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;

import androidx.annotation.RequiresApi;
import androidx.work.ForegroundInfo;

final class SubscriptionRefreshNotification {
    static final String CHANNEL_ID = OpenTubeXNotificationChannels.SUBSCRIPTION_REFRESH_ID;
    static final int NOTIFICATION_ID = 0x53554253;

    private SubscriptionRefreshNotification() {}

    static Notification build(Context context, String token, String title, String cancelLabel, int progress) {
        OpenTubeXNotificationChannels.createAll(context);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);

        Intent openApp = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            0,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Intent cancelRefresh = new Intent(context, SubscriptionRefreshCancelReceiver.class)
            .setAction(SubscriptionRefreshCancelReceiver.ACTION_CANCEL)
            .putExtra(SubscriptionRefreshCancelReceiver.TOKEN_EXTRA, token);
        PendingIntent cancelIntent = PendingIntent.getBroadcast(
            context,
            token.hashCode(),
            cancelRefresh,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        builder
            .setSmallIcon(R.drawable.ic_stat_opentubex)
            .setContentTitle(title)
            .setContentText(progress + "%")
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setContentIntent(contentIntent)
            .addAction(new Notification.Action.Builder(0, cancelLabel, cancelIntent).build())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false);

        if (Build.VERSION.SDK_INT >= 36) {
            applyProgressStyle(builder, progress);
        } else {
            builder.setProgress(100, progress, false);
        }

        return builder.build();
    }

    static ForegroundInfo foregroundInfo(
        Context context,
        String token,
        String title,
        String cancelLabel,
        int progress
    ) {
        Notification notification = build(context, token, title, cancelLabel, progress);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        }
        return new ForegroundInfo(NOTIFICATION_ID, notification);
    }

    @RequiresApi(36)
    private static void applyProgressStyle(Notification.Builder builder, int progress) {
        Notification.ProgressStyle style = new Notification.ProgressStyle()
            .setProgress(progress)
            .addProgressSegment(
                new Notification.ProgressStyle.Segment(100).setColor(Color.rgb(239, 83, 80))
            );
        builder.setStyle(style);
    }
}
