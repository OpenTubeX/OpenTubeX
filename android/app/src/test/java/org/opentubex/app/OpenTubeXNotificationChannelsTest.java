package org.opentubex.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;

import org.junit.Test;

public class OpenTubeXNotificationChannelsTest {
    @Test
    public void distinctNotificationPurposesKeepStableChannelIds() {
        OpenTubeXNotificationChannels.ChannelSpec[] channels =
            OpenTubeXNotificationChannels.specifications();

        assertArrayEquals(
            new String[] { "media-playback", "subscription-refresh", "live-reminders" },
            new String[] { channels[0].id, channels[1].id, channels[2].id }
        );
        assertEquals(NotificationManager.IMPORTANCE_LOW, channels[0].importance);
        assertEquals(NotificationManager.IMPORTANCE_LOW, channels[1].importance);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channels[2].importance);
        assertEquals(R.string.notification_channel_media_playback_name, channels[0].nameResource);
        assertEquals(R.string.notification_channel_subscription_refresh_name, channels[1].nameResource);
        assertEquals(R.string.notification_channel_live_reminders_name, channels[2].nameResource);
        for (OpenTubeXNotificationChannels.ChannelSpec channel : channels) {
            assertNotEquals(0, channel.descriptionResource);
        }
        assertFalse(channels[0].showBadge);
        assertFalse(channels[1].showBadge);
        assertTrue(channels[2].showBadge);
    }
}
