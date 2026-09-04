package org.opentubex.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import java.util.ArrayList;
import java.util.List;

final class OpenTubeXNotificationChannels {
    static final String MEDIA_PLAYBACK_ID = "media-playback";
    static final String SUBSCRIPTION_REFRESH_ID = "subscription-refresh";
    static final String LIVE_REMINDERS_ID = "live-reminders";
    private static final String OBSOLETE_LOCAL_NOTIFICATIONS_DEFAULT_ID = "default";

    static final class ChannelSpec {
        final String id;
        final int nameResource;
        final int descriptionResource;
        final int importance;
        final boolean showBadge;

        ChannelSpec(
            String id,
            int nameResource,
            int descriptionResource,
            int importance,
            boolean showBadge
        ) {
            this.id = id;
            this.nameResource = nameResource;
            this.descriptionResource = descriptionResource;
            this.importance = importance;
            this.showBadge = showBadge;
        }
    }

    private OpenTubeXNotificationChannels() {}

    static ChannelSpec[] specifications() {
        return new ChannelSpec[] {
            // AndroidMediaSessionService owns the media playback notification.
            new ChannelSpec(
                MEDIA_PLAYBACK_ID,
                R.string.notification_channel_media_playback_name,
                R.string.notification_channel_media_playback_description,
                NotificationManager.IMPORTANCE_LOW,
                false
            ),
            // SubscriptionRefreshWorker owns foreground and scheduled progress.
            new ChannelSpec(
                SUBSCRIPTION_REFRESH_ID,
                R.string.notification_channel_subscription_refresh_name,
                R.string.notification_channel_subscription_refresh_description,
                NotificationManager.IMPORTANCE_LOW,
                false
            ),
            // Capacitor LocalNotifications owns scheduled live reminders.
            new ChannelSpec(
                LIVE_REMINDERS_ID,
                R.string.notification_channel_live_reminders_name,
                R.string.notification_channel_live_reminders_description,
                NotificationManager.IMPORTANCE_HIGH,
                true
            ),
        };
    }

    static void createAll(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        List<NotificationChannel> channels = new ArrayList<>();
        for (ChannelSpec specification : specifications()) {
            NotificationChannel channel = new NotificationChannel(
                specification.id,
                context.getString(specification.nameResource),
                specification.importance
            );
            channel.setDescription(context.getString(specification.descriptionResource));
            channel.setShowBadge(specification.showBadge);
            channels.add(channel);
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannels(channels);
        // Capacitor creates a generic fallback channel when its plugin loads.
        // Every notification in this app has a purpose-specific channel, and
        // live-reminders is the defined replacement for the old fallback.
        manager.deleteNotificationChannel(OBSOLETE_LOCAL_NOTIFICATIONS_DEFAULT_ID);
    }
}
